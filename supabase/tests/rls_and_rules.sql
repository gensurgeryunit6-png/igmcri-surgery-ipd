-- Behaviour tests. Run against a database with the migrations applied.
-- Every block must end without error; expected failures are caught and checked.
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then set role anon; else set role authenticated; end if;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then return; end if;
    raise exception 'expected error like "%" but got "%" for: %', p_like, sqlerrm, p_sql;
  end;
  raise exception 'expected error like "%" but statement succeeded: %', p_like, p_sql;
end $$;

-- users: PG, faculty, nurse, outsider (signed in, no role)
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'pg@test'), ('00000000-0000-0000-0000-0000000000b2', 'fac@test'),
  ('00000000-0000-0000-0000-0000000000c3', 'nurse@test'), ('00000000-0000-0000-0000-0000000000d4', 'out@test');
insert into public.staff (user_id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Dr Test PG'), ('00000000-0000-0000-0000-0000000000b2', 'Dr Test Faculty'),
  ('00000000-0000-0000-0000-0000000000c3', 'Test Nurse'), ('00000000-0000-0000-0000-0000000000d4', 'Outsider');
insert into public.unit_members (unit_id, user_id, role_code)
select u.id, x.uid::uuid, x.role from public.units u,
  (values ('00000000-0000-0000-0000-0000000000a1','postgraduate'), ('00000000-0000-0000-0000-0000000000b2','faculty'),
          ('00000000-0000-0000-0000-0000000000c3','staff_nurse')) x(uid, role)
where u.code = 'VI';

create temp table ctx as
select (select id from public.units where code = 'VI') unit6,
       (select id from public.institutions) inst,
       (select id from public.ward_beds where label = 'M1') bed_m1,
       (select id from public.ward_beds where label = 'M2') bed_m2;
grant select on ctx to anon, authenticated;

-- 1. anon sees nothing and cannot write
select pg_temp.as_user(null);
select pg_temp.expect_error('select count(*) from public.patients', 'permission denied');
reset role;

-- 2. outsider (signed in, no unit role) sees no patients and cannot register
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
do $$ begin
  if (select count(*) from public.units) = 0 then raise exception 'units should be visible'; end if;
  if (select count(*) from public.ward_beds) <> 0 then raise exception 'outsider must not see beds'; end if;
end $$;
select pg_temp.expect_error($q$insert into public.patients (institution_id, uhid, full_name, age_years, sex)
  select inst, 'X1', 'Nobody', 40, 'M' from ctx$q$, 'row-level security');
reset role;

-- 3. PG registers, admits, adds rounds
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.patients (institution_id, uhid, full_name, age_years, sex, phone)
select inst, 'TEST-0001', 'Ravi Kumar Test', 45, 'M', '9000000001' from ctx;
select pg_temp.expect_error($q$insert into public.patients (institution_id, uhid, full_name, age_years, sex)
  select inst, 'TEST-0001', 'Duplicate', 45, 'M' from ctx$q$, 'duplicate key');
do $$ begin
  if not exists (select 1 from public.find_possible_duplicates('Ravi Kumar Tst', null, 46)) then
    raise exception 'duplicate finder missed a similar name';
  end if;
end $$;
select public.admit_patient((select id from public.patients where uhid = 'TEST-0001'), unit6, 'IP-100', bed_m1,
  now(), 'emergency', 'Acute appendicitis') from ctx;
select pg_temp.expect_error($q$select public.admit_patient((select id from public.patients where uhid = 'TEST-0001'),
  unit6, 'IP-101', bed_m2) from ctx$q$, 'already has an active admission');

insert into public.patients (institution_id, uhid, full_name, age_years, sex)
select inst, 'TEST-0002', 'Second Patient', 30, 'M' from ctx;
select pg_temp.expect_error($q$select public.admit_patient((select id from public.patients where uhid = 'TEST-0002'),
  unit6, 'IP-102', bed_m1) from ctx$q$, 'already occupied');
select pg_temp.expect_error($q$select public.admit_patient((select id from public.patients where uhid = 'TEST-0002'),
  unit6, 'IP-100', bed_m2) from ctx$q$, 'IP number');

select public.add_ward_round(jsonb_build_object(
  'admission_id', (select id from public.admissions where ip_number = 'IP-100'),
  'clinical_status', 'stable', 'complaints', 'Pain abdomen', 'plan', 'NPO, IV fluids',
  'vitals', jsonb_build_object('pulse', 88, 'bp', '120/80')),
  '[{"kind":"investigation","description":"USG abdomen"}]'::jsonb);

-- PG cannot edit, delete or verify a round
update public.ward_round_entries set plan = 'changed';  -- RLS: 0 rows visible for update
do $$ begin if (select plan from public.ward_round_entries) <> 'NPO, IV fluids' then raise exception 'PG edited a round'; end if; end $$;
select pg_temp.expect_error($q$delete from public.ward_round_entries$q$, 'permission denied');
select pg_temp.expect_error($q$select public.verify_ward_round((select id from public.ward_round_entries limit 1))$q$, 'not found or already verified');
-- PG can amend with a reason
insert into public.ward_round_amendments (entry_id, field, new_value, reason)
select id, 'plan', 'NPO, IV fluids, IV antibiotics', 'Antibiotics omitted' from public.ward_round_entries;
do $$ begin
  if (select old_value from public.ward_round_amendments) <> 'NPO, IV fluids' then raise exception 'old_value wrong'; end if;
  if (select open_tasks from public.v_inpatients where ip_number = 'IP-100') <> 1 then raise exception 'task not open'; end if;
end $$;
-- second round closes the task, carries nothing else
select public.add_ward_round(jsonb_build_object(
  'admission_id', (select id from public.admissions where ip_number = 'IP-100'), 'clinical_status', 'critical',
  'round_type', 'evening'), '[]'::jsonb, array(select id from public.care_tasks));
do $$ begin
  if (select open_tasks from public.v_inpatients where ip_number = 'IP-100') <> 0 then raise exception 'task not closed'; end if;
  if (select rounds_today from public.v_inpatients where ip_number = 'IP-100') <> 2 then raise exception 'rounds_today wrong'; end if;
  if (select critical from public.v_census_today) <> 1 then raise exception 'critical count wrong'; end if;
  if (select male_ward from public.v_census_today) <> 1 then raise exception 'male ward count wrong'; end if;
end $$;
-- PG cannot verify a surgery date
select pg_temp.expect_error($q$insert into public.surgeries (admission_id, surgery_date, procedure_done, verified_at)
  select id, current_date, 'X', now() from public.admissions where ip_number = 'IP-100'$q$, 'round.verify');
-- PG cannot use the admin email lookup
select pg_temp.expect_error($q$select * from public.find_staff_by_email('fac@test')$q$, 'users.manage');
-- PG cannot discharge
select pg_temp.expect_error($q$select public.discharge_patient((select id from public.admissions where ip_number = 'IP-100'))$q$, 'ipd.discharge');
reset role;

-- 4. Faculty verifies; verified entry is then frozen
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.verify_ward_round(id) from public.ward_round_entries where round_type = 'morning';
select pg_temp.expect_error($q$update public.ward_round_entries set verified_at = now() where round_type = 'morning'$q$, 'cannot be edited');
-- verified surgery gives POD (faculty may verify)
insert into public.surgeries (admission_id, surgery_date, procedure_done, verified_by, verified_at)
select id, private.today_ist() - 2, 'Lap appendicectomy', auth.uid(), now() from public.admissions where ip_number = 'IP-100';
do $$ begin
  if (select postop_day from public.v_inpatients where ip_number = 'IP-100') <> 2 then raise exception 'POD wrong'; end if;
end $$;
select public.move_patient_bed((select id from public.admissions where ip_number = 'IP-100'), bed_m2, 'Bed change') from ctx;
select public.discharge_patient((select id from public.admissions where ip_number = 'IP-100'));
do $$ begin
  if (select discharged_today from public.v_census_today) <> 1 then raise exception 'discharge count wrong'; end if;
  if (select total_admitted from public.v_census_today) <> 0 then raise exception 'total wrong'; end if;
end $$;
select pg_temp.expect_error($q$select public.add_ward_round(jsonb_build_object('admission_id',
  (select id from public.admissions where ip_number = 'IP-100'), 'clinical_status', 'stable'))$q$, 'active admission');
reset role;

-- 5. Nurse can read but not write
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$ begin if (select count(*) from public.patients) <> 2 then raise exception 'nurse should read patients'; end if; end $$;
select pg_temp.expect_error($q$insert into public.patients (institution_id, uhid, full_name, age_years, sex)
  select inst, 'N1', 'Nurse Entry', 20, 'F' from ctx$q$, 'row-level security');
reset role;

-- 6. admin lookups and last-admin guard
insert into auth.users values ('00000000-0000-0000-0000-0000000000e5', 'adm@test');
insert into public.staff (user_id, full_name, email) values ('00000000-0000-0000-0000-0000000000e5', 'Admin', 'adm@test');
insert into public.unit_members (unit_id, user_id, role_code) select unit6, '00000000-0000-0000-0000-0000000000e5', 'admin' from ctx;
update public.staff set email = 'Fac@Test' where user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e5');
do $$ begin
  if (select full_name from public.find_staff_by_email('fac@test')) <> 'Dr Test Faculty' then raise exception 'lookup failed'; end if;
end $$;
select pg_temp.expect_error($q$delete from public.unit_members where role_code = 'admin'$q$, 'at least one administrator');
reset role;

-- 7. intern: can write a round, cannot admit, discharge or verify
insert into auth.users values ('00000000-0000-0000-0000-0000000000f6', 'intern@test');
insert into public.staff (user_id, full_name) values ('00000000-0000-0000-0000-0000000000f6', 'Intern');
insert into public.unit_members (unit_id, user_id, role_code) select unit6, '00000000-0000-0000-0000-0000000000f6', 'intern' from ctx;
insert into public.patients (institution_id, uhid, full_name, age_years, sex) select inst, 'TEST-0003', 'Third Patient', 50, 'F' from ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.admit_patient((select id from public.patients where uhid = 'TEST-0003'), unit6, 'IP-103', bed_m1) from ctx;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
select pg_temp.expect_error($q$select public.add_ward_round(jsonb_build_object('admission_id', (select id from public.admissions where ip_number = 'IP-103'), 'clinical_status', 'stable'))$q$, 'row-level security');
select pg_temp.expect_error($q$insert into public.patients (institution_id, uhid, full_name, age_years, sex) select inst, 'I9', 'Intern Entry', 30, 'M' from ctx$q$, 'row-level security');
do $$ begin if (select count(*) from public.v_inpatients) < 1 then raise exception 'intern cannot view inpatients'; end if; end $$;
select pg_temp.expect_error($q$select public.admit_patient((select id from public.patients where uhid = 'TEST-0002'), unit6, 'IP-104', bed_m2) from ctx$q$, 'ipd.write');
select pg_temp.expect_error($q$select public.discharge_patient((select id from public.admissions where ip_number = 'IP-103'))$q$, 'ipd.discharge');
select pg_temp.expect_error($q$insert into public.investigations (admission_id, name) select id, 'CBC' from public.admissions where ip_number = 'IP-103'$q$, 'row-level security');
reset role;

-- 8. report log: PG may log own report, nurse sees only own rows, cannot log as someone else
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.report_log (unit_id, kind, format) select unit6, 'unit', 'print' from ctx;
select pg_temp.expect_error($q$insert into public.report_log (unit_id, kind, format, generated_by) select unit6, 'unit', 'xlsx', '00000000-0000-0000-0000-0000000000b2' from ctx$q$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$ begin if (select count(*) from public.report_log) <> 0 then raise exception 'nurse sees others report log'; end if; end $$;
reset role;

-- 9. ward module: occupied bed cannot be switched off; snapshot captures today's data
insert into auth.users values ('00000000-0000-0000-0000-0000000000a7', 'admin2@test');
insert into public.staff (user_id, full_name) values ('00000000-0000-0000-0000-0000000000a7', 'Admin Two');
insert into public.unit_members (unit_id, user_id, role_code) select unit6, '00000000-0000-0000-0000-0000000000a7', 'admin' from ctx;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select pg_temp.expect_error($q$update public.ward_beds set active = false where label = 'M1'$q$, 'has a patient in it');
update public.ward_beds set active = false where label = 'M30';
update public.unit_settings set morning_report_hour = 9;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.add_ward_round(jsonb_build_object('admission_id', (select id from public.admissions where ip_number = 'IP-103'), 'clinical_status', 'stable'));
reset role;
select private.take_ward_snapshot((select unit6 from ctx), private.today_ist());
do $$ declare d jsonb; begin
  select data into d from public.daily_report_snapshots;
  if jsonb_array_length(d->'pts') <> 1 then raise exception 'snapshot pts wrong: %', jsonb_array_length(d->'pts'); end if;
  if jsonb_array_length(d->'entries') < 1 then raise exception 'snapshot entries missing'; end if;
  if (d->'entries'->0->'author'->>'full_name') is null then raise exception 'snapshot author missing'; end if;
  if (d->'census'->>'total_admitted')::int <> 1 then raise exception 'snapshot census wrong'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$ begin if (select count(*) from public.daily_report_snapshots) <> 1 then raise exception 'nurse cannot read snapshot'; end if; end $$;
select pg_temp.expect_error($q$select private.take_ward_snapshot(unit6, current_date) from ctx$q$, 'permission denied');
select public.save_ward_snapshot_now(unit6) from ctx;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect_error($q$select public.save_ward_snapshot_now(unit6) from ctx$q$, 'report.generate');
reset role;

-- 10. spec roles: faculty has complete access; archive; notifications
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ begin if not private.has_perm((select unit6 from ctx), 'users.manage') then raise exception 'faculty lacks users.manage'; end if; end $$;
select pg_temp.expect_error($q$select public.archive_patient((select id from public.patients where uhid = 'TEST-0003'), 'dup')$q$, 'is admitted');
select pg_temp.expect_error($q$select public.archive_patient((select id from public.patients where uhid = 'TEST-0002'), 'x')$q$, 'reason');
select public.archive_patient((select id from public.patients where uhid = 'TEST-0002'), 'Duplicate registration');
do $$ begin if exists (select 1 from public.search_patients('Second')) then raise exception 'archived patient still searchable'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$select public.archive_patient((select id from public.patients where uhid = 'TEST-0001'), 'no reason')$q$, 'patient.archive');
insert into public.ward_round_amendments (entry_id, field, new_value, reason)
select id, 'plan', 'Revised plan', 'Clarified plan' from public.ward_round_entries where admission_id = (select id from public.admissions where ip_number = 'IP-103') limit 1;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ begin if (select count(*) from public.notifications where title = 'Ward-round note amended') < 1 then raise exception 'faculty not notified'; end if; end $$;
update public.notifications set read_at = now();
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin if (select count(*) from public.notifications) <> 0 then raise exception 'PG sees others notifications or got own'; end if; end $$;
reset role;

-- 11. audit trail was written
do $$ begin
  if (select count(*) from public.audit_logs where table_name = 'ward_round_entries') < 3 then raise exception 'audit missing'; end if;
end $$;
select 'ALL TESTS PASSED' as result;
