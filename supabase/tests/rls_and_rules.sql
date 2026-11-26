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

-- 11. personnel and automatic bed assignment
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into public.unit_personnel (unit_id, full_name, category, pg_year, user_id) select unit6, 'Dr PG One', 'pg', 1, '00000000-0000-0000-0000-0000000000a1' from ctx;
do $$ begin if (select count(*) from public.unit_personnel where category = 'consultant') <> 2 then raise exception 'consultants not seeded'; end if; end $$;
insert into public.patients (institution_id, uhid, full_name, age_years, sex, allergy_status) select inst, 'TEST-0004', 'Fourth Patient', 40, 'M', 'no' from ctx;
create temp table got as select * from public.admit_patient_auto((select id from public.patients where uhid = 'TEST-0004'),
  (select unit6 from ctx), 'IP-200', (select id from public.wards where code = 'MSW'), now(), 'elective', 'Hernia',
  (select id from public.unit_personnel where full_name = 'Dr. Ray'), (select id from public.unit_personnel where full_name = 'Dr PG One'));
do $$ begin
  if (select bed_label from got) is null then raise exception 'no bed assigned'; end if;
  if (select consultant_name from public.v_inpatients where ip_number = 'IP-200') <> 'Dr. Ray' then raise exception 'consultant name missing'; end if;
  if (select assigned_pg_id from public.v_inpatients where ip_number = 'IP-200') <> '00000000-0000-0000-0000-0000000000a1' then raise exception 'pg user link missing'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$insert into public.unit_personnel (unit_id, full_name, category) select unit6, 'X Y', 'pg' from ctx$q$, 'row-level security');
reset role;

-- 12. ward workflow: booking, call, pre-op, OT list, outcome, tasks, investigations
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error($q$insert into public.surgery_waitlist (patient_id, unit_id, list_type, planned_procedure)
  select (select id from public.patients where uhid = 'TEST-0004'), unit6, 'major', 'Hernioplasty' from ctx$q$, 'mobile number');
update public.patients set phone = '9000000004' where uhid = 'TEST-0004';
insert into public.surgery_waitlist (patient_id, unit_id, list_type, planned_procedure, diagnosis, priority)
  select (select id from public.patients where uhid = 'TEST-0004'), unit6, 'major', 'Lap cholecystectomy', 'Gallstones', 'routine' from ctx;
insert into public.unit_personnel (unit_id, full_name, category, user_id) select unit6, 'Intern One', 'intern', '00000000-0000-0000-0000-0000000000f6' from ctx;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.booking_calls (booking_id, outcome) select id, 'willing' from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy';
do $$ begin
  if (select contact_status || contact_attempts from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy') <> 'willing1' then raise exception 'call not tracked'; end if;
  if (select preop_ready from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy') then raise exception 'preop should be incomplete'; end if;
end $$;
update public.surgery_waitlist set pac_status = 'fit', consent_status = 'taken', investigations_ok = true where planned_procedure = 'Lap cholecystectomy';
do $$ begin if not (select preop_ready from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy') then raise exception 'preop should be ready'; end if; end $$;
insert into public.ot_lists (unit_id, service, list_date, ot_room) select unit6, 'major', current_date, 'OT 3' from ctx;
select public.add_booking_to_list((select id from public.ot_lists where ot_room = 'OT 3'), (select id from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy'));
select pg_temp.expect_error($q$select public.add_booking_to_list((select id from public.ot_lists where ot_room = 'OT 3'), (select id from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy'))$q$, 'already on an OT list');
insert into public.ot_cases (list_id, manual_name, manual_age_sex, procedure) select id, 'Walk-in Case', '30/M', 'Excision of lipoma' from public.ot_lists where ot_room = 'OT 3';
do $$ begin if (select status from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy') <> 'scheduled' then raise exception 'booking not scheduled'; end if; end $$;
select pg_temp.expect_error($q$update public.ot_lists set status = 'final' where ot_room = 'OT 3'$q$, 'ot.approve');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
update public.ot_lists set status = 'final' where ot_room = 'OT 3';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$update public.ot_cases set procedure = 'Open cholecystectomy' where procedure = 'Lap cholecystectomy'$q$, 'final');
select public.set_ot_case_outcome((select id from public.ot_cases where procedure = 'Lap cholecystectomy'), 'done', null,
  '{"findings":"Thick-walled gallbladder","postop_diagnosis":"Chronic cholecystitis","blood_loss_ml":"50","start_time":"09:10","specimen":"Gallbladder for HPE"}');
select pg_temp.expect_error($q$select public.set_ot_case_outcome((select id from public.ot_cases where manual_name = 'Walk-in Case'), 'cancelled', '')$q$, 'reason');
select public.set_ot_case_outcome((select id from public.ot_cases where manual_name = 'Walk-in Case'), 'postponed', 'OT time over');
do $$ begin
  if (select status from public.surgery_waitlist where planned_procedure = 'Lap cholecystectomy') <> 'completed' then raise exception 'booking not completed'; end if;
  if not exists (select 1 from public.surgeries s join public.admissions a on a.id = s.admission_id where a.ip_number = 'IP-200' and s.procedure_done = 'Lap cholecystectomy' and s.blood_loss_ml = 50 and s.specimen = 'Gallbladder for HPE') then raise exception 'surgery not recorded with intra-op note'; end if;
end $$;
insert into public.care_tasks (unit_id, kind, description, assigned_person_id) select unit6, 'records', 'Update OT register', (select id from public.unit_personnel where full_name = 'Intern One') from ctx;
insert into public.investigations (admission_id, name) select id, 'USG abdomen' from public.admissions where ip_number = 'IP-200';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
select public.set_task_status((select id from public.care_tasks where description = 'Update OT register'), 'in_progress');
select public.set_task_status((select id from public.care_tasks where description = 'Update OT register'), 'done');
select pg_temp.expect_error($q$select public.set_task_status((select id from public.care_tasks where description = 'Update OT register'), 'verified')$q$, 'task.verify');
select public.mark_investigation_collected((select id from public.investigations where name = 'USG abdomen'));
select pg_temp.expect_error($q$insert into public.surgery_waitlist (patient_id, unit_id, list_type, planned_procedure)
  select (select id from public.patients where uhid = 'TEST-0001'), unit6, 'minor', 'X' from ctx$q$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select public.set_task_status((select id from public.care_tasks where description = 'Update OT register'), 'verified');
do $$ begin
  if (select status from public.care_tasks where description = 'Update OT register') <> 'verified' then raise exception 'task not verified'; end if;
  if (select collected_at from public.investigations where name = 'USG abdomen') is null then raise exception 'not collected'; end if;
  if (select count(*) from public.v_waiting_list) < 1 then raise exception 'waiting list view empty'; end if;
end $$;
reset role;
-- a task not assigned to the intern cannot be moved by them
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.care_tasks (unit_id, kind, description) select unit6, 'admin', 'Unassigned task' from ctx;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
select pg_temp.expect_error($q$select public.set_task_status((select id from public.care_tasks where description = 'Unassigned task'), 'done')$q$, 'not assigned to you');
reset role;

-- 13. automation outbox, serial results, dressings, USG, statistics
do $$ begin
  if not exists (select 1 from public.workflow_events where event_type = 'admission.created') then raise exception 'no admission event'; end if;
  if not exists (select 1 from public.workflow_events where event_type = 'ot_list.finalised') then raise exception 'no ot list event'; end if;
  if not exists (select 1 from public.workflow_events where event_type = 'investigation.ordered') then raise exception 'no investigation event'; end if;
end $$;
select private.emit_event((select unit6 from ctx), 'admission.created', 'admissions', gen_random_uuid(), (select dedupe_key from public.workflow_events where event_type = 'admission.created' limit 1));
do $$ begin if (select count(*) from public.workflow_events where event_type = 'admission.created' and dedupe_key = (select dedupe_key from public.workflow_events where event_type = 'admission.created' order by id limit 1)) <> 1 then raise exception 'dedupe failed'; end if; end $$;
create temp table claimed as select * from automation.claim_events(100);
do $$ begin if (select count(*) from claimed) < 3 then raise exception 'claim failed'; end if; end $$;
select automation.complete_event((select min(id) from claimed), true);
select automation.log_run('B-ward-summary', 'success', (select min(id) from claimed));
do $$ begin if (select status from public.workflow_events where id = (select min(id) from claimed)) <> 'done' then raise exception 'complete failed'; end if;
  if not exists (select 1 from public.workflow_logs where workflow = 'B-ward-summary' and unit_id is not null) then raise exception 'log failed'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$select * from automation.claim_events(1)$q$, 'permission denied');
insert into public.investigation_results (investigation_id, value, abnormal) select id, 'Hb 9.8', true from public.investigations where name = 'USG abdomen';
insert into public.investigation_results (investigation_id, value) select id, 'Hb 10.6' from public.investigations where name = 'USG abdomen';
do $$ begin
  if (select result from public.investigations where name = 'USG abdomen') <> 'Hb 10.6' then raise exception 'latest result not shown'; end if;
  if (select count(*) from public.investigation_results r join public.investigations i on i.id = r.investigation_id where i.name = 'USG abdomen') <> 2 then raise exception 'serial results missing'; end if;
end $$;
select pg_temp.expect_error($q$update public.investigation_results set value = 'x'$q$, '');
insert into public.surgery_waitlist (patient_id, unit_id, list_type, planned_procedure) select (select id from public.patients where uhid = 'TEST-0004'), unit6, 'usg', 'USG-guided aspiration' from ctx;
insert into public.ot_lists (unit_id, service, list_date, ot_room) select unit6, 'usg', current_date, 'USG room' from ctx;
select public.add_booking_to_list((select id from public.ot_lists where service = 'usg'), (select id from public.surgery_waitlist where list_type = 'usg'));
select public.set_ot_case_outcome((select id from public.ot_cases where procedure = 'USG-guided aspiration'), 'done', null, '{"findings":"20 ml pus"}');
do $$ begin if exists (select 1 from public.surgeries where procedure_done = 'USG-guided aspiration') then raise exception 'USG should not create surgery'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
insert into public.dressing_records (admission_id, site, wound_status, findings) select id, 'Port sites', 'healthy', 'Clean, dry' from public.admissions where ip_number = 'IP-200';
update public.dressing_records set findings = 'changed';
do $$ begin if exists (select 1 from public.dressing_records where findings = 'changed') then raise exception 'intern should not edit dressings'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  if (select count(*) from public.v_stats_ot_monthly) = 0 then raise exception 'ot stats empty'; end if;
  if (select count(*) from public.v_stats_weekly) = 0 then raise exception 'weekly stats empty'; end if;
  if (select count(*) from public.v_stats_activity_monthly) = 0 then raise exception 'activity stats empty'; end if;
  perform * from public.v_stats_occupancy_monthly; perform * from public.v_stats_procedures_monthly;
end $$;
reset role;

-- 14. in-database automation sends notifications
update public.investigations set assigned_person_id = (select id from public.unit_personnel where full_name = 'Intern One') where name = 'USG abdomen';
update public.workflow_events set status = 'pending', attempts = 0 where event_type in ('admission.created','ot_list.finalised','investigation.resulted','investigation.ordered','discharge.started');
do $$ declare n int; begin
  n := private.process_workflow_events();
  if n = 0 then raise exception 'no notifications from events'; end if;
  if exists (select 1 from public.workflow_events where status in ('pending','failed')) then raise exception 'events left unprocessed: %', (select string_agg(event_type || ':' || coalesce(last_error, ''), '; ') from public.workflow_events where status in ('pending','failed')); end if;
  if not exists (select 1 from public.notifications where title like '%list final%') then raise exception 'no OT list notification'; end if;
  if not exists (select 1 from public.notifications where title like '%Result%') then raise exception 'no result notification'; end if;
  if not exists (select 1 from public.notifications where title like 'Test to follow up%') then raise exception 'no follow-up notification'; end if;
  perform private.daily_digest(); perform private.weekly_reminders();
  if not exists (select 1 from public.workflow_logs where workflow = 'daily-digest') then raise exception 'digest not logged'; end if;
end $$;

-- 15. duty reports, leave, protocols
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.duty_reports (unit_id, duty_date, shift, handover) select unit6, current_date, 'night', 'Bed 3 to watch drain output' from ctx;
reset role;
do $$ begin if not exists (select 1 from public.notifications where title = 'Duty report to review') then raise exception 'no duty notification'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$update public.duty_reports set status = 'reviewed'$q$, 'duty.review');
insert into public.leave_requests (unit_id, kind, from_date, to_date, reason) select unit6, 'casual', current_date + 3, current_date + 4, 'Family function' from ctx;
select pg_temp.expect_error($q$update public.leave_requests set status = 'approved'$q$, 'leave.approve');
select pg_temp.expect_error($q$insert into public.protocols (unit_id, category, title, body) select unit6, 'antibiotics', 'Prophylaxis', 'Cefazolin 2 g' from ctx$q$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
update public.duty_reports set status = 'reviewed', review_note = 'Seen' where shift = 'night';
update public.leave_requests set status = 'approved', decision_note = 'Arrange cover' where reason = 'Family function';
insert into public.protocols (unit_id, category, title, body) select unit6, 'antibiotics', 'Surgical prophylaxis', 'Cefazolin 2 g IV within 60 min of incision' from ctx;
update public.protocols set body = 'Cefazolin 2 g IV within 60 min of incision; repeat after 4 h' where title = 'Surgical prophylaxis';
do $$ begin
  if (select reviewed_by from public.duty_reports where shift = 'night') is null then raise exception 'review not stamped'; end if;
  if (select version from public.protocols where title = 'Surgical prophylaxis') <> 2 then raise exception 'version not bumped'; end if;
end $$;
reset role;
do $$ begin if not exists (select 1 from public.notifications where title = 'Leave approved') then raise exception 'no leave decision notification'; end if; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
update public.duty_reports set handover = 'changed' where shift = 'night';
do $$ begin if exists (select 1 from public.duty_reports where handover = 'changed') then raise exception 'reviewed report was changed'; end if; end $$;
do $$ begin if (select count(*) from public.protocols) <> 1 then raise exception 'PG cannot read protocols'; end if; end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
insert into public.leave_requests (unit_id, kind, from_date, to_date) select unit6, 'medical', current_date, current_date from ctx;
do $$ begin if (select count(*) from public.leave_requests) <> 2 then raise exception 'intern should see own pending and approved leave'; end if; end $$;
select pg_temp.expect_error($q$select 1 from public.duty_reports limit 1; insert into public.duty_reports (unit_id, duty_date, shift, handover) select unit6, current_date, 'day', 'x' from ctx$q$, 'row-level security');
reset role;

-- 16. audit trail was written
do $$ begin
  if (select count(*) from public.audit_logs where table_name = 'ward_round_entries') < 3 then raise exception 'audit missing'; end if;
end $$;
select 'ALL TESTS PASSED' as result;
