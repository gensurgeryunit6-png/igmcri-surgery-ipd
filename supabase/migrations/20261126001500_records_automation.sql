-- Surgery Unit OS · 0015 automation base, missing clinical records, statistics.
-- * workflow_events (outbox with dedupe), workflow_logs, pending_actions; automation.* functions for n8n
--   (granted to an n8n role only when n8n is set up).
-- * dressing_records, investigation_results (serial results), USG as a service.
-- * Statistics views for weekly, monthly, occupancy and activity reports.
-- Rollback: drop the new tables, views, triggers and schema automation; restore checks and set_ot_case_outcome from 0014.

-- ---------------------------------------------------------------- outbox and logs
create table public.workflow_events (
  id bigint generated always as identity primary key,
  unit_id uuid not null references public.units(id),
  event_type text not null,
  entity_table text not null,
  entity_id uuid not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','done','failed','skipped')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text
);
create index workflow_events_pending_idx on public.workflow_events (created_at) where status in ('pending','failed');
create index workflow_events_unit_idx on public.workflow_events (unit_id, created_at desc);
alter table public.workflow_events enable row level security;
create policy read on public.workflow_events for select to authenticated using (private.has_perm(unit_id, 'audit.read'));
grant select on public.workflow_events to authenticated;

create table public.workflow_logs (
  id bigint generated always as identity primary key,
  unit_id uuid references public.units(id),
  workflow text not null,
  event_id bigint references public.workflow_events(id),
  run_id text,
  status text not null check (status in ('started','success','error','retry')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  details jsonb not null default '{}'
);
create index workflow_logs_event_idx on public.workflow_logs (event_id);
create index workflow_logs_unit_idx on public.workflow_logs (unit_id, started_at desc);
alter table public.workflow_logs enable row level security;
create policy read on public.workflow_logs for select to authenticated using (unit_id is not null and private.has_perm(unit_id, 'audit.read'));
grant select on public.workflow_logs to authenticated;

-- Proposed changes from Claude wait here until the clinician confirms.
create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  created_by uuid not null default auth.uid() references public.staff(user_id),
  action text not null,
  params jsonb not null default '{}',
  preview text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','expired','failed')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
create index pending_actions_user_idx on public.pending_actions (created_by, created_at desc);
create index pending_actions_unit_idx on public.pending_actions (unit_id);
alter table public.pending_actions enable row level security;
create policy read on public.pending_actions for select to authenticated using (created_by = auth.uid());
grant select on public.pending_actions to authenticated;
create trigger audit after insert or update or delete on public.pending_actions for each row execute function private.audit();

-- Emit an event once (dedupe key unique).
create or replace function private.emit_event(p_unit uuid, p_type text, p_table text, p_id uuid, p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.workflow_events (unit_id, event_type, entity_table, entity_id, dedupe_key)
  values (p_unit, p_type, p_table, p_id, p_key) on conflict (dedupe_key) do nothing
$$;

create or replace function private.events_admissions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.emit_event(new.unit_id, 'admission.created', 'admissions', new.id, 'admission.created:' || new.id);
  elsif old.status = 'admitted' and new.status <> 'admitted' then
    perform private.emit_event(new.unit_id, 'admission.closed', 'admissions', new.id, 'admission.closed:' || new.id);
  end if;
  return null;
end $$;
create trigger zz_events after insert or update of status on public.admissions for each row execute function private.events_admissions();

create or replace function private.events_ot_lists()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'final' and old.status is distinct from 'final' then
    perform private.emit_event(new.unit_id, 'ot_list.finalised', 'ot_lists', new.id, 'ot_list.finalised:' || new.id || ':' || new.finalised_at);
  end if;
  return null;
end $$;
create trigger zz_events after update of status on public.ot_lists for each row execute function private.events_ot_lists();

create or replace function private.events_investigations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.emit_event(new.unit_id, 'investigation.ordered', 'investigations', new.id, 'investigation.ordered:' || new.id);
  elsif new.resulted_at is distinct from old.resulted_at and new.resulted_at is not null then
    perform private.emit_event(new.unit_id, 'investigation.resulted', 'investigations', new.id, 'investigation.resulted:' || new.id || ':' || new.resulted_at);
  end if;
  return null;
end $$;
create trigger zz_events after insert or update of resulted_at on public.investigations for each row execute function private.events_investigations();

create or replace function private.events_discharge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_event(new.unit_id, 'discharge.started', 'discharge_summaries', new.admission_id, 'discharge.started:' || new.admission_id);
  return null;
end $$;
create trigger zz_events after insert on public.discharge_summaries for each row execute function private.events_discharge();

-- Functions n8n will call (schema not exposed over the API; granted to the n8n role when it is created).
create schema if not exists automation;
revoke all on schema automation from public;

create or replace function automation.claim_events(p_limit int default 20)
returns setof public.workflow_events language sql security definer set search_path = '' as $$
  update public.workflow_events e set status = 'processing', attempts = e.attempts + 1, claimed_at = now()
  where e.id in (select x.id from public.workflow_events x
                 where x.status = 'pending' or (x.status = 'failed' and x.attempts < 3)
                    or (x.status = 'processing' and x.claimed_at < now() - interval '15 minutes' and x.attempts < 3)
                 order by x.id limit p_limit for update skip locked)
  returning e.*
$$;

create or replace function automation.complete_event(p_id bigint, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.workflow_events set status = case when p_ok then 'done' else 'failed' end,
    processed_at = now(), last_error = case when p_ok then null else left(p_error, 2000) end
  where id = p_id
$$;

create or replace function automation.log_run(p_workflow text, p_status text, p_event bigint default null, p_unit uuid default null,
  p_run_id text default null, p_error text default null, p_details jsonb default '{}')
returns bigint language sql security definer set search_path = '' as $$
  insert into public.workflow_logs (unit_id, workflow, event_id, run_id, status, finished_at, error, details)
  values (coalesce(p_unit, (select unit_id from public.workflow_events where id = p_event)), p_workflow, p_event, p_run_id, p_status,
          case when p_status in ('success','error') then now() end, left(p_error, 2000), coalesce(p_details, '{}'))
  returning id
$$;
revoke execute on all functions in schema automation from public, anon, authenticated;

-- ---------------------------------------------------------------- dressing records
create table public.dressing_records (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  done_at timestamptz not null default now(),
  site text not null check (length(trim(site)) > 0),
  wound_status text not null default 'healthy' check (wound_status in ('healthy','serous','slough','infected','gaping','other')),
  findings text,
  dressing_used text,
  done_by_person_id uuid references public.unit_personnel(id),
  supervised_by_person_id uuid references public.unit_personnel(id),
  document_id uuid references public.documents(id),
  task_id uuid references public.care_tasks(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index dressing_records_adm_idx on public.dressing_records (admission_id, done_at desc);
create index dressing_records_unit_idx on public.dressing_records (unit_id);
create index dressing_records_done_by_idx on public.dressing_records (done_by_person_id);
create index dressing_records_sup_idx on public.dressing_records (supervised_by_person_id);
create index dressing_records_doc_idx on public.dressing_records (document_id);
create index dressing_records_task_idx on public.dressing_records (task_id);
alter table public.dressing_records enable row level security;
create policy read on public.dressing_records for select to authenticated using (private.has_perm(unit_id, 'ipd.read'));
create policy ins on public.dressing_records for insert to authenticated with check (private.has_perm(unit_id, 'task.update'));
create policy upd on public.dressing_records for update to authenticated
  using (private.has_perm(unit_id, 'round.write')) with check (private.has_perm(unit_id, 'round.write'));
grant select, insert, update on public.dressing_records to authenticated;
create trigger unit_from_admission before insert or update of admission_id on public.dressing_records for each row execute function private.unit_from_admission();
create trigger stamp before insert or update on public.dressing_records for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.dressing_records for each row execute function private.audit();

-- ---------------------------------------------------------------- serial investigation results
create table public.investigation_results (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  value text not null check (length(trim(value)) > 0),
  abnormal boolean not null default false,
  resulted_at timestamptz not null default now(),
  document_id uuid references public.documents(id),
  entered_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index investigation_results_inv_idx on public.investigation_results (investigation_id, resulted_at desc);
create index investigation_results_adm_idx on public.investigation_results (admission_id);
create index investigation_results_unit_idx on public.investigation_results (unit_id);
create index investigation_results_doc_idx on public.investigation_results (document_id);
alter table public.investigation_results enable row level security;
create policy read on public.investigation_results for select to authenticated using (private.has_perm(unit_id, 'ipd.read'));
create policy ins on public.investigation_results for insert to authenticated with check (private.has_perm(unit_id, 'ipd.write'));
grant select, insert on public.investigation_results to authenticated;

create or replace function private.result_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  select i.admission_id, i.unit_id into strict new.admission_id, new.unit_id from public.investigations i where i.id = new.investigation_id;
  return new;
end $$;
create or replace function private.result_after()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- the order shows its latest result
  update public.investigations i set status = 'resulted', result = new.value, abnormal = new.abnormal, resulted_at = new.resulted_at,
         reviewed_at = null, reviewed_by = null
  where i.id = new.investigation_id and (i.resulted_at is null or i.resulted_at < new.resulted_at);
  return null;
end $$;
create trigger result_before before insert on public.investigation_results for each row execute function private.result_before();
create trigger result_after after insert on public.investigation_results for each row execute function private.result_after();
create trigger append_only before update or delete on public.investigation_results for each row execute function private.no_change();
create trigger audit after insert or update or delete on public.investigation_results for each row execute function private.audit();

insert into public.investigation_results (investigation_id, admission_id, unit_id, value, abnormal, resulted_at, entered_by)
select i.id, i.admission_id, i.unit_id, i.result, coalesce(i.abnormal, false), coalesce(i.resulted_at, i.ordered_at), null
from public.investigations i where i.status = 'resulted' and nullif(trim(i.result), '') is not null;

-- ---------------------------------------------------------------- USG as a service
alter table public.surgery_waitlist drop constraint if exists surgery_waitlist_list_type_check;
alter table public.surgery_waitlist add constraint surgery_waitlist_list_type_check check (list_type in ('major','minor','endoscopy','usg'));
alter table public.ot_lists drop constraint if exists ot_lists_service_check;
alter table public.ot_lists add constraint ot_lists_service_check check (service in ('major','minor','endoscopy','usg'));

-- Endoscopy and USG are reported on the case, not recorded as surgery.
create or replace function public.set_ot_case_outcome(p_case uuid, p_status text, p_reason text default null,
  p_note jsonb default '{}')
returns void language plpgsql set search_path = '' as $$
declare c public.ot_cases; l public.ot_lists; v_surgery uuid; v_adm uuid;
  n jsonb := coalesce(p_note, '{}');
begin
  select * into strict c from public.ot_cases where id = p_case for update;
  select * into strict l from public.ot_lists where id = c.list_id;
  perform private.require_perm(c.unit_id, 'ot.prepare');
  if p_status not in ('planned','done','postponed','cancelled') then raise exception 'Unknown outcome %', p_status; end if;
  if p_status = 'done' then
    v_adm := coalesce(c.admission_id, (select a.id from public.admissions a where a.patient_id = c.patient_id
                                       and a.unit_id = c.unit_id and a.status = 'admitted' limit 1));
    if v_adm is not null and c.surgery_id is null and l.service not in ('endoscopy','usg') then
      insert into public.surgeries (admission_id, waitlist_id, surgery_date, urgency, procedure_done, surgeon, assistants,
        anaesthesia, findings, complications, start_time, end_time, anaesthetist, position, incision, procedure_steps, implants,
        specimen, drains, blood_loss_ml, closure, postop_diagnosis, postop_instructions)
      values (v_adm, c.booking_id, l.list_date,
              case when l.session = 'emergency' then 'emergency' else 'elective' end,
              coalesce(nullif(trim(n->>'procedure_done'), ''), c.procedure),
              coalesce(nullif(trim(n->>'surgeon'), ''), c.surgeon), coalesce(nullif(trim(n->>'assistants'), ''), c.assistants),
              coalesce(nullif(trim(n->>'anaesthesia'), ''), c.anaesthesia),
              nullif(trim(n->>'findings'), ''), nullif(trim(n->>'complications'), ''),
              nullif(n->>'start_time', '')::time, nullif(n->>'end_time', '')::time,
              coalesce(nullif(trim(n->>'anaesthetist'), ''), l.anaesthetist), coalesce(nullif(trim(n->>'position'), ''), c.position),
              nullif(trim(n->>'incision'), ''), nullif(trim(n->>'procedure_steps'), ''), nullif(trim(n->>'implants'), ''),
              nullif(trim(n->>'specimen'), ''), nullif(trim(n->>'drains'), ''), nullif(n->>'blood_loss_ml', '')::int,
              nullif(trim(n->>'closure'), ''), nullif(trim(n->>'postop_diagnosis'), ''), nullif(trim(n->>'postop_instructions'), ''))
      returning id into v_surgery;
    end if;
    update public.ot_cases set status = 'done', status_reason = null, done_at = now(), admission_id = coalesce(admission_id, v_adm),
           procedure_done = coalesce(nullif(trim(n->>'procedure_done'), ''), procedure),
           findings = nullif(trim(n->>'findings'), ''), postop_diagnosis = nullif(trim(n->>'postop_diagnosis'), ''),
           complications = nullif(trim(n->>'complications'), ''), surgery_id = coalesce(surgery_id, v_surgery),
           surgeon = coalesce(nullif(trim(n->>'surgeon'), ''), surgeon), assistants = coalesce(nullif(trim(n->>'assistants'), ''), assistants)
    where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'completed', status_reason = null where id = c.booking_id;
    end if;
  elsif p_status in ('postponed','cancelled') then
    if nullif(trim(p_reason), '') is null then raise exception 'Give a reason.'; end if;
    update public.ot_cases set status = p_status, status_reason = trim(p_reason) where id = c.id;
    if c.booking_id is not null then
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


-- ---------------------------------------------------------------- statistics (read-only, row security of the viewer applies)
create or replace view public.v_stats_weekly with (security_invoker = true) as
with ev as (
  select unit_id, date_trunc('week', admitted_at at time zone 'Asia/Kolkata')::date as week, 1 as adm, 0 as dis,
         (admission_type = 'emergency')::int as emerg, 0 as died
  from public.admissions
  union all
  select unit_id, date_trunc('week', discharged_at at time zone 'Asia/Kolkata')::date, 0, 1, 0, (status = 'expired')::int
  from public.admissions where discharged_at is not null
)
select unit_id, week, sum(adm)::int as admissions, sum(emerg)::int as emergency_admissions, sum(dis)::int as discharges, sum(died)::int as deaths
from ev group by unit_id, week;

create or replace view public.v_stats_ot_monthly with (security_invoker = true) as
select c.unit_id, date_trunc('month', l.list_date)::date as month, l.service,
       count(*)::int as listed,
       count(*) filter (where c.status = 'done')::int as done,
       count(*) filter (where c.status = 'postponed')::int as postponed,
       count(*) filter (where c.status = 'cancelled')::int as cancelled,
       count(*) filter (where l.session = 'emergency')::int as emergency
from public.ot_cases c join public.ot_lists l on l.id = c.list_id
group by c.unit_id, date_trunc('month', l.list_date), l.service;

create or replace view public.v_stats_procedures_monthly with (security_invoker = true) as
select c.unit_id, date_trunc('month', l.list_date)::date as month, l.service,
       lower(trim(coalesce(c.procedure_done, c.procedure))) as procedure, count(*)::int as done
from public.ot_cases c join public.ot_lists l on l.id = c.list_id
where c.status = 'done'
group by 1, 2, 3, 4;

create or replace view public.v_stats_occupancy_monthly with (security_invoker = true) as
with m as (
  select g::date as month, (g::timestamp at time zone 'Asia/Kolkata') as m_start,
         ((g + interval '1 month')::timestamp at time zone 'Asia/Kolkata') as m_end
  from generate_series(date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '11 months',
                       date_trunc('month', now() at time zone 'Asia/Kolkata'), interval '1 month') g
)
select w.unit_id, m.month, w.id as ward_id, w.name as ward,
       (select count(*) from public.ward_beds b where b.ward_id = w.id and b.active)::int as beds,
       round((coalesce((select sum(extract(epoch from least(coalesce(ba.to_at, now()), m.m_end) - greatest(ba.from_at, m.m_start)))
                        from public.bed_assignments ba join public.ward_beds b on b.id = ba.bed_id
                        where b.ward_id = w.id and ba.from_at < m.m_end and coalesce(ba.to_at, now()) > m.m_start), 0) / 86400)::numeric, 1) as bed_days,
       round((extract(epoch from least(now(), m.m_end) - m.m_start) / 86400)::numeric, 1) as days
from public.wards w cross join m
where w.active and m.m_start < now();

create or replace view public.v_stats_activity_monthly with (security_invoker = true) as
with a as (
  select unit_id, entered_by as user_id, date_trunc('month', round_at at time zone 'Asia/Kolkata')::date as month, 'rounds_written' as k from public.ward_round_entries
  union all select unit_id, verified_by, date_trunc('month', verified_at at time zone 'Asia/Kolkata')::date, 'rounds_verified' from public.ward_round_entries where verified_by is not null
  union all select unit_id, created_by, date_trunc('month', visit_at at time zone 'Asia/Kolkata')::date, 'opd_visits' from public.opd_visits where created_by is not null
  union all select unit_id, created_by, date_trunc('month', done_at at time zone 'Asia/Kolkata')::date, 'dressings' from public.dressing_records where created_by is not null
  union all select unit_id, entered_by, date_trunc('month', resulted_at at time zone 'Asia/Kolkata')::date, 'results_entered' from public.investigation_results where entered_by is not null
  union all select unit_id, closed_by, date_trunc('month', closed_at at time zone 'Asia/Kolkata')::date, 'tasks_completed' from public.care_tasks where closed_by is not null and status in ('done','verified')
)
select a.unit_id, a.month, a.user_id, s.full_name,
       count(*) filter (where k = 'rounds_written')::int as rounds_written,
       count(*) filter (where k = 'rounds_verified')::int as rounds_verified,
       count(*) filter (where k = 'opd_visits')::int as opd_visits,
       count(*) filter (where k = 'dressings')::int as dressings,
       count(*) filter (where k = 'results_entered')::int as results_entered,
       count(*) filter (where k = 'tasks_completed')::int as tasks_completed
from a left join public.staff s on s.user_id = a.user_id
group by a.unit_id, a.month, a.user_id, s.full_name;

grant select on public.v_stats_weekly, public.v_stats_ot_monthly, public.v_stats_procedures_monthly,
  public.v_stats_occupancy_monthly, public.v_stats_activity_monthly to authenticated;
