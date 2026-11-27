-- Surgery Unit OS · 0018 performance advisor fixes.
-- * auth.uid() in policies evaluated once per query, not per row.
-- * covering indexes for foreign keys flagged by the advisor (unit app tables only).

drop policy if exists read on public.pending_actions;
create policy read on public.pending_actions for select to authenticated using (created_by = (select auth.uid()));

drop policy if exists ins on public.duty_reports;
drop policy if exists upd on public.duty_reports;
create policy ins on public.duty_reports for insert to authenticated
  with check (private.has_perm(unit_id, 'duty.submit') and submitted_by = (select auth.uid()) and status = 'submitted');
create policy upd on public.duty_reports for update to authenticated
  using ((submitted_by = (select auth.uid()) and status = 'submitted') or private.has_perm(unit_id, 'duty.review'))
  with check ((submitted_by = (select auth.uid()) and status = 'submitted') or private.has_perm(unit_id, 'duty.review'));

drop policy if exists read on public.leave_requests;
drop policy if exists ins on public.leave_requests;
drop policy if exists upd on public.leave_requests;
create policy read on public.leave_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.has_perm(unit_id, 'leave.approve') or (status = 'approved' and private.is_member(unit_id)));
create policy ins on public.leave_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and private.has_perm(unit_id, 'leave.apply'));
create policy upd on public.leave_requests for update to authenticated
  using (user_id = (select auth.uid()) or private.has_perm(unit_id, 'leave.approve'))
  with check (user_id = (select auth.uid()) or private.has_perm(unit_id, 'leave.approve'));

create index if not exists admissions_unit_chief_idx on public.admissions (unit_chief_id);
create index if not exists bed_assignments_unit_idx on public.bed_assignments (unit_id);
create index if not exists booking_calls_unit_idx on public.booking_calls (unit_id);
create index if not exists care_tasks_closed_entry_idx on public.care_tasks (closed_entry_id);
create index if not exists diagnoses_unit_idx on public.diagnoses (unit_id);
create index if not exists discharge_summaries_finalised_by_idx on public.discharge_summaries (finalised_by);
create index if not exists discharge_summaries_unit_idx on public.discharge_summaries (unit_id);
create index if not exists documents_unit_idx on public.documents (unit_id);
create index if not exists medication_records_unit_idx on public.medication_records (unit_id);
create index if not exists ot_cases_unit_idx on public.ot_cases (unit_id);
create index if not exists ot_lists_finalised_by_idx on public.ot_lists (finalised_by);
create index if not exists role_permissions_permission_idx on public.role_permissions (permission_code);
create index if not exists surgeries_unit_idx on public.surgeries (unit_id);
create index if not exists surgeries_verified_by_idx on public.surgeries (verified_by);
create index if not exists surgeries_waitlist_idx on public.surgeries (waitlist_id);
create index if not exists unit_members_role_idx on public.unit_members (role_code);
create index if not exists unit_personnel_user_idx on public.unit_personnel (user_id);
create index if not exists ward_beds_unit_idx on public.ward_beds (unit_id);
create index if not exists ward_round_amendments_amended_by_idx on public.ward_round_amendments (amended_by);
create index if not exists ward_round_amendments_unit_idx on public.ward_round_amendments (unit_id);
create index if not exists ward_round_entries_verified_by_idx on public.ward_round_entries (verified_by);
