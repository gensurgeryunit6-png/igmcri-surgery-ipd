-- Surgery Unit OS · 0009 ward module completion
-- 1. A bed (or ward) with a patient in it cannot be switched off.
-- 2. Scheduled morning ward report: a saved snapshot of the unit's ward data,
--    taken once a day at the unit's chosen hour (IST), readable in the app.
-- Rollback: select cron.unschedule('ward-report-snapshots'); drop table public.daily_report_snapshots;
--           drop table public.unit_settings; drop function private.take_ward_snapshot(uuid, date);
--           drop function private.take_due_snapshots(); drop trigger ... on ward_beds / wards.

-- ---------------------------------------------------------------- occupied beds stay on
create or replace function private.bed_off_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.active and not new.active then
    if tg_table_name = 'ward_beds' and exists (select 1 from public.bed_assignments a where a.bed_id = old.id and a.to_at is null) then
      raise exception 'Bed % has a patient in it. Move or discharge the patient first.', old.label;
    end if;
    if tg_table_name = 'wards' and exists (select 1 from public.bed_assignments a join public.ward_beds b on b.id = a.bed_id
                                           where b.ward_id = old.id and a.to_at is null) then
      raise exception 'This ward still has patients in it.';
    end if;
  end if;
  return new;
end $$;
create trigger bed_off_guard before update of active on public.ward_beds for each row execute function private.bed_off_guard();
create trigger bed_off_guard before update of active on public.wards for each row execute function private.bed_off_guard();

-- ---------------------------------------------------------------- unit settings
create table public.unit_settings (
  unit_id uuid primary key references public.units(id),
  morning_report_hour int not null default 11 check (morning_report_hour between 0 and 23),
  morning_report_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into public.unit_settings (unit_id) select id from public.units where active on conflict do nothing;
alter table public.unit_settings enable row level security;
create policy read on public.unit_settings for select to authenticated using (private.is_member(unit_id));
create policy upd on public.unit_settings for update to authenticated
  using (private.has_perm(unit_id, 'settings.manage')) with check (private.has_perm(unit_id, 'settings.manage'));
grant select, update on public.unit_settings to authenticated;
create trigger audit after insert or update or delete on public.unit_settings for each row execute function private.audit();

-- ---------------------------------------------------------------- snapshots
create table public.daily_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  for_date date not null,
  taken_at timestamptz not null default now(),
  data jsonb not null,
  unique (unit_id, for_date)
);
create index on public.daily_report_snapshots (unit_id, for_date desc);
alter table public.daily_report_snapshots enable row level security;
create policy read on public.daily_report_snapshots for select to authenticated using (private.has_perm(unit_id, 'report.generate'));
grant select on public.daily_report_snapshots to authenticated;

-- Same shape the app's report builder reads, so live and saved reports print identically.
create or replace function private.take_ward_snapshot(p_unit uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_date::timestamp at time zone 'Asia/Kolkata');
  v_to timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Kolkata');
  v_id uuid;
begin
  insert into public.daily_report_snapshots (unit_id, for_date, data)
  select p_unit, p_date, jsonb_build_object(
    'pts', coalesce((select jsonb_agg(to_jsonb(i) order by i.ward_sort, i.bed_sort) from public.v_inpatients i where i.unit_id = p_unit), '[]'),
    'wards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'kind', w.kind, 'sort_order', w.sort_order) order by w.sort_order)
                       from public.wards w where w.unit_id = p_unit and w.active), '[]'),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
                           'author', jsonb_build_object('full_name', sa.full_name),
                           'verifier', case when sv.user_id is null then null else jsonb_build_object('full_name', sv.full_name) end) order by e.round_at)
                         from public.ward_round_entries e
                         join public.staff sa on sa.user_id = e.entered_by
                         left join public.staff sv on sv.user_id = e.verified_by
                         where e.unit_id = p_unit and e.round_at >= v_from and e.round_at < v_to), '[]'),
    'amendments', coalesce((select jsonb_agg(to_jsonb(a)) from public.ward_round_amendments a
                            join public.ward_round_entries e on e.id = a.entry_id
                            where e.unit_id = p_unit and e.round_at >= v_from and e.round_at < v_to), '[]'),
    'investigations', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'admission_id', x.admission_id, 'name', x.name, 'ordered_at', x.ordered_at))
                                from public.investigations x where x.unit_id = p_unit and x.status = 'pending'), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'admission_id', t.admission_id, 'kind', t.kind, 'description', t.description, 'created_at', t.created_at))
                       from public.care_tasks t where t.unit_id = p_unit and t.status = 'open'), '[]'),
    'census', (select to_jsonb(c) - 'unit_id' from (
      select
        count(*) filter (where true)::int as total_admitted,
        count(*) filter (where ward_kind = 'male')::int as male_ward,
        count(*) filter (where ward_kind = 'female')::int as female_ward,
        count(*) filter (where ward_kind = 'special')::int as special_ward,
        count(*) filter (where ward_kind in ('emergency','other'))::int as other_beds,
        count(*) filter (where bed_id is null)::int as no_bed,
        (select count(*) from public.admissions a where a.unit_id = p_unit and a.admitted_at >= v_from and a.admitted_at < v_to)::int as new_admissions,
        count(*) filter (where is_postop)::int as postoperative,
        count(*) filter (where last_status = 'critical')::int as critical,
        count(*) filter (where awaiting_surgery)::int as awaiting_surgery,
        count(*) filter (where planned_discharge_on <= p_date)::int as planned_discharge,
        (select count(*) from public.admissions a where a.unit_id = p_unit and a.status <> 'admitted' and a.discharged_at >= v_from and a.discharged_at < v_to)::int as discharged_today,
        count(*) filter (where rounds_today = 0)::int as rounds_pending,
        p_unit as unit_id
      from public.v_inpatients where unit_id = p_unit) c))
  on conflict (unit_id, for_date) do update set data = excluded.data, taken_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.take_ward_snapshot(uuid, date) from public, anon, authenticated;

-- Called every hour by pg_cron: snapshots each unit whose chosen IST hour has come and that has none today.
create or replace function private.take_due_snapshots()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for r in select s.unit_id from public.unit_settings s
           where s.morning_report_enabled
             and extract(hour from now() at time zone 'Asia/Kolkata') >= s.morning_report_hour
             and not exists (select 1 from public.daily_report_snapshots d where d.unit_id = s.unit_id and d.for_date = v_today) loop
    perform private.take_ward_snapshot(r.unit_id, v_today);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.take_due_snapshots() from public, anon, authenticated;

-- Staff with report.generate can also take today's snapshot on demand.
create or replace function public.save_ward_snapshot_now(p_unit uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_perm(p_unit, 'report.generate');
  return private.take_ward_snapshot(p_unit, (now() at time zone 'Asia/Kolkata')::date);
end $$;
revoke execute on function public.save_ward_snapshot_now(uuid) from public, anon;
grant execute on function public.save_ward_snapshot_now(uuid) to authenticated;

-- Schedule (only where pg_cron is available, i.e. on Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ward-report-snapshots', '2 * * * *', 'select private.take_due_snapshots()');
  end if;
end $$;
