-- Surgery Unit OS · 0011 roles as per the unit's specification, patient archive, notifications.
-- Unit Chief and Consultants (faculty): complete access.
-- PGs / Senior Residents: clinical work, OT lists, duty reports, leave.
-- Interns: view only.
-- Rollback: restore role_permissions from 0001/0007; drop table public.notifications;
--           drop function public.archive_patient(uuid, text).

insert into public.permissions (code, description) values
  ('patient.archive', 'Remove (archive) a patient record, with reason'),
  ('duty.submit', 'Submit own duty reports'),
  ('duty.review', 'View all duty reports'),
  ('leave.apply', 'Apply for leave'),
  ('leave.approve', 'Approve or reject leave'),
  ('protocol.manage', 'Upload and update unit protocols'),
  ('personnel.manage', 'Update unit personnel details')
on conflict (code) do nothing;

-- Unit Chief and Consultants: everything.
delete from public.role_permissions where role_code in ('unit_chief', 'faculty');
insert into public.role_permissions (role_code, permission_code)
select r, p.code from unnest(array['unit_chief', 'faculty']) r cross join public.permissions p;

-- Residents: clinical work, OT preparation, duty and leave. No admin, no verify/approve.
delete from public.role_permissions where role_code in ('postgraduate', 'senior_resident');
insert into public.role_permissions (role_code, permission_code)
select r, p from unnest(array['postgraduate', 'senior_resident']) r,
  unnest(array['patient.read','patient.write','ipd.read','ipd.write','round.write','round.amend','ot.prepare',
               'report.generate','duty.submit','leave.apply']) p;
-- Senior residents also discharge, as before.
insert into public.role_permissions values ('senior_resident', 'ipd.discharge');

-- Interns: view only.
delete from public.role_permissions where role_code = 'intern';
insert into public.role_permissions (role_code, permission_code)
select 'intern', p from unnest(array['patient.read','ipd.read']) p;

-- ---------------------------------------------------------------- archive instead of delete
alter table public.patients drop constraint if exists patients_status_check;
alter table public.patients add constraint patients_status_check check (status in ('active','deceased','merged','archived'));
alter table public.patients add column if not exists archived_reason text;

create or replace function public.archive_patient(p_patient uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into strict v_inst from public.patients where id = p_patient;
  if not private.has_perm_in_institution(v_inst, 'patient.archive') then
    raise exception 'permission denied: patient.archive required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for removing this record.'; end if;
  if exists (select 1 from public.admissions where patient_id = p_patient and status = 'admitted') then
    raise exception 'This patient is admitted. Discharge first.';
  end if;
  update public.patients set status = 'archived', archived_reason = trim(p_reason) where id = p_patient;
end $$;
revoke execute on function public.archive_patient(uuid, text) from public, anon;
grant execute on function public.archive_patient(uuid, text) to authenticated;

-- Search hides archived records.
create or replace function public.search_patients(p_query text)
returns table (id uuid, uhid text, full_name text, age_years int, sex text, phone text,
               active_admission_id uuid, ip_number text, ward text, bed text)
language sql stable set search_path = public, extensions as $$
  select p.id, p.uhid, p.full_name, p.age_years, p.sex, p.phone,
         a.id, a.ip_number, w.name, b.label
  from public.patients p
  left join public.admissions a on a.patient_id = p.id and a.status = 'admitted'
  left join public.bed_assignments ba on ba.admission_id = a.id and ba.to_at is null
  left join public.ward_beds b on b.id = ba.bed_id
  left join public.wards w on w.id = b.ward_id
  where p.status <> 'archived' and (
        p.uhid ilike p_query || '%'
     or p.full_name ilike '%' || p_query || '%'
     or p.phone like p_query || '%'
     or exists (select 1 from public.admissions x where x.patient_id = p.id and x.ip_number ilike p_query || '%')
     or similarity(p.full_name, p_query) > 0.35)
  order by (p.uhid ilike p_query) desc, similarity(p.full_name, p_query) desc
  limit 30;
$$;

-- ---------------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.staff(user_id) on delete cascade,
  unit_id uuid references public.units(id),
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unit_idx on public.notifications (unit_id);
alter table public.notifications enable row level security;
create policy read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, update (read_at) on public.notifications to authenticated;

-- Send a notification to everyone in a unit holding a permission (used by module triggers).
create or replace function private.notify_perm(p_unit uuid, p_perm text, p_title text, p_body text, p_link text, p_except uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, unit_id, title, body, link)
  select distinct m.user_id, p_unit, p_title, p_body, p_link
  from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
  join public.staff s on s.user_id = m.user_id and s.active
  where m.unit_id = p_unit and m.active and rp.permission_code = p_perm
    and m.user_id is distinct from p_except;
$$;

-- First use: tell verifiers when a resident amends a verified note.
create or replace function private.notify_amendment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_perm(new.unit_id, 'round.verify', 'Ward-round note amended',
    'A note was corrected: ' || new.reason, '/round/?a=' || (select admission_id from public.ward_round_entries where id = new.entry_id),
    new.amended_by);
  return null;
end $$;
create trigger notify_amendment after insert on public.ward_round_amendments for each row execute function private.notify_amendment();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
