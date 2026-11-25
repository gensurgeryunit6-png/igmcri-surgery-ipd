-- Surgery Unit OS · 0012 unit personnel, simpler registration and admission.
-- * unit_personnel: the unit's people (with or without a login), used for consultant and PG dropdowns.
-- * patients.allergy_status: yes / no.
-- * admissions link to personnel; admit_patient_auto assigns the next free bed in the chosen ward.
-- Rollback: drop function public.admit_patient_auto(...); alter table admissions drop column consultant_person_id,
--           drop column pg_person_id; alter table patients drop column allergy_status; drop table public.unit_personnel;
--           and recreate v_inpatients from 0003.

create table public.unit_personnel (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  full_name text not null check (length(trim(full_name)) > 1),
  designation text,
  category text not null check (category in ('unit_chief','consultant','assistant_professor','senior_resident','pg','intern','other')),
  pg_year int check (pg_year between 1 and 3),
  phone text,
  responsibilities text,
  user_id uuid references public.staff(user_id),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (unit_id, user_id)
);
create index unit_personnel_unit_idx on public.unit_personnel (unit_id, category) where active;
alter table public.unit_personnel enable row level security;
create policy read on public.unit_personnel for select to authenticated using (private.is_member(unit_id));
create policy ins on public.unit_personnel for insert to authenticated with check (private.has_perm(unit_id, 'personnel.manage'));
create policy upd on public.unit_personnel for update to authenticated
  using (private.has_perm(unit_id, 'personnel.manage')) with check (private.has_perm(unit_id, 'personnel.manage'));
grant select, insert, update on public.unit_personnel to authenticated;
create trigger stamp before insert or update on public.unit_personnel for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.unit_personnel for each row execute function private.audit();

insert into public.unit_personnel (unit_id, full_name, designation, category, sort_order)
select u.id, x.n, 'Consultant', 'consultant', x.o from public.units u
cross join (values ('Dr. Ray', 1), ('Dr. Govardhanan R', 2)) x(n, o)
where u.code = 'VI';

alter table public.patients add column if not exists allergy_status text check (allergy_status in ('yes','no'));
update public.patients set allergy_status = case when nullif(trim(allergies), '') is null then null else 'yes' end where allergy_status is null;

alter table public.admissions add column if not exists consultant_person_id uuid references public.unit_personnel(id);
alter table public.admissions add column if not exists pg_person_id uuid references public.unit_personnel(id);
create index if not exists admissions_consultant_person_idx on public.admissions (consultant_person_id);
create index if not exists admissions_pg_person_idx on public.admissions (pg_person_id);

-- Admit with the next free active bed in the ward (lowest bed number first).
create or replace function public.admit_patient_auto(
  p_patient_id uuid, p_unit_id uuid, p_ip_number text, p_ward_id uuid,
  p_admitted_at timestamptz default now(), p_admission_type text default 'elective',
  p_diagnosis text default null, p_consultant_person uuid default null, p_pg_person uuid default null)
returns table (admission_id uuid, bed_label text) language plpgsql set search_path = '' as $$
declare v_bed uuid; v_label text; v_id uuid; v_pg_user uuid;
begin
  perform private.require_perm(p_unit_id, 'ipd.write');
  if p_ward_id is not null then
    select b.id, b.label into v_bed, v_label from public.ward_beds b
    where b.ward_id = p_ward_id and b.unit_id = p_unit_id and b.active
      and not exists (select 1 from public.bed_assignments a where a.bed_id = b.id and a.to_at is null)
    order by b.sort_order, b.label
    for update skip locked limit 1;
    if v_bed is null then raise exception 'No free bed in this ward. Choose another ward or add beds.'; end if;
  end if;
  select user_id into v_pg_user from public.unit_personnel where id = p_pg_person;
  v_id := public.admit_patient(p_patient_id, p_unit_id, p_ip_number, v_bed, p_admitted_at, p_admission_type, p_diagnosis,
                               null, null, v_pg_user);
  update public.admissions set consultant_person_id = p_consultant_person, pg_person_id = p_pg_person where id = v_id;
  return query select v_id, v_label;
end $$;
revoke execute on function public.admit_patient_auto(uuid, uuid, text, uuid, timestamptz, text, text, uuid, uuid) from public, anon;
grant execute on function public.admit_patient_auto(uuid, uuid, text, uuid, timestamptz, text, text, uuid, uuid) to authenticated;

-- v_inpatients: names of consultant and PG from personnel (new columns appended).
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
       (select count(*) from public.care_tasks t where t.admission_id = a.id and t.status = 'open')::int as open_tasks,
       (select private.today_ist() - max(s.surgery_date) from public.surgeries s
        where s.admission_id = a.id and s.verified_at is not null and s.surgery_date <= private.today_ist()) as postop_day,
       exists (select 1 from public.surgeries s where s.admission_id = a.id) as is_postop,
       exists (select 1 from public.surgery_waitlist wl where wl.admission_id = a.id
               and wl.status in ('waiting','scheduled','postponed')) as awaiting_surgery,
       cp.full_name as consultant_name, pgp.full_name as pg_name, a.pg_person_id
from public.admissions a
join public.patients p on p.id = a.patient_id
left join public.bed_assignments ba on ba.admission_id = a.id and ba.to_at is null
left join public.ward_beds b on b.id = ba.bed_id
left join public.wards w on w.id = b.ward_id
left join public.unit_personnel cp on cp.id = a.consultant_person_id
left join public.unit_personnel pgp on pgp.id = a.pg_person_id
left join lateral (select r.clinical_status, r.round_at from public.ward_round_entries r
                   where r.admission_id = a.id order by r.round_at desc limit 1) lr on true
where a.status = 'admitted';
