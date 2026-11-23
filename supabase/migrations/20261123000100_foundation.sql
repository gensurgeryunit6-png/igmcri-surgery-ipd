-- Surgery Unit OS · 0001 foundation
-- Organisation (institution > department > unit), staff, roles and permissions,
-- audit log, and the private helper functions every RLS policy uses.
-- Rollback: drop schema private cascade; drop the tables below in reverse order.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Helpers live in a schema the Data API does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------- organisation
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (institution_id, code)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (department_id, code)
);

-- ---------------------------------------------------------------- staff + roles
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  designation text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  code text primary key,
  name text not null,
  rank int not null
);

create table public.permissions (
  code text primary key,
  description text not null
);

create table public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table public.unit_members (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  user_id uuid not null references public.staff(user_id) on delete cascade,
  role_code text not null references public.roles(code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (unit_id, user_id, role_code)
);
create index on public.unit_members (user_id) where active;

-- ---------------------------------------------------------------- permission helpers
create or replace function private.has_perm(p_unit uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.unit_members m
    join public.role_permissions rp on rp.role_code = m.role_code
    join public.staff s on s.user_id = m.user_id and s.active
    where m.user_id = auth.uid() and m.active
      and m.unit_id = p_unit and rp.permission_code = p_perm
  );
$$;

-- Permission in any unit of the same institution (for institution-wide patient identity).
create or replace function private.has_perm_in_institution(p_institution uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.unit_members m
    join public.role_permissions rp on rp.role_code = m.role_code
    join public.staff s on s.user_id = m.user_id and s.active
    join public.units u on u.id = m.unit_id
    join public.departments d on d.id = u.department_id
    where m.user_id = auth.uid() and m.active
      and d.institution_id = p_institution and rp.permission_code = p_perm
  );
$$;

create or replace function private.is_member(p_unit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.unit_members m
                 join public.staff s on s.user_id = m.user_id and s.active
                 where m.user_id = auth.uid() and m.unit_id = p_unit and m.active);
$$;

create or replace function private.require_perm(p_unit uuid, p_perm text)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not private.has_perm(p_unit, p_perm) then
    raise exception 'permission denied: % required', p_perm using errcode = '42501';
  end if;
end $$;

grant execute on function private.has_perm(uuid, text), private.has_perm_in_institution(uuid, text),
  private.is_member(uuid), private.require_perm(uuid, text) to authenticated;

-- ---------------------------------------------------------------- audit
create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  via text not null default coalesce(nullif(current_setting('app.via', true), ''), 'app'),
  table_name text not null,
  row_id text,
  unit_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb
);
create index on public.audit_logs (table_name, row_id);
create index on public.audit_logs (at desc);

create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (table_name, row_id, unit_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce(r->>'id', r->>'user_id'),
          nullif(r->>'unit_id', '')::uuid,
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- created_by / updated_by / updated_at bookkeeping
create or replace function private.stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Audit is append-only and readable by holders of audit.read in the row's unit.
alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated
  using (unit_id is not null and private.has_perm(unit_id, 'audit.read'));

-- ---------------------------------------------------------------- RLS: organisation
alter table public.institutions enable row level security;
alter table public.departments enable row level security;
alter table public.units enable row level security;
alter table public.staff enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.unit_members enable row level security;

create policy org_read on public.institutions for select to authenticated using (true);
create policy org_read on public.departments for select to authenticated using (true);
create policy org_read on public.units for select to authenticated using (true);
create policy org_read on public.roles for select to authenticated using (true);
create policy org_read on public.permissions for select to authenticated using (true);
create policy org_read on public.role_permissions for select to authenticated using (true);

-- Staff: you can see yourself, and colleagues who share a unit with you.
create policy staff_read on public.staff for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.unit_members mine
             join public.unit_members theirs on theirs.unit_id = mine.unit_id
             where mine.user_id = auth.uid() and mine.active and theirs.user_id = staff.user_id)
);
-- Anyone signed in may create their own staff profile (it grants nothing on its own).
create policy staff_self_insert on public.staff for insert to authenticated
  with check (user_id = auth.uid() and active);
create policy staff_self_update on public.staff for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy staff_admin_update on public.staff for update to authenticated using (
  exists (select 1 from public.unit_members m where m.user_id = staff.user_id
          and private.has_perm(m.unit_id, 'users.manage'))
);

create policy members_read on public.unit_members for select to authenticated
  using (user_id = auth.uid() or private.is_member(unit_id));
create policy members_manage on public.unit_members for all to authenticated
  using (private.has_perm(unit_id, 'users.manage'))
  with check (private.has_perm(unit_id, 'users.manage'));

-- A staff member cannot switch themselves active again after deactivation, nor
-- change their own active flag at all.
create or replace function private.staff_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.active is distinct from old.active and new.user_id = auth.uid() then
    raise exception 'you cannot change your own active status';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger staff_guard before update on public.staff for each row execute function private.staff_guard();

create trigger audit after insert or update or delete on public.unit_members
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.staff
  for each row execute function private.audit();

grant select on public.institutions, public.departments, public.units, public.roles,
  public.permissions, public.role_permissions to authenticated;
grant select, insert, update on public.staff to authenticated;
grant select, insert, update, delete on public.unit_members to authenticated;
grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------- reference data
insert into public.roles (code, name, rank) values
  ('unit_chief', 'Unit Chief', 10),
  ('faculty', 'Faculty', 20),
  ('senior_resident', 'Senior Resident', 30),
  ('postgraduate', 'Postgraduate', 40),
  ('staff_nurse', 'Staff Nurse', 50),
  ('data_entry', 'Data Entry Staff', 60),
  ('admin', 'Administrator', 70);

insert into public.permissions (code, description) values
  ('patient.read', 'View patient registry'),
  ('patient.write', 'Register and edit patients'),
  ('ipd.read', 'View admissions, census and inpatient records'),
  ('ipd.write', 'Admit, allocate beds, transfer, record investigations and medications'),
  ('ipd.discharge', 'Discharge patients and finalise discharge summaries'),
  ('round.write', 'Enter ward-round notes'),
  ('round.verify', 'Verify ward-round entries'),
  ('round.amend', 'Amend ward-round entries with a reason'),
  ('ot.prepare', 'Prepare OT lists and waitlists'),
  ('ot.approve', 'Review and approve OT lists'),
  ('ot.publish', 'Publish OT lists'),
  ('report.generate', 'Generate and download reports'),
  ('settings.manage', 'Manage wards, beds and unit settings'),
  ('users.manage', 'Manage users and roles'),
  ('audit.read', 'View the audit log');

insert into public.role_permissions (role_code, permission_code)
select r, p from (values
  ('unit_chief', array['patient.read','patient.write','ipd.read','ipd.write','ipd.discharge','round.write','round.verify','round.amend','ot.prepare','ot.approve','ot.publish','report.generate','audit.read']),
  ('faculty', array['patient.read','patient.write','ipd.read','ipd.write','ipd.discharge','round.write','round.verify','round.amend','ot.prepare','ot.approve','report.generate']),
  ('senior_resident', array['patient.read','patient.write','ipd.read','ipd.write','ipd.discharge','round.write','round.amend','ot.prepare','report.generate']),
  ('postgraduate', array['patient.read','patient.write','ipd.read','ipd.write','round.write','round.amend','ot.prepare','report.generate']),
  ('staff_nurse', array['patient.read','ipd.read','report.generate']),
  ('data_entry', array['patient.read','patient.write','ipd.read']),
  ('admin', array['settings.manage','users.manage','audit.read','patient.read','ipd.read'])
) v(r, ps), unnest(ps) p;

insert into public.institutions (code, name, address)
values ('IGMCRI', 'Indira Gandhi Medical College & Research Institute', 'Kathirkamam, Puducherry');
insert into public.departments (institution_id, code, name)
select id, 'GS', 'Department of General Surgery' from public.institutions where code = 'IGMCRI';
insert into public.units (department_id, code, name, active)
select d.id, u.code, u.name, u.code = 'VI'
from public.departments d,
  (values ('I','Unit I'),('II','Unit II'),('III','Unit III'),('IV','Unit IV'),('V','Unit V'),('VI','Unit VI')) u(code, name)
where d.code = 'GS';
