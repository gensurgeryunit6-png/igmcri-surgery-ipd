-- Surgery Unit OS · 0002 patient registry and inpatient management
-- Patient identity (UHID) is separate from each admission (IP number).
-- Rollback: drop the functions, views and tables created here in reverse order.

-- ---------------------------------------------------------------- patients
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  uhid text not null check (length(trim(uhid)) > 0),
  full_name text not null check (length(trim(full_name)) > 1),
  date_of_birth date,
  age_years int check (age_years between 0 and 130),
  age_recorded_on date,
  sex text not null check (sex in ('M','F','O')),
  address text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  allergies text,
  comorbidities text[] not null default '{}',
  blood_group text,
  status text not null default 'active' check (status in ('active','deceased','merged')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (institution_id, uhid),
  check (date_of_birth is not null or age_years is not null)
);
create index patients_name_trgm on public.patients using gin (full_name extensions.gin_trgm_ops);
create index on public.patients (phone);

-- ---------------------------------------------------------------- wards and beds
create table public.wards (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('male','female','special','emergency','other')),
  sort_order int not null default 0,
  active boolean not null default true,
  unique (unit_id, code)
);

create table public.ward_beds (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id),
  unit_id uuid not null references public.units(id),
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  unique (ward_id, label)
);

-- ---------------------------------------------------------------- admissions
create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  unit_id uuid not null references public.units(id),
  ip_number text not null check (length(trim(ip_number)) > 0),
  admitted_at timestamptz not null default now(),
  admission_type text not null default 'elective' check (admission_type in ('elective','emergency')),
  consultant_id uuid references public.staff(user_id),
  unit_chief_id uuid references public.staff(user_id),
  assigned_pg_id uuid references public.staff(user_id),
  status text not null default 'admitted'
    check (status in ('admitted','discharged','transferred_out','dama','absconded','expired')),
  planned_discharge_on date,
  discharged_at timestamptz,
  discharge_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (unit_id, ip_number),
  check ((status = 'admitted') = (discharged_at is null))
);
-- One active admission per patient.
create unique index admissions_one_active on public.admissions (patient_id) where status = 'admitted';
create index on public.admissions (unit_id, status);

create table public.bed_assignments (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  bed_id uuid not null references public.ward_beds(id),
  from_at timestamptz not null default now(),
  to_at timestamptz,
  reason text,
  created_by uuid default auth.uid(),
  check (to_at is null or to_at >= from_at)
);
create unique index bed_one_occupant on public.bed_assignments (bed_id) where to_at is null;
create unique index admission_one_bed on public.bed_assignments (admission_id) where to_at is null;

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  kind text not null default 'provisional' check (kind in ('provisional','final','secondary')),
  description text not null,
  icd10 text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  name text not null,
  ordered_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','resulted','cancelled')),
  result text,
  resulted_at timestamptz,
  abnormal boolean,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((status = 'resulted') = (result is not null))
);

create table public.medication_records (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  drug text not null,
  dose text,
  route text,
  frequency text,
  start_on date not null default current_date,
  stop_on date,
  status text not null default 'active' check (status in ('active','stopped')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Surgery waitlist and surgery records. Phase 5 extends these with the
-- readiness checklist and OT scheduling; they are created now so the census
-- and postoperative day can come from real records.
create table public.surgery_waitlist (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  admission_id uuid references public.admissions(id),
  unit_id uuid not null references public.units(id),
  list_type text not null default 'major' check (list_type in ('major','minor','emergency')),
  diagnosis text,
  planned_procedure text not null,
  planned_date date,
  status text not null default 'waiting'
    check (status in ('waiting','scheduled','postponed','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.surgery_waitlist (unit_id, status);

create table public.surgeries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.admissions(id),
  unit_id uuid not null references public.units(id),
  waitlist_id uuid references public.surgery_waitlist(id),
  surgery_date date not null,
  urgency text not null default 'elective' check (urgency in ('elective','emergency')),
  procedure_done text not null,
  surgeon text,
  assistants text,
  anaesthesia text,
  findings text,
  complications text,
  verified_by uuid references public.staff(user_id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.surgeries (admission_id, surgery_date desc);

create table public.discharge_summaries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null unique references public.admissions(id),
  unit_id uuid not null references public.units(id),
  content jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','final')),
  finalised_by uuid references public.staff(user_id),
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  admission_id uuid references public.admissions(id),
  unit_id uuid not null references public.units(id),
  kind text not null check (kind in ('photo','document','report')),
  storage_path text not null unique,
  caption text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ---------------------------------------------------------------- integrity triggers
-- Child rows copy unit_id from their admission so policies stay simple and fast.
create or replace function private.unit_from_admission()
returns trigger language plpgsql set search_path = '' as $$
begin
  select a.unit_id into strict new.unit_id from public.admissions a where a.id = new.admission_id;
  return new;
end $$;

create or replace function private.unit_from_ward()
returns trigger language plpgsql set search_path = '' as $$
begin
  select w.unit_id into strict new.unit_id from public.wards w where w.id = new.ward_id;
  return new;
end $$;

create or replace function private.final_discharge_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'final' then
    raise exception 'a final discharge summary cannot be changed';
  end if;
  if new.status = 'final' then
    new.finalised_by := auth.uid();
    new.finalised_at := now();
  end if;
  return new;
end $$;

create trigger unit_from_ward before insert or update of ward_id on public.ward_beds
  for each row execute function private.unit_from_ward();
do $$ declare t text; begin
  foreach t in array array['bed_assignments','diagnoses','investigations','medication_records',
                           'surgeries','discharge_summaries'] loop
    execute format('create trigger unit_from_admission before insert or update of admission_id on public.%I
                    for each row execute function private.unit_from_admission()', t);
  end loop;
  foreach t in array array['patients','admissions','investigations','medication_records','surgery_waitlist',
                           'surgeries','discharge_summaries'] loop
    execute format('create trigger stamp before insert or update on public.%I
                    for each row execute function private.stamp()', t);
  end loop;
  foreach t in array array['patients','wards','ward_beds','admissions','bed_assignments','diagnoses',
                           'investigations','medication_records','surgery_waitlist','surgeries',
                           'discharge_summaries','documents'] loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function private.audit()', t);
  end loop;
end $$;
create or replace function private.bed_same_unit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.ward_beds b where b.id = new.bed_id and b.unit_id = new.unit_id and b.active) then
    raise exception 'That bed does not belong to this unit or is inactive.';
  end if;
  return new;
end $$;
-- Named zz_ so it runs after unit_from_admission (BEFORE triggers fire in name order).
create trigger zz_bed_same_unit before insert or update of bed_id on public.bed_assignments
  for each row execute function private.bed_same_unit();

create trigger final_lock before update on public.discharge_summaries
  for each row execute function private.final_discharge_lock();

-- ---------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['patients','wards','ward_beds','admissions','bed_assignments','diagnoses',
                           'investigations','medication_records','surgery_waitlist','surgeries',
                           'discharge_summaries','documents'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy read on public.patients for select to authenticated
  using (private.has_perm_in_institution(institution_id, 'patient.read'));
create policy ins on public.patients for insert to authenticated
  with check (private.has_perm_in_institution(institution_id, 'patient.write'));
create policy upd on public.patients for update to authenticated
  using (private.has_perm_in_institution(institution_id, 'patient.write'))
  with check (private.has_perm_in_institution(institution_id, 'patient.write'));

create policy read on public.wards for select to authenticated using (private.is_member(unit_id));
create policy manage on public.wards for all to authenticated
  using (private.has_perm(unit_id, 'settings.manage')) with check (private.has_perm(unit_id, 'settings.manage'));
create policy read on public.ward_beds for select to authenticated using (private.is_member(unit_id));
create policy manage on public.ward_beds for all to authenticated
  using (private.has_perm(unit_id, 'settings.manage')) with check (private.has_perm(unit_id, 'settings.manage'));

-- Inpatient tables: read with ipd.read, write with ipd.write. No deletes from the API.
do $$ declare t text; begin
  foreach t in array array['admissions','bed_assignments','diagnoses','investigations','medication_records',
                           'surgery_waitlist','surgeries','documents'] loop
    execute format('create policy read on public.%I for select to authenticated
                    using (private.has_perm(unit_id, ''ipd.read''))', t);
    execute format('create policy ins on public.%I for insert to authenticated
                    with check (private.has_perm(unit_id, ''ipd.write''))', t);
    execute format('create policy upd on public.%I for update to authenticated
                    using (private.has_perm(unit_id, ''ipd.write''))
                    with check (private.has_perm(unit_id, ''ipd.write''))', t);
  end loop;
end $$;

create policy read on public.discharge_summaries for select to authenticated
  using (private.has_perm(unit_id, 'ipd.read'));
create policy ins on public.discharge_summaries for insert to authenticated
  with check (private.has_perm(unit_id, 'ipd.write') and status = 'draft');
create policy upd on public.discharge_summaries for update to authenticated
  using (private.has_perm(unit_id, 'ipd.write'))
  with check (private.has_perm(unit_id, 'ipd.write')
              and (status = 'draft' or private.has_perm(unit_id, 'ipd.discharge')));

grant select, insert, update on public.patients, public.admissions, public.bed_assignments,
  public.diagnoses, public.investigations, public.medication_records, public.surgery_waitlist,
  public.surgeries, public.discharge_summaries to authenticated;
grant select, insert on public.documents to authenticated;
grant select, insert, update, delete on public.wards, public.ward_beds to authenticated;

-- ---------------------------------------------------------------- workflow functions
-- Possible duplicates for a new registration: same UHID, or similar name with
-- matching phone / age.
create or replace function public.find_possible_duplicates(
  p_name text, p_phone text default null, p_age int default null, p_uhid text default null)
returns table (id uuid, uhid text, full_name text, age_years int, sex text, phone text, reason text)
language sql stable set search_path = public, extensions as $$
  select p.id, p.uhid, p.full_name, p.age_years, p.sex, p.phone,
    case when p.uhid = p_uhid then 'Same UHID'
         when p.phone is not null and p.phone = p_phone then 'Same phone number'
         else 'Similar name' end
  from public.patients p
  where (p_uhid is not null and p.uhid = p_uhid)
     or (p_phone is not null and length(p_phone) >= 6 and p.phone = p_phone)
     or (similarity(p.full_name, p_name) > 0.55
         and (p_age is null or p.age_years is null or abs(p.age_years - p_age) <= 2))
  order by (p.uhid = p_uhid) desc nulls last, similarity(p.full_name, p_name) desc
  limit 10;
$$;

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
  where p.uhid ilike p_query || '%'
     or p.full_name ilike '%' || p_query || '%'
     or p.phone like p_query || '%'
     or exists (select 1 from public.admissions x where x.patient_id = p.id and x.ip_number ilike p_query || '%')
     or similarity(p.full_name, p_query) > 0.35
  order by (p.uhid ilike p_query) desc, similarity(p.full_name, p_query) desc
  limit 30;
$$;

create or replace function public.admit_patient(
  p_patient_id uuid, p_unit_id uuid, p_ip_number text, p_bed_id uuid,
  p_admitted_at timestamptz default now(), p_admission_type text default 'elective',
  p_diagnosis text default null, p_consultant_id uuid default null,
  p_unit_chief_id uuid default null, p_assigned_pg_id uuid default null)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_perm(p_unit_id, 'ipd.write');
  if exists (select 1 from public.admissions where patient_id = p_patient_id and status = 'admitted') then
    raise exception 'This patient already has an active admission. Discharge or transfer it first.';
  end if;
  insert into public.admissions (patient_id, unit_id, ip_number, admitted_at, admission_type,
                                 consultant_id, unit_chief_id, assigned_pg_id)
  values (p_patient_id, p_unit_id, trim(p_ip_number), p_admitted_at, p_admission_type,
          p_consultant_id, p_unit_chief_id, p_assigned_pg_id)
  returning id into v_id;
  if p_bed_id is not null then
    insert into public.bed_assignments (admission_id, bed_id, from_at, reason)
    values (v_id, p_bed_id, p_admitted_at, 'Admission');
  end if;
  if nullif(trim(p_diagnosis), '') is not null then
    insert into public.diagnoses (admission_id, kind, description) values (v_id, 'provisional', trim(p_diagnosis));
  end if;
  return v_id;
exception when unique_violation then
  if sqlerrm like '%bed_one_occupant%' then raise exception 'That bed is already occupied.'; end if;
  if sqlerrm like '%ip_number%' then raise exception 'That IP number is already in use.'; end if;
  raise;
end $$;

create or replace function public.move_patient_bed(p_admission_id uuid, p_bed_id uuid, p_reason text default null)
returns void language plpgsql set search_path = '' as $$
declare v_unit uuid;
begin
  select unit_id into strict v_unit from public.admissions where id = p_admission_id and status = 'admitted';
  perform private.require_perm(v_unit, 'ipd.write');
  update public.bed_assignments set to_at = now() where admission_id = p_admission_id and to_at is null;
  insert into public.bed_assignments (admission_id, bed_id, reason) values (p_admission_id, p_bed_id, coalesce(p_reason, 'Transfer'));
exception
  when no_data_found then raise exception 'Admission not found or not active.';
  when unique_violation then raise exception 'That bed is already occupied.';
end $$;

create or replace function public.discharge_patient(
  p_admission_id uuid, p_status text default 'discharged', p_note text default null,
  p_at timestamptz default now())
returns void language plpgsql set search_path = '' as $$
declare v_unit uuid;
begin
  select unit_id into strict v_unit from public.admissions where id = p_admission_id and status = 'admitted';
  perform private.require_perm(v_unit, 'ipd.discharge');
  if p_status not in ('discharged','transferred_out','dama','absconded','expired') then
    raise exception 'Invalid discharge status %', p_status;
  end if;
  update public.bed_assignments set to_at = p_at where admission_id = p_admission_id and to_at is null;
  update public.admissions set status = p_status, discharged_at = p_at, discharge_note = p_note
  where id = p_admission_id;
exception when no_data_found then raise exception 'Admission not found or not active.';
end $$;

grant execute on function public.find_possible_duplicates(text, text, int, text), public.search_patients(text),
  public.admit_patient(uuid, uuid, text, uuid, timestamptz, text, text, uuid, uuid, uuid),
  public.move_patient_bed(uuid, uuid, text), public.discharge_patient(uuid, text, text, timestamptz)
  to authenticated;
revoke execute on function public.find_possible_duplicates(text, text, int, text), public.search_patients(text),
  public.admit_patient(uuid, uuid, text, uuid, timestamptz, text, text, uuid, uuid, uuid),
  public.move_patient_bed(uuid, uuid, text), public.discharge_patient(uuid, text, text, timestamptz)
  from public, anon;

-- ---------------------------------------------------------------- private storage for clinical files
-- Path convention: <unit_id>/<patient_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-files', 'clinical-files', false, 15728640,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy clinical_files_read on storage.objects for select to authenticated
  using (bucket_id = 'clinical-files'
         and private.has_perm(((storage.foldername(name))[1])::uuid, 'ipd.read'));
create policy clinical_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'clinical-files'
              and private.has_perm(((storage.foldername(name))[1])::uuid, 'ipd.write'));
