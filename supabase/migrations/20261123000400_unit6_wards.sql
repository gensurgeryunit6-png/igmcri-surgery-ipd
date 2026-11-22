-- Surgery Unit OS · 0004 Unit VI wards and beds (starting configuration).
-- Bed counts are placeholders; administrators change them in Settings.
insert into public.wards (unit_id, code, name, kind, sort_order)
select u.id, w.code, w.name, w.kind, w.sort
from public.units u
join public.departments d on d.id = u.department_id and d.code = 'GS'
cross join (values ('MSW','Male Surgical Ward','male',1),
                   ('FSW','Female Surgical Ward','female',2),
                   ('SW','Special Ward','special',3),
                   ('EMG','Emergency / Other beds','emergency',4)) w(code, name, kind, sort)
where u.code = 'VI';

insert into public.ward_beds (ward_id, unit_id, label, sort_order)
select w.id, w.unit_id, prefix || n, n
from public.wards w
join lateral (values (case w.code when 'MSW' then 'M' when 'FSW' then 'F' when 'SW' then 'S' else 'E' end,
                      case w.code when 'MSW' then 30 when 'FSW' then 30 when 'SW' then 10 else 6 end)) c(prefix, cnt) on true
cross join lateral generate_series(1, c.cnt) n;
