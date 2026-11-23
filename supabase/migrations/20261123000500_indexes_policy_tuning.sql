-- Surgery Unit OS · 0005 indexes for foreign keys used in lookups, and
-- per-statement (not per-row) evaluation of auth.uid() in policies.
create index if not exists diagnoses_admission_idx on public.diagnoses (admission_id);
create index if not exists investigations_admission_idx on public.investigations (admission_id);
create index if not exists medication_records_admission_idx on public.medication_records (admission_id);
create index if not exists documents_patient_idx on public.documents (patient_id);
create index if not exists documents_admission_idx on public.documents (admission_id);
create index if not exists surgery_waitlist_patient_idx on public.surgery_waitlist (patient_id);
create index if not exists surgery_waitlist_admission_idx on public.surgery_waitlist (admission_id);
create index if not exists admissions_pg_idx on public.admissions (assigned_pg_id);
create index if not exists admissions_consultant_idx on public.admissions (consultant_id);
create index if not exists ward_round_entries_entered_by_idx on public.ward_round_entries (entered_by);
create index if not exists care_tasks_raised_entry_idx on public.care_tasks (raised_entry_id);
create index if not exists unit_members_unit_idx on public.unit_members (unit_id) where active;

drop policy staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.unit_members mine
             join public.unit_members theirs on theirs.unit_id = mine.unit_id
             where mine.user_id = (select auth.uid()) and mine.active and theirs.user_id = staff.user_id)
);
drop policy staff_self_insert on public.staff;
create policy staff_self_insert on public.staff for insert to authenticated
  with check (user_id = (select auth.uid()) and active);
drop policy staff_self_update on public.staff;
drop policy staff_admin_update on public.staff;
create policy staff_update on public.staff for update to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.unit_members m where m.user_id = staff.user_id
             and private.has_perm(m.unit_id, 'users.manage'))
);

drop policy members_read on public.unit_members;
drop policy members_manage on public.unit_members;
create policy members_read on public.unit_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(unit_id));
create policy members_ins on public.unit_members for insert to authenticated
  with check (private.has_perm(unit_id, 'users.manage'));
create policy members_upd on public.unit_members for update to authenticated
  using (private.has_perm(unit_id, 'users.manage')) with check (private.has_perm(unit_id, 'users.manage'));
create policy members_del on public.unit_members for delete to authenticated
  using (private.has_perm(unit_id, 'users.manage'));

drop policy manage on public.wards;
create policy ins on public.wards for insert to authenticated with check (private.has_perm(unit_id, 'settings.manage'));
create policy upd on public.wards for update to authenticated
  using (private.has_perm(unit_id, 'settings.manage')) with check (private.has_perm(unit_id, 'settings.manage'));
drop policy manage on public.ward_beds;
create policy ins on public.ward_beds for insert to authenticated with check (private.has_perm(unit_id, 'settings.manage'));
create policy upd on public.ward_beds for update to authenticated
  using (private.has_perm(unit_id, 'settings.manage')) with check (private.has_perm(unit_id, 'settings.manage'));
-- Beds and wards are deactivated, never deleted (they are referenced by history).
revoke delete on public.wards, public.ward_beds from authenticated;
