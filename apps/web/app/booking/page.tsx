'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel } from '@/lib/personnel';
import { ageSex, fmtDate, fmtDateTime } from '@/lib/format';
import { BOOKING_STATUS, CONTACT, CALL_OUTCOMES, PRIORITY, LATERALITY, PREOP_ITEMS, SERVICES, SESSIONS, serviceLabel, telHref, todayIst,
  type Booking, type OtList } from '@/lib/workflow';

type P = { id: string; uhid: string; full_name: string; age_years: number | null; sex: string; phone: string | null; phone_2: string | null;
  op_number: string | null; allergy_status: string | null; allergies: string | null };
type Call = { id: string; called_at: string; outcome: string; note: string | null };

export default function BookingPage() { return <Suspense><BookingView /></Suspense>; }

function BookingView() {
  const id = useSearchParams().get('id') ?? '';
  const s = useSession();
  const router = useRouter();
  const [b, setB] = useState<Booking | null>(null);
  const [p, setP] = useState<P | null>(null);
  const [adm, setAdm] = useState<{ id: string; ip_number: string } | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const can = s.can('ot.prepare');

  const load = useCallback(async () => {
    const bb = await supabase.from('surgery_waitlist').select('*').eq('id', id).single();
    if (bb.error) { setErr(friendlyError(bb.error)); return; }
    const bk = bb.data as Booking;
    const [pp, aa, cc, oc] = await Promise.all([
      supabase.from('patients').select('id, uhid, full_name, age_years, sex, phone, phone_2, op_number, allergy_status, allergies').eq('id', bk.patient_id).single(),
      supabase.from('admissions').select('id, ip_number').eq('patient_id', bk.patient_id).eq('status', 'admitted').maybeSingle(),
      supabase.from('booking_calls').select('id, called_at, outcome, note').eq('booking_id', id).order('called_at', { ascending: false }),
      supabase.from('ot_cases').select('list_id').eq('booking_id', id).eq('status', 'planned').maybeSingle(),
    ]);
    setB(bk); setP(pp.data as P); setAdm(aa.data); setCalls((cc.data as unknown as Call[]) ?? []); setListId(oc.data?.list_id ?? null);
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  const update = async (patch: Partial<Booking>) => {
    setErr(''); setMsg('');
    const { error } = await supabase.from('surgery_waitlist').update(patch).eq('id', id);
    if (error) setErr(friendlyError(error)); else { setMsg('Saved'); load(); }
  };

  if (err && !b) return <div className="msg err">{err}</div>;
  if (!b || !p) return <p className="muted">Loading…</p>;
  const open = ['waiting', 'postponed', 'scheduled'].includes(b.status);

  return (
    <div className="stack">
      <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>{p.full_name}</h2><span className="muted">{ageSex(p.age_years, p.sex)}</span></div>
        <div className="small row" style={{ gap: 12 }}>
          <span>UHID <b>{p.uhid}</b></span>{p.op_number && <span>OP {p.op_number}</span>}{adm && <span>IP {adm.ip_number}</span>}
        </div>
        {p.allergy_status === 'yes' && <div className="msg err small" style={{ marginTop: 8 }}><b>Allergies:</b> {p.allergies}</div>}
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {p.phone && <a className="btn ghost" href={telHref(p.phone)}>Call {p.phone}</a>}
          {p.phone_2 && <a className="btn ghost" href={telHref(p.phone_2)}>Call {p.phone_2}</a>}
          <Link className="btn ghost" href={`/patient/?id=${p.id}`}>Patient record</Link>
        </div>
      </div>

      <div className="card stack">
        <div className="spread">
          <h3 style={{ margin: 0 }}>{serviceLabel(b.list_type)} · {b.planned_procedure}</h3>
          <span className="badge teal">{BOOKING_STATUS[b.status]}{b.planned_date ? ` · ${fmtDate(b.planned_date)}` : ''}</span>
        </div>
        {b.status_reason && <div className="small muted">Reason: {b.status_reason}</div>}
        <BookingDetails b={b} can={can && open} onSave={update} />
        {msg && <div className="msg ok small">{msg}</div>}
        {err && <div className="msg err">{err}</div>}
      </div>

      <PreopChecklist b={b} can={can && open} onSave={update} />

      {open && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Next step</h3>
          {listId ? <Link className="btn teal" href={`/ot-list/?id=${listId}`}>Open the OT list this case is on →</Link>
            : can && <AddToList b={b} onAdded={(lid) => router.push(`/ot-list/?id=${lid}`)} />}
          {!adm && b.list_type === 'major' && s.can('ipd.write') && <Link className="btn ghost" href={`/patient/?id=${p.id}`}>Admit this patient →</Link>}
          {can && !listId && <CancelBooking onCancel={(reason) => update({ status: 'cancelled', status_reason: reason })} />}
        </div>
      )}

      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Calls · {calls.length}</h3>
        {can && open && <CallForm bookingId={b.id} onDone={load} />}
        {calls.map((c) => (
          <div key={c.id} className="small spread" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
            <span><b>{CONTACT[c.outcome]}</b>{c.note ? ` · ${c.note}` : ''}</span>
            <span className="muted">{fmtDateTime(c.called_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingDetails({ b, can, onSave }: { b: Booking; can: boolean; onSave: (p: Partial<Booking>) => void }) {
  const s = useSession();
  const pgs = usePersonnel(s.unit?.id).filter((p) => ['pg', 'senior_resident'].includes(p.category));
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(b);
  useEffect(() => setF(b), [b]);
  const set = (k: keyof Booking) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });
  if (!edit) return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="grid g2 small">
        <div><label>Diagnosis</label>{b.diagnosis ?? '—'}</div>
        <div><label>Side</label>{b.laterality ? LATERALITY[b.laterality] : '—'}</div>
        <div><label>Priority</label>{PRIORITY[b.priority]}</div>
        <div><label>Responsible PG</label>{pgs.find((x) => x.id === b.responsible_pg_person_id)?.full_name ?? '—'}</div>
        <div><label>Indication</label>{b.indication ?? '—'}</div>
        <div><label>Planned date</label>{fmtDate(b.planned_date)}</div>
      </div>
      {can && <button className="ghost" onClick={() => setEdit(true)}>Edit booking</button>}
    </div>
  );
  return (
    <div className="stack">
      <div className="grid g2">
        <div className="field"><label>List</label><select value={f.list_type} onChange={set('list_type')}>{SERVICES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select></div>
        <div className="field"><label>Priority</label><select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="field"><label>Planned procedure</label><input value={f.planned_procedure} onChange={set('planned_procedure')} /></div>
      <div className="grid g2">
        <div className="field"><label>Diagnosis</label><input value={f.diagnosis ?? ''} onChange={set('diagnosis')} /></div>
        <div className="field"><label>Side</label><select value={f.laterality ?? ''} onChange={set('laterality')}><option value="">—</option>{Object.entries(LATERALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Planned date</label><input type="date" value={f.planned_date ?? ''} onChange={set('planned_date')} /></div>
        <div className="field"><label>Responsible PG</label><select value={f.responsible_pg_person_id ?? ''} onChange={set('responsible_pg_person_id')}><option value="">—</option>{pgs.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
      </div>
      <div className="field"><label>Indication</label><input value={f.indication ?? ''} onChange={set('indication')} /></div>
      <div className="row"><button onClick={() => { onSave({ list_type: f.list_type, priority: f.priority, planned_procedure: f.planned_procedure, diagnosis: f.diagnosis, laterality: f.laterality, planned_date: f.planned_date, responsible_pg_person_id: f.responsible_pg_person_id, indication: f.indication }); setEdit(false); }}>Save</button>
        <button className="ghost" onClick={() => setEdit(false)}>Cancel</button></div>
    </div>
  );
}

const CHOICES: Record<string, [string, string][]> = {
  pac_status: [['pending', 'Pending'], ['fit', 'Fit'], ['fit_high_risk', 'Fit, high risk'], ['unfit', 'Unfit']],
  physician_status: [['not_needed', 'Not needed'], ['pending', 'Pending'], ['fit', 'Fit']],
  consent_status: [['pending', 'Pending'], ['taken', 'Taken']],
  blood_status: [['not_needed', 'Not needed'], ['pending', 'Pending'], ['arranged', 'Arranged']],
};

function PreopChecklist({ b, can, onSave }: { b: Booking; can: boolean; onSave: (p: Partial<Booking>) => void }) {
  const [text, setText] = useState({ imaging: b.imaging ?? '', serology: b.serology ?? '', anaesthesia_plan: b.anaesthesia_plan ?? '',
    position: b.position ?? '', preparation: b.preparation ?? '', special_instructions: b.special_instructions ?? '' });
  useEffect(() => setText({ imaging: b.imaging ?? '', serology: b.serology ?? '', anaesthesia_plan: b.anaesthesia_plan ?? '',
    position: b.position ?? '', preparation: b.preparation ?? '', special_instructions: b.special_instructions ?? '' }), [b]);
  const done = PREOP_ITEMS.filter((i) => i.ok(b)).length;
  const dirty = Object.entries(text).some(([k, v]) => v !== ((b as unknown as Record<string, string | null>)[k] ?? ''));
  return (
    <div className="card stack">
      <div className="spread"><h3 style={{ margin: 0 }}>Pre-op checklist</h3>
        <span className={`badge ${b.preop_ready ? 'ok' : 'warn'}`}>{b.preop_ready ? 'Ready for OT' : `${done} of ${PREOP_ITEMS.length} done`}</span></div>
      <div className="stack" style={{ gap: 8 }}>
        <div className="spread small">
          <span style={{ color: b.investigations_ok ? 'var(--ok)' : 'var(--bad)' }}>{b.investigations_ok ? '✓' : '✗'} Investigations complete</span>
          {can && <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => onSave({ investigations_ok: !b.investigations_ok })}>{b.investigations_ok ? 'Mark incomplete' : 'Mark complete'}</button>}
        </div>
        {(['pac_status', 'physician_status', 'consent_status', 'blood_status'] as const).map((k) => {
          const item = PREOP_ITEMS.find((i) => i.k === k)!;
          return (
            <div key={k} className="small">
              <div style={{ color: item.ok(b) ? 'var(--ok)' : 'var(--bad)', marginBottom: 4 }}>{item.ok(b) ? '✓' : '✗'} {item.label}</div>
              <div className="row" style={{ gap: 4 }}>
                {CHOICES[k].map(([v, label]) => (
                  <button key={v} type="button" disabled={!can} className={b[k] === v ? 'teal' : 'ghost'} style={{ padding: '4px 10px', fontWeight: 500 }}
                    onClick={() => b[k] !== v && onSave({ [k]: v } as Partial<Booking>)}>{label}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid g2">
        <div className="field"><label>Serology</label><input disabled={!can} value={text.serology} onChange={(e) => setText({ ...text, serology: e.target.value })} placeholder="HIV, HBsAg, HCV" /></div>
        <div className="field"><label>Anaesthesia</label><input disabled={!can} value={text.anaesthesia_plan} onChange={(e) => setText({ ...text, anaesthesia_plan: e.target.value })} placeholder="GA / SA / LA" /></div>
        <div className="field"><label>Imaging</label><input disabled={!can} value={text.imaging} onChange={(e) => setText({ ...text, imaging: e.target.value })} /></div>
        <div className="field"><label>Position</label><input disabled={!can} value={text.position} onChange={(e) => setText({ ...text, position: e.target.value })} placeholder="Supine / Lithotomy" /></div>
      </div>
      <div className="field"><label>Pre-op preparation</label><input disabled={!can} value={text.preparation} onChange={(e) => setText({ ...text, preparation: e.target.value })} placeholder="NPO, bowel prep, part preparation" /></div>
      <div className="field"><label>Special instructions</label><input disabled={!can} value={text.special_instructions} onChange={(e) => setText({ ...text, special_instructions: e.target.value })} /></div>
      {can && dirty && <button onClick={() => onSave(Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.trim() || null])) as Partial<Booking>)}>Save checklist notes</button>}
    </div>
  );
}

function AddToList({ b, onAdded }: { b: Booking; onAdded: (listId: string) => void }) {
  const s = useSession();
  const [lists, setLists] = useState<OtList[]>([]);
  const [pick, setPick] = useState('');
  const [nl, setNl] = useState({ date: b.planned_date ?? todayIst(), room: '', session: 'morning' });
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('ot_lists').select('*').eq('unit_id', s.unit!.id).eq('service', b.list_type).eq('status', 'draft').gte('list_date', todayIst()).order('list_date')
      .then(({ data }) => { setLists((data as OtList[]) ?? []); setPick((data as OtList[])?.[0]?.id ?? 'new'); });
  }, [s.unit, b.list_type]);
  const add = async () => {
    setErr('');
    let lid = pick;
    if (pick === 'new') {
      const r = await supabase.from('ot_lists').insert({ unit_id: s.unit!.id, service: b.list_type, list_date: nl.date, ot_room: nl.room.trim(), session: nl.session }).select('id').single();
      if (r.error) { setErr(friendlyError(r.error)); return; }
      lid = r.data.id;
    }
    const { error } = await supabase.rpc('add_booking_to_list', { p_list: lid, p_booking: b.id });
    if (error) setErr(friendlyError(error)); else onAdded(lid);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="field"><label>Add to {serviceLabel(b.list_type)} list</label>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {lists.map((l) => <option key={l.id} value={l.id}>{fmtDate(l.list_date)} · {SESSIONS[l.session]}{l.ot_room ? ` · ${l.ot_room}` : ''}</option>)}
          <option value="new">New list…</option>
        </select></div>
      {pick === 'new' && (
        <div className="grid g3">
          <div className="field"><label>Date</label><input type="date" value={nl.date} onChange={(e) => setNl({ ...nl, date: e.target.value })} /></div>
          <div className="field"><label>OT room</label><input value={nl.room} onChange={(e) => setNl({ ...nl, room: e.target.value })} placeholder="OT 3" /></div>
          <div className="field"><label>Session</label><select value={nl.session} onChange={(e) => setNl({ ...nl, session: e.target.value })}>{Object.entries(SESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
      )}
      {!b.preop_ready && b.list_type === 'major' && <div className="msg info small">Pre-op checklist is not complete. You can still add the case; it shows as not ready on the list.</div>}
      {err && <div className="msg err">{err}</div>}
      <button className="teal" onClick={add}>Add to OT list</button>
    </div>
  );
}

function CallForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const log = async (outcome: string) => {
    setErr('');
    const { error } = await supabase.from('booking_calls').insert({ booking_id: bookingId, outcome, note: note.trim() || null });
    if (error) setErr(friendlyError(error)); else { setNote(''); onDone(); }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. will come on Monday" />
      <div className="row" style={{ gap: 6 }}>
        {CALL_OUTCOMES.map((o) => <button key={o} className="ghost" style={{ padding: '6px 10px' }} onClick={() => log(o)}>{CONTACT[o]}</button>)}
      </div>
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function CancelBooking({ onCancel }: { onCancel: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <button className="danger" onClick={() => setOpen(true)}>Cancel booking</button>;
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <button className="danger" disabled={!reason.trim()} onClick={() => onCancel(reason.trim())}>Confirm</button>
      <button className="ghost" onClick={() => setOpen(false)}>Back</button>
    </div>
  );
}
