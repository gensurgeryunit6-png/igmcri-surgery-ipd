-- Surgery Unit OS · 0003 ward rounds, care tasks and the inpatient census
-- Ward-round entries are append-only: corrections are amendments, never edits.
-- Rollback: drop the views, functions and tables created here.

create or replace function private.today_ist() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant execute on function private.today_ist() to authenticated;

create table public.ward_round_entries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  round_at timestamptz not null default now(),
  round_type text not null default 'morning' check (round_type in ('morning','evening','consultant','night','other')),
  postop_day int,
  complaints text,
  clinical_status text not null check (clinical_status in ('stable','improving','worsening','critical','close_monitoring')),
  vitals jsonb not null default '{}',
  general_exam text,
  systemic_exam text,
  investigation_summary text,
  current_treatment text,
  assessment text,
  plan text,
  consultant_instructions text,
  discharge_plan text,
  entered_by uuid not null default auth.uid() references public.staff(user_id),
  created_at timestamptz not null default now(),
  verified_by uuid references public.staff(user_id),
  verified_at timestamptz,
  check ((verified_by is null) = (verified_at is null))
);
create index on public.ward_round_entries (admission_id, round_at desc);
create index on public.ward_round_entries (unit_id, round_at desc);

create table public.ward_round_amendments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.ward_round_entries(id),
  unit_id uuid not null references public.units(id),
  field text not null check (field in ('complaints','clinical_status','vitals','general_exam','systemic_exam',
    'investigation_summary','current_treatment','assessment','plan','consultant_instructions','discharge_plan')),
  old_value text,
  new_value text,
  reason text not null check (length(trim(reason)) >= 3),
  amended_by uuid not null default auth.uid() references public.staff(user_id),
  amended_at timestamptz not null default now()
);
create index on public.ward_round_amendments (entry_id);

create table public.care_tasks (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  kind text not null default 'task' check (kind in ('task','investigation')),
  description text not null check (length(trim(description)) > 0),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  raised_entry_id uuid references public.ward_round_entries(id),
  closed_entry_id uuid references public.ward_round_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  closed_at timestamptz,
  closed_by uuid,
  check ((status = 'open') = (closed_at is null))
);
create index on public.care_tasks (admission_id) where status = 'open';

-- ---------------------------------------------------------------- triggers
create or replace function private.round_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare v_surgery date;
begin
  select a.unit_id into strict new.unit_id from public.admissions a where a.id = new.admission_id;
  if not exists (select 1 from public.admissions a where a.id = new.admission_id and a.status = 'admitted') then
    raise exception 'Ward rounds can only be added to an active admission.';
  end if;
  new.entered_by := auth.uid();
  new.created_at := now();
  new.verified_by := null;
  new.verified_at := null;
  -- Postoperative day from the latest VERIFIED surgery on or before the round date.
  select max(s.surgery_date) into v_surgery from public.surgeries s
  where s.admission_id = new.admission_id and s.verified_at is not null
    and s.surgery_date <= (new.round_at at time zone 'Asia/Kolkata')::date;
  new.postop_day := case when v_surgery is null then null
                         else (new.round_at at time zone 'Asia/Kolkata')::date - v_surgery end;
  return new;
end $$;
create trigger round_before_insert before insert on public.ward_round_entries
  for each row execute function private.round_before_insert();

-- Only change ever allowed: setting verification once.
create or replace function private.round_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Ward-round entries cannot be deleted. Add an amendment instead.';
  end if;
  if old.verified_at is not null
     or new.verified_at is null
     or (to_jsonb(new) - 'verified_by' - 'verified_at') <> (to_jsonb(old) - 'verified_by' - 'verified_at') then
    raise exception 'Ward-round entries cannot be edited. Add an amendment instead.';
  end if;
  perform private.require_perm(old.unit_id, 'round.verify');
  new.verified_by := auth.uid();
  new.verified_at := now();
  return new;
end $$;
create trigger round_append_only before update or delete on public.ward_round_entries
  for each row execute function private.round_append_only();

create or replace function private.amendment_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare e public.ward_round_entries;
begin
  select * into strict e from public.ward_round_entries where id = new.entry_id;
  new.unit_id := e.unit_id;
  new.amended_by := auth.uid();
  new.amended_at := now();
  -- old_value is the value currently in force: the latest amendment, else the original.
  select a.new_value into new.old_value from public.ward_round_amendments a
  where a.entry_id = new.entry_id and a.field = new.field order by a.amended_at desc limit 1;
  if not found then
    new.old_value := to_jsonb(e) ->> new.field;
  end if;
  if new.field = 'clinical_status' and new.new_value not in ('stable','improving','worsening','critical','close_monitoring') then
    raise exception 'Invalid clinical status %', new.new_value;
  end if;
  return new;
end $$;
create trigger amendment_before_insert before insert on public.ward_round_amendments
  for each row execute function private.amendment_before_insert();

create or replace function private.no_change()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger append_only before update or delete on public.ward_round_amendments
  for each row execute function private.no_change();

create trigger unit_from_admission before insert or update of admission_id on public.care_tasks
  for each row execute function private.unit_from_admission();

do $$ declare t text; begin
  foreach t in array array['ward_round_entries','ward_round_amendments','care_tasks'] loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function private.audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated
                    using (private.has_perm(unit_id, ''ipd.read''))', t);
  end loop;
end $$;

-- unit_id is filled by the BEFORE trigger, which runs before WITH CHECK, so the
-- policies below see the admission's real unit.
create policy ins on public.ward_round_entries for insert to authenticated
  with check (private.has_perm(unit_id, 'round.write'));
create policy verify on public.ward_round_entries for update to authenticated
  using (private.has_perm(unit_id, 'round.verify')) with check (private.has_perm(unit_id, 'round.verify'));
create policy ins on public.ward_round_amendments for insert to authenticated
  with check (private.has_perm(unit_id, 'round.amend'));
create policy ins on public.care_tasks for insert to authenticated
  with check (private.has_perm(unit_id, 'round.write'));
create policy upd on public.care_tasks for update to authenticated
  using (private.has_perm(unit_id, 'round.write')) with check (private.has_perm(unit_id, 'round.write'));

grant select, insert, update on public.ward_round_entries, public.care_tasks to authenticated;
grant select, insert on public.ward_round_amendments to authenticated;

-- ---------------------------------------------------------------- round workflow
-- Adds one round entry, raises new tasks and closes completed ones, atomically.
-- p_entry: {admission_id, round_at?, round_type?, complaints, clinical_status, vitals{}, ...}
create or replace function public.add_ward_round(p_entry jsonb, p_new_tasks jsonb default '[]',
                                                 p_closed_task_ids uuid[] default '{}')
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid; v_adm uuid := (p_entry->>'admission_id')::uuid; t jsonb;
begin
  insert into public.ward_round_entries (admission_id, round_at, round_type, complaints, clinical_status, vitals,
    general_exam, systemic_exam, investigation_summary, current_treatment, assessment, plan,
    consultant_instructions, discharge_plan)
  values (v_adm, coalesce((p_entry->>'round_at')::timestamptz, now()), coalesce(p_entry->>'round_type', 'morning'),
    p_entry->>'complaints', p_entry->>'clinical_status', coalesce(p_entry->'vitals', '{}'),
    p_entry->>'general_exam', p_entry->>'systemic_exam', p_entry->>'investigation_summary',
    p_entry->>'current_treatment', p_entry->>'assessment', p_entry->>'plan',
    p_entry->>'consultant_instructions', p_entry->>'discharge_plan')
  returning id into v_id;

  for t in select * from jsonb_array_elements(coalesce(p_new_tasks, '[]')) loop
    insert into public.care_tasks (admission_id, kind, description, raised_entry_id)
    values (v_adm, coalesce(t->>'kind', 'task'), t->>'description', v_id);
  end loop;

  update public.care_tasks set status = 'done', closed_entry_id = v_id, closed_at = now(), closed_by = auth.uid()
  where id = any(p_closed_task_ids) and admission_id = v_adm and status = 'open';
  return v_id;
end $$;

create or replace function public.verify_ward_round(p_entry_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  update public.ward_round_entries set verified_at = now(), verified_by = auth.uid()
  where id = p_entry_id and verified_at is null;
  if not found then raise exception 'Entry not found or already verified.'; end if;
end $$;

grant execute on function public.add_ward_round(jsonb, jsonb, uuid[]), public.verify_ward_round(uuid) to authenticated;
revoke execute on function public.add_ward_round(jsonb, jsonb, uuid[]), public.verify_ward_round(uuid) from public, anon;

-- ---------------------------------------------------------------- views (respect the caller's RLS)
create view public.v_inpatients with (security_invoker = true) as
select a.id as admission_id, a.unit_id, a.ip_number, a.admitted_at, a.admission_type, a.planned_discharge_on,
       a.consultant_id, a.assigned_pg_id,
       p.id as patient_id, p.uhid, p.full_name, p.age_years, p.date_of_birth, p.sex, p.allergies,
       b.id as bed_id, b.label as bed, w.id as ward_id, w.name as ward, w.kind as ward_kind, w.sort_order as ward_sort,
       b.sort_order as bed_sort,
       (select d.description from public.diagnoses d where d.admission_id = a.id
        order by (d.kind = 'final') desc, d.created_at desc limit 1) as diagnosis,
       lr.clinical_status as last_status, lr.round_at as last_round_at,
       (select count(*) from public.ward_round_entries r where r.admission_id = a.id
        and (r.round_at at time zone 'Asia/Kolkata')::date = private.today_ist())::int as rounds_today,
       (select count(*) from public.ward_round_entries r where r.admission_id = a.id
        and (r.round_at at time zone 'Asia/Kolkata')::date = private.today_ist() and r.verified_at is null)::int as unverified_today,
       (select count(*) from public.care_tasks t where t.admission_id = a.id and t.status = 'open')::int as open_tasks,
       (select private.today_ist() - max(s.surgery_date) from public.surgeries s
        where s.admission_id = a.id and s.verified_at is not null and s.surgery_date <= private.today_ist()) as postop_day,
       exists (select 1 from public.surgeries s where s.admission_id = a.id) as is_postop,
       exists (select 1 from public.surgery_waitlist wl where wl.admission_id = a.id
               and wl.status in ('waiting','scheduled','postponed')) as awaiting_surgery
from public.admissions a
join public.patients p on p.id = a.patient_id
left join public.bed_assignments ba on ba.admission_id = a.id and ba.to_at is null
left join public.ward_beds b on b.id = ba.bed_id
left join public.wards w on w.id = b.ward_id
left join lateral (select r.clinical_status, r.round_at from public.ward_round_entries r
                   where r.admission_id = a.id order by r.round_at desc limit 1) lr on true
where a.status = 'admitted';

create view public.v_census_today with (security_invoker = true) as
select u.id as unit_id,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id)::int as total_admitted,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.ward_kind = 'male')::int as male_ward,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.ward_kind = 'female')::int as female_ward,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.ward_kind = 'special')::int as special_ward,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.ward_kind in ('emergency','other'))::int as other_beds,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.bed_id is null)::int as no_bed,
  (select count(*) from public.admissions a where a.unit_id = u.id
     and (a.admitted_at at time zone 'Asia/Kolkata')::date = private.today_ist())::int as new_admissions,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.is_postop)::int as postoperative,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.last_status = 'critical')::int as critical,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.awaiting_surgery)::int as awaiting_surgery,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.planned_discharge_on <= private.today_ist())::int as planned_discharge,
  (select count(*) from public.admissions a where a.unit_id = u.id and a.status <> 'admitted'
     and (a.discharged_at at time zone 'Asia/Kolkata')::date = private.today_ist())::int as discharged_today,
  (select count(*) from public.v_inpatients i where i.unit_id = u.id and i.rounds_today = 0)::int as rounds_pending
from public.units u
where private.has_perm(u.id, 'ipd.read');

grant select on public.v_inpatients, public.v_census_today to authenticated;
