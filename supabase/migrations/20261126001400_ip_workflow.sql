-- Surgery Unit OS · 0014 inpatient workflow: intra-operative notes and follow-up.
-- * surgeries gets a full intra-operative note.
-- * admissions.follow_up_on: the follow-up date given at discharge (drives the OPD follow-up list).
-- * set_ot_case_outcome writes the full note into the surgery record.
-- Rollback: drop the added columns; restore set_ot_case_outcome from 0013.

alter table public.surgeries
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists anaesthetist text,
  add column if not exists position text,
  add column if not exists incision text,
  add column if not exists procedure_steps text,
  add column if not exists implants text,
  add column if not exists specimen text,
  add column if not exists drains text,
  add column if not exists blood_loss_ml int check (blood_loss_ml is null or blood_loss_ml >= 0),
  add column if not exists closure text,
  add column if not exists postop_diagnosis text,
  add column if not exists postop_instructions text;

alter table public.admissions add column if not exists follow_up_on date;
create index if not exists admissions_follow_up_idx on public.admissions (unit_id, follow_up_on) where follow_up_on is not null;

create or replace function public.set_ot_case_outcome(p_case uuid, p_status text, p_reason text default null,
  p_note jsonb default '{}')
returns void language plpgsql set search_path = '' as $$
declare c public.ot_cases; l public.ot_lists; v_surgery uuid; v_adm uuid;
  n jsonb := coalesce(p_note, '{}');
begin
  select * into strict c from public.ot_cases where id = p_case for update;
  select * into strict l from public.ot_lists where id = c.list_id;
  perform private.require_perm(c.unit_id, 'ot.prepare');
  if p_status not in ('planned','done','postponed','cancelled') then raise exception 'Unknown outcome %', p_status; end if;
  if p_status = 'done' then
    v_adm := coalesce(c.admission_id, (select a.id from public.admissions a where a.patient_id = c.patient_id
                                       and a.unit_id = c.unit_id and a.status = 'admitted' limit 1));
    if v_adm is not null and c.surgery_id is null and l.service <> 'endoscopy' then
      insert into public.surgeries (admission_id, waitlist_id, surgery_date, urgency, procedure_done, surgeon, assistants,
        anaesthesia, findings, complications, start_time, end_time, anaesthetist, position, incision, procedure_steps, implants,
        specimen, drains, blood_loss_ml, closure, postop_diagnosis, postop_instructions)
      values (v_adm, c.booking_id, l.list_date,
              case when l.session = 'emergency' then 'emergency' else 'elective' end,
              coalesce(nullif(trim(n->>'procedure_done'), ''), c.procedure),
              coalesce(nullif(trim(n->>'surgeon'), ''), c.surgeon), coalesce(nullif(trim(n->>'assistants'), ''), c.assistants),
              coalesce(nullif(trim(n->>'anaesthesia'), ''), c.anaesthesia),
              nullif(trim(n->>'findings'), ''), nullif(trim(n->>'complications'), ''),
              nullif(n->>'start_time', '')::time, nullif(n->>'end_time', '')::time,
              coalesce(nullif(trim(n->>'anaesthetist'), ''), l.anaesthetist), coalesce(nullif(trim(n->>'position'), ''), c.position),
              nullif(trim(n->>'incision'), ''), nullif(trim(n->>'procedure_steps'), ''), nullif(trim(n->>'implants'), ''),
              nullif(trim(n->>'specimen'), ''), nullif(trim(n->>'drains'), ''), nullif(n->>'blood_loss_ml', '')::int,
              nullif(trim(n->>'closure'), ''), nullif(trim(n->>'postop_diagnosis'), ''), nullif(trim(n->>'postop_instructions'), ''))
      returning id into v_surgery;
    end if;
    update public.ot_cases set status = 'done', status_reason = null, done_at = now(), admission_id = coalesce(admission_id, v_adm),
           procedure_done = coalesce(nullif(trim(n->>'procedure_done'), ''), procedure),
           findings = nullif(trim(n->>'findings'), ''), postop_diagnosis = nullif(trim(n->>'postop_diagnosis'), ''),
           complications = nullif(trim(n->>'complications'), ''), surgery_id = coalesce(surgery_id, v_surgery),
           surgeon = coalesce(nullif(trim(n->>'surgeon'), ''), surgeon), assistants = coalesce(nullif(trim(n->>'assistants'), ''), assistants)
    where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'completed', status_reason = null where id = c.booking_id;
    end if;
  elsif p_status in ('postponed','cancelled') then
    if nullif(trim(p_reason), '') is null then raise exception 'Give a reason.'; end if;
    update public.ot_cases set status = p_status, status_reason = trim(p_reason) where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'postponed', status_reason = trim(p_reason) where id = c.booking_id;
    end if;
  else
    if c.status = 'done' then raise exception 'A completed case cannot be reopened here.'; end if;
    update public.ot_cases set status = 'planned', status_reason = null where id = c.id;
    if c.booking_id is not null then
      update public.surgery_waitlist set status = 'scheduled', status_reason = null where id = c.booking_id;
    end if;
  end if;
end $$;
