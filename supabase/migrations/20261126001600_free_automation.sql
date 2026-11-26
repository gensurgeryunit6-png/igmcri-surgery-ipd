-- Surgery Unit OS · 0016 automation without paid services.
-- n8n is replaced by the database itself: pg_cron (free on Supabase) processes workflow_events every 5 minutes
-- and sends in-app notifications; a daily digest and weekly reminders run on schedule. Every run is logged in workflow_logs.
-- Rollback: unschedule the three cron jobs; drop the functions below.

create or replace function private.person_users(p_ids uuid[])
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct p.user_id from public.unit_personnel p where p.id = any(p_ids) and p.user_id is not null and p.active
$$;

create or replace function private.notify_users(p_users uuid[], p_unit uuid, p_title text, p_body text, p_link text, p_except uuid default null)
returns int language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.notifications (user_id, unit_id, title, body, link)
    select distinct u, p_unit, p_title, p_body, p_link from unnest(p_users) u
    join public.staff s on s.user_id = u and s.active
    where u is not null and u is distinct from p_except
    returning 1)
  select count(*)::int from ins
$$;

-- Turn pending events into notifications. Runs every 5 minutes.
create or replace function private.process_workflow_events()
returns int language plpgsql security definer set search_path = '' as $$
declare e public.workflow_events; n int; total int := 0; v_title text; v_body text; v_link text; v_users uuid[];
  r record;
begin
  for e in select * from public.workflow_events
           where status = 'pending' or (status = 'failed' and attempts < 3)
           order by id limit 200 for update skip locked loop
    begin
      n := 0;
      if e.event_type = 'admission.created' then
        select a.*, p.full_name, p.id as pid,
               (select b.label from public.bed_assignments ba join public.ward_beds b on b.id = ba.bed_id where ba.admission_id = a.id and ba.to_at is null limit 1) as bed,
               (select d.description from public.diagnoses d where d.admission_id = a.id order by d.created_at desc limit 1) as dx
          into r from public.admissions a join public.patients p on p.id = a.patient_id where a.id = e.entity_id;
        v_users := array(select private.person_users(array[r.consultant_person_id, r.asst_prof_person_id, r.pg_person_id, r.intern_person_id]))
                   || r.assigned_pg_id;
        n := private.notify_users(v_users, e.unit_id, 'New admission: ' || r.full_name,
               concat_ws(' · ', 'IP ' || r.ip_number, coalesce(r.bed, 'no bed yet'), r.dx), '/patient/?id=' || r.pid, r.created_by);
      elsif e.event_type = 'ot_list.finalised' then
        select l.*, (select count(*) from public.ot_cases c where c.list_id = l.id and c.status = 'planned') as cases into r
          from public.ot_lists l where l.id = e.entity_id;
        v_title := (case r.service when 'major' then 'Major OT' when 'minor' then 'Minor OT' when 'endoscopy' then 'Endoscopy' else 'USG' end)
                   || ' list final · ' || to_char(r.list_date, 'DD Mon');
        insert into public.notifications (user_id, unit_id, title, body, link)
        select distinct m.user_id, e.unit_id, v_title, concat_ws(' · ', r.cases || ' cases', nullif(r.ot_room, ''), initcap(r.session)), '/ot-list/?id=' || r.id
        from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
        join public.staff s on s.user_id = m.user_id and s.active
        where m.unit_id = e.unit_id and m.active and rp.permission_code = 'ot.prepare' and m.user_id is distinct from r.finalised_by;
        get diagnostics n = row_count;
      elsif e.event_type in ('investigation.resulted', 'investigation.ordered') then
        select i.*, p.full_name, p.id as pid, a.pg_person_id, a.assigned_pg_id into r
          from public.investigations i join public.admissions a on a.id = i.admission_id join public.patients p on p.id = a.patient_id
          where i.id = e.entity_id;
        if e.event_type = 'investigation.resulted' then
          v_users := coalesce(array(select private.person_users(array[r.assigned_person_id, r.pg_person_id])), '{}') || r.assigned_pg_id;
          n := private.notify_users(v_users, e.unit_id,
                 (case when r.abnormal then 'Abnormal result: ' else 'Result: ' end) || r.name || ' · ' || r.full_name,
                 left(r.result, 200), '/patient/?id=' || r.pid || '&tab=rounds', null);
        elsif r.assigned_person_id is not null then
          v_users := array(select private.person_users(array[r.assigned_person_id]));
          n := private.notify_users(v_users, e.unit_id, 'Test to follow up: ' || r.name, r.full_name, '/tasks/?v=tests', r.created_by);
        end if;
      elsif e.event_type = 'discharge.started' then
        select p.full_name, a.id as aid, ds.created_by into r
          from public.admissions a join public.patients p on p.id = a.patient_id
          left join public.discharge_summaries ds on ds.admission_id = a.id where a.id = e.entity_id;
        insert into public.notifications (user_id, unit_id, title, body, link)
        select distinct m.user_id, e.unit_id, 'Discharge summary to approve · ' || r.full_name, 'Started; needs faculty approval before discharge', '/discharge/?a=' || r.aid
        from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
        join public.staff s on s.user_id = m.user_id and s.active
        where m.unit_id = e.unit_id and m.active and rp.permission_code = 'round.verify' and m.user_id is distinct from r.created_by;
        get diagnostics n = row_count;
      end if;
      update public.workflow_events set status = case when n > 0 then 'done' else 'skipped' end, attempts = attempts + 1,
             processed_at = now(), last_error = null where id = e.id;
      total := total + n;
    exception when others then
      update public.workflow_events set status = 'failed', attempts = attempts + 1, last_error = left(sqlerrm, 2000) where id = e.id;
      insert into public.workflow_logs (unit_id, workflow, event_id, status, finished_at, error)
      values (e.unit_id, 'notify', e.id, 'error', now(), left(sqlerrm, 2000));
    end;
  end loop;
  if total > 0 then
    insert into public.workflow_logs (workflow, status, finished_at, details) values ('notify', 'success', now(), jsonb_build_object('notifications', total));
  end if;
  return total;
end $$;

-- 08:00 IST: each person's own pending tests and tasks.
create or replace function private.daily_digest()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.notifications (user_id, unit_id, title, body, link)
  select p.user_id, p.unit_id, 'Today: your pending work',
         concat_ws(' · ', nullif(t.c, 0) || ' task' || case when t.c = 1 then '' else 's' end,
                          nullif(i.c, 0) || ' test' || case when i.c = 1 then '' else 's' end || ' to follow up'),
         '/tasks/'
  from public.unit_personnel p
  join public.staff s on s.user_id = p.user_id and s.active
  cross join lateral (select count(*)::int c from public.care_tasks x where x.assigned_person_id = p.id and x.status in ('open','in_progress')) t
  cross join lateral (select count(*)::int c from public.investigations x where x.assigned_person_id = p.id and x.status = 'pending') i
  where p.active and p.user_id is not null and (t.c + i.c) > 0;
  get diagnostics n = row_count;
  insert into public.workflow_logs (workflow, status, finished_at, details) values ('daily-digest', 'success', now(), jsonb_build_object('notifications', n));
  return n;
end $$;

-- Monday 08:05 IST: weekly figures for report readers; backup reminder for administrators.
create or replace function private.weekly_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare u record; n int := 0; k int;
begin
  for u in select id from public.units loop
    insert into public.notifications (user_id, unit_id, title, body, link)
    select distinct m.user_id, u.id, 'Weekly report ready',
      (select concat(coalesce(sum(admissions), 0), ' admissions · ', coalesce(sum(discharges), 0), ' discharges last week')
         from public.v_stats_weekly w where w.unit_id = u.id
         and w.week = date_trunc('week', (now() at time zone 'Asia/Kolkata') - interval '7 days')::date),
      '/reports/'
    from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
    join public.staff s on s.user_id = m.user_id and s.active
    where m.unit_id = u.id and m.active and rp.permission_code = 'report.generate'
      and exists (select 1 from public.admissions a where a.unit_id = u.id);
    get diagnostics k = row_count; n := n + k;
    insert into public.notifications (user_id, unit_id, title, body, link)
    select distinct m.user_id, u.id, 'Weekly backup', 'Download this week''s backup of all unit records and keep it safe.', '/backup/'
    from public.unit_members m join public.role_permissions rp on rp.role_code = m.role_code
    join public.staff s on s.user_id = m.user_id and s.active
    where m.unit_id = u.id and m.active and rp.permission_code = 'users.manage'
      and exists (select 1 from public.patients limit 1);
    get diagnostics k = row_count; n := n + k;
  end loop;
  insert into public.workflow_logs (workflow, status, finished_at, details) values ('weekly-reminders', 'success', now(), jsonb_build_object('notifications', n));
  return n;
end $$;

-- Events raised before this automation existed are not replayed.
update public.workflow_events set status = 'skipped', processed_at = now() where status = 'pending' and created_at < now() - interval '1 day';

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('process-workflow-events', '*/5 * * * *', 'select private.process_workflow_events()');
    perform cron.schedule('daily-digest', '30 2 * * *', 'select private.daily_digest()');
    perform cron.schedule('weekly-reminders', '35 2 * * 1', 'select private.weekly_reminders()');
  end if;
end $$;
