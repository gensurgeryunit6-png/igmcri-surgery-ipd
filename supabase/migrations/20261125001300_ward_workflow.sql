-- Surgery Unit OS · 0013 complete ward workflow.
-- OPD visits, the waiting list (bookings for Major OT / Minor OT / Endoscopy) with call tracking and a pre-op
-- checklist, OT lists with ordered cases and operation notes, investigation tracking, tasks with four statuses,
-- and the treating team on each admission. Replaces the separate ot-form app (its tables no longer exist).
-- Rollback: drop the new tables/functions/views; drop the added columns; restore the care_tasks and
--           surgery_waitlist check constraints from 0002/0003.

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, description) values
  ('task.update', 'Update tasks assigned to me and mark investigations collected'),
  ('task.verify', 'Verify completed tasks')
on conflict (code) do nothing;
insert into public.role_permissions (role_code, permission_code)
select r, p from (values
  ('unit_chief', array['task.update','task.verify']),
  ('faculty', array['task.update','task.verify']),
  ('senior_resident', array['task.update']),
  ('postgraduate', array['task.update']),
  ('intern', array['task.update'])
) v(r, ps), unnest(ps) p
on conflict do nothing;

-- ---------------------------------------------------------------- patients and team
alter table public.patients add column if not exists phone_2 text;
alter table public.patients add column if not exists op_number text;
create index if not exists patients_op_number_idx on public.patients (op_number);
create index if not exists patients_phone_idx on public.patients (phone);

alter table public.admissions add column if not exists asst_prof_person_id uuid references public.unit_personnel(id);
alter table public.admissions add column if not exists intern_person_id uuid references public.unit_personnel(id);
create index if not exists admissions_asst_prof_idx on public.admissions (asst_prof_person_id);
create index if not exists admissions_intern_idx on public.admissions (intern_person_id);

-- The personnel record of the signed-in user in a unit (for "assigned to me").
create or replace function private.my_person_ids(p_unit uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.unit_personnel where unit_id = p_unit and user_id = auth.uid() and active
$$;

-- ---------------------------------------------------------------- OPD visits
create table public.opd_visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  unit_id uuid not null references public.units(id),
  visit_at timestamptz not null default now(),
  visit_type text not null default 'new' check (visit_type in ('new','follow_up','post_op','referral')),
  consultant_person_id uuid references public.unit_personnel(id),
  diagnosis text,
  laterality text check (laterality in ('left','right','bilateral','na')),
  notes text,
  investigations_advised text,
  decision text not null default 'follow_up' check (decision in ('follow_up','admit','book','discharge','none')),
  follow_up_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index opd_visits_patient_idx on public.opd_visits (patient_id, visit_at desc);
create index opd_visits_unit_day_idx on public.opd_visits (unit_id, visit_at desc);
create index opd_visits_followup_idx on public.opd_visits (unit_id, follow_up_on) where follow_up_on is not null;
create index opd_visits_consultant_idx on public.opd_visits (consultant_person_id);
alter table public.opd_visits enable row level security;
create policy read on public.opd_visits for select to authenticated using (private.has_perm(unit_id, 'patient.read'));
create policy ins on public.opd_visits for insert to authenticated with check (private.has_perm(unit_id, 'patient.write'));
create policy upd on public.opd_visits for update to authenticated
  using (private.has_perm(unit_id, 'patient.write')) with check (private.has_perm(unit_id, 'patient.write'));
grant select, insert, update on public.opd_visits to authenticated;
create trigger stamp before insert or update on public.opd_visits for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.opd_visits for each row execute function private.audit();

-- ---------------------------------------------------------------- waiting list (bookings) + pre-op checklist
alter table public.surgery_waitlist drop constraint if exists surgery_waitlist_list_type_check;
update public.surgery_waitlist set list_type = 'major' where list_type = 'emergency';
alter table public.surgery_waitlist add constraint surgery_waitlist_list_type_check
  check (list_type in ('major','minor','endoscopy'));
alter table public.surgery_waitlist
  add column if not exists opd_visit_id uuid references public.opd_visits(id),
  add column if not exists priority text not null default 'routine' check (priority in ('routine','urgent','emergency')),
  add column if not exists laterality text check (laterality in ('left','right','bilateral','na')),
  add column if not exists contact_status text not null default 'not_contacted'
    check (contact_status in ('not_contacted','called','willing','not_willing','not_reachable','not_required')),
  add column if not exists contact_attempts int not null default 0,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_contacted_by uuid,
  add column if not exists responsible_pg_person_id uuid references public.unit_personnel(id),
  add column if not exists status_reason text,
  -- pre-op checklist
  add column if not exists indication text,
  add column if not exists investigations_ok boolean not null default false,
  add column if not exists imaging text,
  add column if not exists serology text,
  add column if not exists pac_status text not null default 'pending' check (pac_status in ('pending','fit','fit_high_risk','unfit')),
  add column if not exists physician_status text not null default 'not_needed' check (physician_status in ('not_needed','pending','fit')),
  add column if not exists consent_status text not null default 'pending' check (consent_status in ('pending','taken')),
  add column if not exists blood_status text not null default 'not_needed' check (blood_status in ('not_needed','pending','arranged')),
  add column if not exists anaesthesia_plan text,
  add column if not exists position text,
  add column if not exists preparation text,
  add column if not exists special_instructions text;
alter table public.surgery_waitlist add column if not exists preop_ready boolean generated always as (
  pac_status in ('fit','fit_high_risk') and physician_status <> 'pending' and consent_status = 'taken'
  and blood_status <> 'pending' and investigations_ok) stored;
create index if not exists surgery_waitlist_opd_visit_idx on public.surgery_waitlist (opd_visit_id);
create index if not exists surgery_waitlist_pg_idx on public.surgery_waitlist (responsible_pg_person_id);

-- A booking needs a mobile number to call the patient.
create or replace function private.booking_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and not exists (select 1 from public.patients p where p.id = new.patient_id and nullif(trim(p.phone), '') is not null) then
    raise exception 'Add the patient''s mobile number before booking a procedure.';
  end if;
  if new.status in ('cancelled','postponed') and new.status is distinct from coalesce(old.status, '') and nullif(trim(new.status_reason), '') is null then
    raise exception 'Give a reason when a case is postponed or cancelled.';
  end if;
  return new;
end $$;
create trigger booking_guard before insert or update on public.surgery_waitlist for each row execute function private.booking_guard();

create table public.booking_calls (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.surgery_waitlist(id),
  unit_id uuid not null references public.units(id),
  called_at timestamptz not null default now(),
  called_by uuid default auth.uid(),
  outcome text not null check (outcome in ('called','willing','not_willing','not_reachable','not_required')),
  note text
);
create index booking_calls_booking_idx on public.booking_calls (booking_id, called_at desc);
alter table public.booking_calls enable row level security;
create policy read on public.booking_calls for select to authenticated using (private.has_perm(unit_id, 'ipd.read'));
create policy ins on public.booking_calls for insert to authenticated with check (private.has_perm(unit_id, 'ot.prepare'));
grant select, insert on public.booking_calls to authenticated;
create trigger audit after insert or update or delete on public.booking_calls for each row execute function private.audit();
create trigger append_only before update or delete on public.booking_calls for each row execute function private.no_change();

create or replace function private.booking_call_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.surgery_waitlist set contact_status = new.outcome, contact_attempts = contact_attempts + 1,
         last_contacted_at = new.called_at, last_contacted_by = new.called_by
  where id = new.booking_id;
  return new;
end $$;
create or replace function private.booking_call_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  select w.unit_id into strict new.unit_id from public.surgery_waitlist w where w.id = new.booking_id;
  return new;
end $$;
create trigger booking_call_before before insert on public.booking_calls for each row execute function private.booking_call_before();
create trigger booking_call_after after insert on public.booking_calls for each row execute function private.booking_call_after();

-- Booking writes need ot.prepare (was ipd.write).
drop policy if exists ins on public.surgery_waitlist;
drop policy if exists upd on public.surgery_waitlist;
create policy ins on public.surgery_waitlist for insert to authenticated with check (private.has_perm(unit_id, 'ot.prepare'));
create policy upd on public.surgery_waitlist for update to authenticated
  using (private.has_perm(unit_id, 'ot.prepare')) with check (private.has_perm(unit_id, 'ot.prepare'));

-- ---------------------------------------------------------------- OT lists
create table public.ot_lists (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  service text not null check (service in ('major','minor','endoscopy')),
  list_date date not null,
  ot_room text not null default '',
  session text not null default 'morning' check (session in ('morning','afternoon','evening','emergency')),
  consultant_person_id uuid references public.unit_personnel(id),
  anaesthetist text,
  notes text,
  status text not null default 'draft' check (status in ('draft','final')),
  finalised_by uuid references public.staff(user_id),
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (unit_id, service, list_date, ot_room, session),
  check ((status = 'final') = (finalised_at is not null))
);
create index ot_lists_date_idx on public.ot_lists (unit_id, list_date desc);
create index ot_lists_consultant_idx on public.ot_lists (consultant_person_id);

create table public.ot_cases (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.ot_lists(id),
  unit_id uuid not null references public.units(id),
  booking_id uuid references public.surgery_waitlist(id),
  patient_id uuid references public.patients(id),
  admission_id uuid references public.admissions(id),
  seq int not null default 0,
  -- for a case added by hand (no patient record)
  manual_name text,
  manual_age_sex text,
  manual_ip_op text,
  diagnosis text,
  procedure text not null check (length(trim(procedure)) > 0),
  laterality text check (laterality in ('left','right','bilateral','na')),
  anaesthesia text,
  surgeon text,
  assistants text,
  position text,
  serology text,
  special_requirements text,
  status text not null default 'planned' check (status in ('planned','done','postponed','cancelled')),
  status_reason text,
  -- operation note / endoscopy report
  procedure_done text,
  findings text,
  postop_diagnosis text,
  complications text,
  done_at timestamptz,
  surgery_id uuid references public.surgeries(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (patient_id is not null or nullif(trim(manual_name), '') is not null),
  check (status <> 'done' or (procedure_done is not null and done_at is not null)),
  check (status not in ('postponed','cancelled') or nullif(trim(status_reason), '') is not null)
);
create index ot_cases_list_idx on public.ot_cases (list_id, seq);
create index ot_cases_booking_idx on public.ot_cases (booking_id);
create index ot_cases_patient_idx on public.ot_cases (patient_id);
create index ot_cases_admission_idx on public.ot_cases (admission_id);
create index ot_cases_surgery_idx on public.ot_cases (surgery_id);

do $$ declare t text; begin
  foreach t in array array['ot_lists','ot_cases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (private.has_perm(unit_id, ''ipd.read''))', t);
    execute format('create policy ins on public.%I for insert to authenticated with check (private.has_perm(unit_id, ''ot.prepare''))', t);
    execute format('create policy upd on public.%I for update to authenticated
                    using (private.has_perm(unit_id, ''ot.prepare'')) with check (private.has_perm(unit_id, ''ot.prepare''))', t);
    execute format('create trigger stamp before insert or update on public.%I for each row execute function private.stamp()', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end $$;
grant select, insert, update on public.ot_lists, public.ot_cases to authenticated;

-- Case belongs to its list's unit; a final list cannot be edited (only case outcomes).
create or replace function private.ot_case_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select l.unit_id, l.status into strict new.unit_id, v_status from public.ot_lists l where l.id = new.list_id;
  if v_status = 'final' then
    if tg_op = 'INSERT' then raise exception 'This OT list is final. Reopen it to add cases.'; end if;
    if (new.list_id, new.seq, new.procedure, new.diagnosis, new.anaesthesia, new.surgeon, new.assistants, new.position,
        new.serology, new.special_requirements, new.laterality, new.manual_name)
       is distinct from
       (old.list_id, old.seq, old.procedure, old.diagnosis, old.anaesthesia, old.surgeon, old.assistants, old.position,
        old.serology, old.special_requirements, old.laterality, old.manual_name) then
      raise exception 'This OT list is final. Reopen it to change cases.';
    end if;
  end if;
  return new;
end $$;
create trigger ot_case_guard before insert or update on public.ot_cases for each row execute function private.ot_case_guard();

-- Finalising or reopening needs ot.approve.
create or replace function private.ot_list_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.require_perm(new.unit_id, 'ot.approve');
    if new.status = 'final' then new.finalised_by := auth.uid(); new.finalised_at := now();
    else new.finalised_by := null; new.finalised_at := null; end if;
  elsif old.status = 'final' and (new.list_date, new.ot_room, new.session, new.service)
        is distinct from (old.list_date, old.ot_room, old.session, old.service) then
    raise exception 'This OT list is final. Reopen it to change it.';
  end if;
  return new;
end $$;
create trigger ot_list_guard before update on public.ot_lists for each row execute function private.ot_list_guard();

-- Add a waiting-list booking to an OT list: copies its details, schedules the booking.
create or replace function public.add_booking_to_list(p_list uuid, p_booking uuid)
returns uuid language plpgsql set search_path = '' as $$
declare l public.ot_lists; b public.surgery_waitlist; v_id uuid; v_seq int;
begin
  select * into strict l from public.ot_lists where id = p_list;
  perform private.require_perm(l.unit_id, 'ot.prepare');
  select * into strict b from public.surgery_waitlist where id = p_booking and unit_id = l.unit_id for update;
  if b.status not in ('waiting','postponed','scheduled') then raise exception 'This booking is %', b.status; end if;
  if b.list_type <> l.service then raise exception 'This booking is for a different list.'; end if;
  if exists (select 1 from public.ot_cases c where c.booking_id = b.id and c.status = 'planned') then
    raise exception 'This patient is already on an OT list.';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.ot_cases where list_id = p_list;
  insert into public.ot_cases (list_id, booking_id, patient_id, admission_id, seq, diagnosis, procedure, laterality,
                               anaesthesia, position, serology, special_requirements)
  values (p_list, b.id, b.patient_id,
          coalesce(b.admission_id, (select a.id from public.admissions a where a.patient_id = b.patient_id and a.unit_id = l.unit_id and a.status = 'admitted' limit 1)),
          v_seq, b.diagnosis, b.planned_procedure, b.laterality, b.anaesthesia_plan, b.position, b.serology,
          nullif(concat_ws('; ', b.special_instructions, b.preparation), ''))
  returning id into v_id;
  update public.surgery_waitlist set status = 'scheduled', planned_date = l.list_date, status_reason = null where id = b.id;
  return v_id;
end $$;

-- Outcome of a case: done (with operation note), postponed or cancelled (with reason).
-- Done also records the surgery on the active admission (drives the post-op day).
create or replace function public.set_ot_case_outcome(p_case uuid, p_status text, p_reason text default null,
  p_note jsonb default '{}')
returns void language plpgsql set search_path = '' as $$
declare c public.ot_cases; l public.ot_lists; v_surgery uuid; v_adm uuid;
begin
  select * into strict c from public.ot_cases where id = p_case for update;
  select * into strict l from public.ot_lists where id = c.list_id;
  perform private.require_perm(c.unit_id, 'ot.prepare');
  if p_status not in ('planned','done','postponed','cancelled') then raise exception 'Unknown outcome %', p_status; end if;
  if p_status = 'done' then
    v_adm := coalesce(c.admission_id, (select a.id from public.admissions a where a.patient_id = c.patient_id
                                       and a.unit_id = c.unit_id and a.status = 'admitted' limit 1));
    if v_adm is not null and c.surgery_id is null and l.service <> 'endoscopy' then
      insert into public.surgeries (admission_id, waitlist_id, surgery_date, urgency, procedure_done, surgeon, assistants,
                                    anaesthesia, findings, complications)
      values (v_adm, c.booking_id, l.list_date,
              case when l.session = 'emergency' then 'emergency' else 'elective' end,
              coalesce(nullif(trim(p_note->>'procedure_done'), ''), c.procedure), c.surgeon, c.assistants, c.anaesthesia,
              nullif(trim(p_note->>'findings'), ''), nullif(trim(p_note->>'complications'), ''))
      returning id into v_surgery;
    end if;
    update public.ot_cases set status = 'done', status_reason = null, done_at = now(), admission_id = coalesce(admission_id, v_adm),
           procedure_done = coalesce(nullif(trim(p_note->>'procedure_done'), ''), procedure),
           findings = nullif(trim(p_note->>'findings'), ''), postop_diagnosis = nullif(trim(p_note->>'postop_diagnosis'), ''),
           complications = nullif(trim(p_note->>'complications'), ''), surgery_id = coalesce(surgery_id, v_surgery)
    where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'completed', status_reason = null where id = c.booking_id;
    end if;
  elsif p_status in ('postponed','cancelled') then
    if nullif(trim(p_reason), '') is null then raise exception 'Give a reason.'; end if;
    update public.ot_cases set status = p_status, status_reason = trim(p_reason) where id = c.id;
    if c.booking_id is not null then
      -- postponed goes back to the waiting list; cancelled on the day also returns it (the booking stays open)
      update public.surgery_waitlist set status = 'postponed', status_reason = trim(p_reason) where id = c.booking_id;
    end if;
  else
    if c.status = 'done' then raise exception 'A completed case cannot be reopened here.'; end if;
    update public.ot_cases set status = 'planned', status_reason = null where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'scheduled', status_reason = null where id = c.booking_id;
    end if;
  end if;
end $$;

-- Reorder cases on a list.
create or replace function public.reorder_ot_cases(p_list uuid, p_ids uuid[])
returns void language plpgsql set search_path = '' as $$
declare l public.ot_lists; i int;
begin
  select * into strict l from public.ot_lists where id = p_list;
  perform private.require_perm(l.unit_id, 'ot.prepare');
  if l.status = 'final' then raise exception 'This OT list is final. Reopen it to change the order.'; end if;
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.ot_cases set seq = i where id = p_ids[i] and list_id = p_list;
  end loop;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.add_booking_to_list(uuid, uuid)','public.set_ot_case_outcome(uuid, text, text, jsonb)',
                           'public.reorder_ot_cases(uuid, uuid[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- investigations
alter table public.investigations
  add column if not exists assigned_person_id uuid references public.unit_personnel(id),
  add column if not exists collected_at timestamptz,
  add column if not exists collected_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists document_id uuid references public.documents(id);
create index if not exists investigations_assigned_idx on public.investigations (assigned_person_id);
create index if not exists investigations_document_idx on public.investigations (document_id);
create index if not exists investigations_pending_idx on public.investigations (unit_id) where status = 'pending' or reviewed_at is null;

-- Interns may mark a report collected (they cannot otherwise write investigations).
create or replace function public.mark_investigation_collected(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_unit uuid;
begin
  select unit_id into strict v_unit from public.investigations where id = p_id;
  perform private.require_perm(v_unit, 'task.update');
  update public.investigations set collected_at = now(), collected_by = auth.uid() where id = p_id and collected_at is null;
end $$;
revoke execute on function public.mark_investigation_collected(uuid) from public, anon;
grant execute on function public.mark_investigation_collected(uuid) to authenticated;

-- ---------------------------------------------------------------- tasks
alter table public.care_tasks drop constraint if exists care_tasks_check;
alter table public.care_tasks drop constraint if exists care_tasks_status_check;
alter table public.care_tasks drop constraint if exists care_tasks_kind_check;
alter table public.care_tasks alter column admission_id drop not null;
alter table public.care_tasks
  add column if not exists assigned_person_id uuid references public.unit_personnel(id),
  add column if not exists due_on date,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid;
alter table public.care_tasks add constraint care_tasks_status_check
  check (status in ('open','in_progress','done','verified','cancelled'));
alter table public.care_tasks add constraint care_tasks_kind_check
  check (kind in ('task','investigation','dressing','preop','ot_list','opd','records','admin'));
alter table public.care_tasks add constraint care_tasks_closed_check
  check ((status in ('open','in_progress')) = (closed_at is null));
alter table public.care_tasks add constraint care_tasks_verified_check
  check ((status = 'verified') = (verified_at is not null));
create index if not exists care_tasks_assigned_idx on public.care_tasks (assigned_person_id) where status in ('open','in_progress');
create index if not exists care_tasks_unit_open_idx on public.care_tasks (unit_id) where status in ('open','in_progress','done');

-- unit comes from the admission when there is one; unit-level tasks give it directly.
create or replace function private.task_unit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.admission_id is not null then
    select a.unit_id into strict new.unit_id from public.admissions a where a.id = new.admission_id;
  elsif new.unit_id is null then
    raise exception 'A task needs a patient or a unit.';
  end if;
  return new;
end $$;
drop trigger if exists unit_from_admission on public.care_tasks;
create trigger unit_from_admission before insert or update of admission_id on public.care_tasks
  for each row execute function private.task_unit();

-- Status changes: anyone with round.write, or the assignee with task.update; verifying needs task.verify.
create or replace function public.set_task_status(p_task uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.care_tasks; v_mine boolean;
begin
  select * into strict t from public.care_tasks where id = p_task for update;
  if p_status not in ('open','in_progress','done','verified','cancelled') then raise exception 'Unknown status %', p_status; end if;
  v_mine := coalesce(t.assigned_person_id in (select private.my_person_ids(t.unit_id)), false);
  if p_status = 'verified' then
    perform private.require_perm(t.unit_id, 'task.verify');
    if t.status <> 'done' then raise exception 'Only a completed task can be verified.'; end if;
  elsif not (private.has_perm(t.unit_id, 'round.write') or (v_mine and private.has_perm(t.unit_id, 'task.update'))) then
    raise exception 'permission denied: this task is not assigned to you' using errcode = '42501';
  elsif t.status = 'verified' then
    perform private.require_perm(t.unit_id, 'task.verify');
  end if;
  update public.care_tasks set status = p_status,
    closed_at = case when p_status in ('open','in_progress') then null else coalesce(closed_at, now()) end,
    closed_by = case when p_status in ('open','in_progress') then null else coalesce(closed_by, auth.uid()) end,
    verified_at = case when p_status = 'verified' then now() end,
    verified_by = case when p_status = 'verified' then auth.uid() end
  where id = t.id;
end $$;
revoke execute on function public.set_task_status(uuid, text) from public, anon;
grant execute on function public.set_task_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------- views
create or replace view public.v_waiting_list with (security_invoker = true) as
select w.id, w.unit_id, w.patient_id, w.admission_id, w.list_type, w.priority, w.diagnosis, w.planned_procedure, w.laterality,
       w.planned_date, w.status, w.status_reason, w.contact_status, w.contact_attempts, w.last_contacted_at, w.created_at,
       w.preop_ready, w.pac_status, w.physician_status, w.consent_status, w.blood_status, w.investigations_ok,
       w.responsible_pg_person_id, pg.full_name as pg_name,
       p.full_name, p.uhid, p.age_years, p.sex, p.phone, p.phone_2, p.op_number,
       a.ip_number, a.status = 'admitted' as is_admitted, b.label as bed, wd.name as ward,
       (select c.list_id from public.ot_cases c where c.booking_id = w.id and c.status = 'planned' limit 1) as on_list_id
from public.surgery_waitlist w
join public.patients p on p.id = w.patient_id
left join public.unit_personnel pg on pg.id = w.responsible_pg_person_id
left join lateral (select x.* from public.admissions x where x.patient_id = w.patient_id and x.unit_id = w.unit_id
                   order by (x.status = 'admitted') desc, x.admitted_at desc limit 1) a on true
left join public.bed_assignments ba on ba.admission_id = a.id and ba.to_at is null and a.status = 'admitted'
left join public.ward_beds b on b.id = ba.bed_id
left join public.wards wd on wd.id = b.ward_id;

grant select on public.v_waiting_list to authenticated;

-- v_inpatients: open tasks include in-progress ones; team names appended.
create or replace view public.v_inpatients with (security_invoker = true) as
select a.id as admission_id, a.unit_id, a.ip_number, a.admitted_at, a.admission_type, a.planned_discharge_on,
       a.consultant_id, coalesce(pgp.user_id, a.assigned_pg_id) as assigned_pg_id,
       p.id as patient_id, p.uhid, p.full_name, p.age_years, p.date_of_birth, p.sex,
       case when p.allergy_status = 'no' then null else p.allergies end as allergies,
       b.id as bed_id, b.label as bed, w.id as ward_id, w.name as ward, w.kind as ward_kind, w.sort_order as ward_sort,
       b.sort_order as bed_sort,
       (select d.description from public.diagnoses d where d.admission_id = a.id
        order by (d.kind = 'final') desc, d.created_at desc limit 1) as diagnosis,
       lr.clinical_status as last_status, lr.round_at as last_round_at,
       (select count(*) from public.ward_round_entries r where r.admission_id = a.id
        and (r.round_at at time zone 'Asia/Kolkata')::date = private.today_ist())::int as rounds_today,
       (select count(*) from public.ward_round_entries r where r.admission_id = a.id
        and (r.round_at at time zone 'Asia/Kolkata')::date = private.today_ist() and r.verified_at is null)::int as unverified_today,
       (select count(*) from public.care_tasks t where t.admission_id = a.id and t.status in ('open','in_progress'))::int as open_tasks,
       (select private.today_ist() - max(s.surgery_date) from public.surgeries s
        where s.admission_id = a.id and s.verified_at is not null and s.surgery_date <= private.today_ist()) as postop_day,
       exists (select 1 from public.surgeries s where s.admission_id = a.id) as is_postop,
       exists (select 1 from public.surgery_waitlist wl where wl.patient_id = a.patient_id and wl.unit_id = a.unit_id
               and wl.status in ('waiting','scheduled','postponed')) as awaiting_surgery,
       cp.full_name as consultant_name, pgp.full_name as pg_name, a.pg_person_id,
       app.full_name as asst_prof_name, itp.full_name as intern_name, a.intern_person_id,
       (select count(*) from public.investigations i where i.admission_id = a.id and i.status = 'pending')::int as pending_tests,
       (select wl.planned_date from public.surgery_waitlist wl where wl.patient_id = a.patient_id and wl.unit_id = a.unit_id
        and wl.status in ('waiting','scheduled','postponed') order by wl.planned_date nulls last limit 1) as surgery_planned_on,
       (select bool_and(wl.preop_ready) from public.surgery_waitlist wl where wl.patient_id = a.patient_id and wl.unit_id = a.unit_id
        and wl.status in ('waiting','scheduled','postponed')) as preop_ready
from public.admissions a
join public.patients p on p.id = a.patient_id
left join public.bed_assignments ba on ba.admission_id = a.id and ba.to_at is null
left join public.ward_beds b on b.id = ba.bed_id
left join public.wards w on w.id = b.ward_id
left join public.unit_personnel cp on cp.id = a.consultant_person_id
left join public.unit_personnel pgp on pgp.id = a.pg_person_id
left join public.unit_personnel app on app.id = a.asst_prof_person_id
left join public.unit_personnel itp on itp.id = a.intern_person_id
left join lateral (select r.clinical_status, r.round_at from public.ward_round_entries r
                   where r.admission_id = a.id order by r.round_at desc limit 1) lr on true
where a.status = 'admitted';

-- ---------------------------------------------------------------- realtime
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['opd_visits','surgery_waitlist','ot_lists','ot_cases','care_tasks','investigations','booking_calls'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
