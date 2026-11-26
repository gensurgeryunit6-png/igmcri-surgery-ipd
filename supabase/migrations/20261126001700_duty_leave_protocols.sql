-- Surgery Unit OS · 0017 duty reports, leave and unit protocols.
-- Rollback: drop tables duty_reports, leave_requests, protocols and their functions; remove intern leave.apply.

insert into public.role_permissions (role_code, permission_code) values ('intern', 'leave.apply') on conflict do nothing;

-- ---------------------------------------------------------------- duty reports (handover)
create table public.duty_reports (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  duty_date date not null,
  shift text not null check (shift in ('day','night','emergency','on_call')),
  submitted_by uuid not null default auth.uid() references public.staff(user_id),
  census jsonb not null default '{}',
  admissions text,
  emergency_procedures text,
  critical_patients text,
  handover text not null check (length(trim(handover)) > 0),
  issues text,
  status text not null default 'submitted' check (status in ('submitted','reviewed')),
  reviewed_by uuid references public.staff(user_id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (unit_id, duty_date, shift, submitted_by),
  check ((status = 'reviewed') = (reviewed_at is not null))
);
create index duty_reports_unit_idx on public.duty_reports (unit_id, duty_date desc);
create index duty_reports_by_idx on public.duty_reports (submitted_by);
create index duty_reports_reviewer_idx on public.duty_reports (reviewed_by);
alter table public.duty_reports enable row level security;
create policy read on public.duty_reports for select to authenticated
  using (private.has_perm(unit_id, 'duty.submit') or private.has_perm(unit_id, 'duty.review'));
create policy ins on public.duty_reports for insert to authenticated
  with check (private.has_perm(unit_id, 'duty.submit') and submitted_by = auth.uid() and status = 'submitted');
create policy upd on public.duty_reports for update to authenticated
  using ((submitted_by = auth.uid() and status = 'submitted') or private.has_perm(unit_id, 'duty.review'))
  with check ((submitted_by = auth.uid() and status = 'submitted') or private.has_perm(unit_id, 'duty.review'));
grant select, insert, update on public.duty_reports to authenticated;
create trigger stamp before insert or update on public.duty_reports for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.duty_reports for each row execute function private.audit();

create or replace function private.duty_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.require_perm(new.unit_id, 'duty.review');
    if new.status = 'reviewed' then new.reviewed_by := auth.uid(); new.reviewed_at := now();
    else new.reviewed_by := null; new.reviewed_at := null; end if;
  elsif old.status = 'reviewed' and (new.handover, new.issues, new.critical_patients, new.admissions, new.emergency_procedures)
        is distinct from (old.handover, old.issues, old.critical_patients, old.admissions, old.emergency_procedures) then
    raise exception 'A reviewed duty report cannot be changed.';
  end if;
  return new;
end $$;
create trigger duty_guard before update on public.duty_reports for each row execute function private.duty_guard();

create or replace function private.duty_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_perm(new.unit_id, 'duty.review', 'Duty report to review',
    initcap(replace(new.shift, '_', ' ')) || ' duty · ' || to_char(new.duty_date, 'DD Mon') || ' · ' ||
    coalesce((select full_name from public.staff where user_id = new.submitted_by), ''), '/duty/?id=' || new.id, new.submitted_by);
  return null;
end $$;
create trigger duty_notify after insert on public.duty_reports for each row execute function private.duty_notify();

-- ---------------------------------------------------------------- leave
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  user_id uuid not null default auth.uid() references public.staff(user_id),
  kind text not null check (kind in ('casual','earned','medical','academic','duty_leave','maternity','other')),
  from_date date not null,
  to_date date not null,
  reason text,
  cover_person_id uuid references public.unit_personnel(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.staff(user_id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (to_date >= from_date),
  check ((status in ('approved','rejected')) = (decided_at is not null))
);
create index leave_requests_unit_idx on public.leave_requests (unit_id, from_date desc);
create index leave_requests_user_idx on public.leave_requests (user_id);
create index leave_requests_cover_idx on public.leave_requests (cover_person_id);
create index leave_requests_decider_idx on public.leave_requests (decided_by);
alter table public.leave_requests enable row level security;
-- Everyone in the unit sees approved leave (who is away); pending and rejected requests only the applicant and approvers.
create policy read on public.leave_requests for select to authenticated
  using (user_id = auth.uid() or private.has_perm(unit_id, 'leave.approve') or (status = 'approved' and private.is_member(unit_id)));
create policy ins on public.leave_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and private.has_perm(unit_id, 'leave.apply'));
create policy upd on public.leave_requests for update to authenticated
  using (user_id = auth.uid() or private.has_perm(unit_id, 'leave.approve'))
  with check (user_id = auth.uid() or private.has_perm(unit_id, 'leave.approve'));
grant select, insert, update on public.leave_requests to authenticated;
create trigger stamp before insert or update on public.leave_requests for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.leave_requests for each row execute function private.audit();

create or replace function private.leave_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('approved','rejected') then
      perform private.require_perm(new.unit_id, 'leave.approve');
      if old.user_id = auth.uid() then raise exception 'You cannot decide your own leave.'; end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    elsif new.status = 'cancelled' then
      if old.user_id <> auth.uid() then perform private.require_perm(new.unit_id, 'leave.approve'); end if;
      if old.status = 'approved' and old.from_date <= (now() at time zone 'Asia/Kolkata')::date and old.user_id = auth.uid() then
        raise exception 'Leave that has started can be cancelled only by an approver.';
      end if;
      new.decided_by := null; new.decided_at := null;
    else
      raise exception 'Not allowed.';
    end if;
  elsif old.status <> 'pending' and (new.from_date, new.to_date, new.kind, new.reason, new.cover_person_id)
        is distinct from (old.from_date, old.to_date, old.kind, old.reason, old.cover_person_id) then
    raise exception 'Only a pending request can be changed.';
  end if;
  if new.user_id is distinct from old.user_id or new.unit_id is distinct from old.unit_id then raise exception 'Not allowed.'; end if;
  return new;
end $$;
create trigger leave_guard before update on public.leave_requests for each row execute function private.leave_guard();

create or replace function private.leave_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_who text := (select full_name from public.staff where user_id = new.user_id);
  v_when text := to_char(new.from_date, 'DD Mon') || case when new.to_date > new.from_date then ' – ' || to_char(new.to_date, 'DD Mon') else '' end;
begin
  if tg_op = 'INSERT' then
    perform private.notify_perm(new.unit_id, 'leave.approve', 'Leave request · ' || v_who,
      initcap(replace(new.kind, '_', ' ')) || ' leave · ' || v_when, '/leave/', new.user_id);
  elsif new.status in ('approved','rejected') and new.status is distinct from old.status then
    insert into public.notifications (user_id, unit_id, title, body, link)
    values (new.user_id, new.unit_id, 'Leave ' || new.status, v_when || coalesce(' · ' || new.decision_note, ''), '/leave/');
  end if;
  return null;
end $$;
create trigger leave_notify after insert or update of status on public.leave_requests for each row execute function private.leave_notify();

-- ---------------------------------------------------------------- unit protocols
create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  category text not null check (category in ('preop','postop','antibiotics','emergency','wound','procedures','ward','other')),
  title text not null check (length(trim(title)) > 1),
  body text not null check (length(trim(body)) > 0),
  link text check (link is null or link ~* '^https://'),
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index protocols_unit_idx on public.protocols (unit_id, category) where active;
alter table public.protocols enable row level security;
create policy read on public.protocols for select to authenticated using (private.is_member(unit_id));
create policy ins on public.protocols for insert to authenticated with check (private.has_perm(unit_id, 'protocol.manage'));
create policy upd on public.protocols for update to authenticated
  using (private.has_perm(unit_id, 'protocol.manage')) with check (private.has_perm(unit_id, 'protocol.manage'));
grant select, insert, update on public.protocols to authenticated;
create trigger stamp before insert or update on public.protocols for each row execute function private.stamp();
create trigger audit after insert or update or delete on public.protocols for each row execute function private.audit();

create or replace function private.protocol_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.title, new.body, new.link, new.category) is distinct from (old.title, old.body, old.link, old.category) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger protocol_version before update on public.protocols for each row execute function private.protocol_version();
