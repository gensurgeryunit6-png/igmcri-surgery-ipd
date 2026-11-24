-- Surgery Unit OS · 0008 report log: who generated or downloaded which report, when.
-- Rollback: drop table public.report_log;
create table public.report_log (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  kind text not null,
  format text not null check (format in ('print','xlsx')),
  parameters jsonb not null default '{}',
  generated_by uuid not null default auth.uid() references public.staff(user_id),
  generated_at timestamptz not null default now()
);
create index report_log_unit_idx on public.report_log (unit_id, generated_at desc);
create index report_log_user_idx on public.report_log (generated_by);
alter table public.report_log enable row level security;
create policy ins on public.report_log for insert to authenticated
  with check (private.has_perm(unit_id, 'report.generate') and generated_by = (select auth.uid()));
create policy read on public.report_log for select to authenticated
  using (generated_by = (select auth.uid()) or private.has_perm(unit_id, 'audit.read'));
grant select, insert on public.report_log to authenticated;
