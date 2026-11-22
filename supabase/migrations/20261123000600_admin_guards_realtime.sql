-- Surgery Unit OS · 0006 user lookup for admins, surgery verification rule,
-- last-admin protection, and Realtime publication of live tables.

-- Admins look up a signed-up colleague by email to give them a role.
create or replace function public.find_staff_by_email(p_email text)
returns table (user_id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
                 where m.user_id = auth.uid() and m.active and rp.permission_code = 'users.manage') then
    raise exception 'permission denied: users.manage required' using errcode = '42501';
  end if;
  return query select s.user_id, s.full_name from public.staff s
               where lower(s.email) = lower(trim(p_email)) and s.active limit 1;
end $$;
revoke execute on function public.find_staff_by_email(text) from public, anon;
grant execute on function public.find_staff_by_email(text) to authenticated;

-- Verifying a surgery date (which drives the postoperative day) needs round.verify.
-- Changing the date or procedure after verification clears the verification.
create or replace function private.surgery_verify_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.verified_at is not null
     and (new.surgery_date is distinct from old.surgery_date or new.procedure_done is distinct from old.procedure_done) then
    new.verified_at := null; new.verified_by := null;
  end if;
  if new.verified_at is not null and (tg_op = 'INSERT' or old.verified_at is null) then
    perform private.require_perm(new.unit_id, 'round.verify');
    new.verified_by := auth.uid();
    new.verified_at := now();
  end if;
  return new;
end $$;
-- zz_ so it runs after unit_from_admission has set unit_id.
create trigger zz_surgery_verify_guard before insert or update on public.surgeries
  for each row execute function private.surgery_verify_guard();

-- A unit must always keep at least one active administrator.
create or replace function private.keep_one_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.role_code = 'admin' and old.active
     and (tg_op = 'DELETE' or new.active = false or new.role_code <> 'admin')
     and not exists (select 1 from public.unit_members m where m.unit_id = old.unit_id and m.role_code = 'admin'
                     and m.active and m.id <> old.id) then
    raise exception 'A unit must keep at least one administrator.';
  end if;
  return coalesce(new, old);
end $$;
create trigger keep_one_admin before update or delete on public.unit_members
  for each row execute function private.keep_one_admin();

-- Realtime: clients refresh census, ward board and dashboards when these change.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['admissions','bed_assignments','ward_round_entries','diagnoses','surgeries','surgery_waitlist'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
