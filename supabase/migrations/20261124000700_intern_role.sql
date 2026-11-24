-- Surgery Unit OS · 0007 Intern role.
-- Interns can register patients and write ward-round notes, but cannot admit,
-- move beds, order tests, discharge, amend, verify or touch OT lists.
-- Rollback: delete from public.role_permissions where role_code = 'intern';
--           delete from public.roles where code = 'intern';
insert into public.roles (code, name, rank) values ('intern', 'Intern', 45)
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select 'intern', p from unnest(array['patient.read','patient.write','ipd.read','round.write','report.generate']) p
on conflict do nothing;
