'use client';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel, lastPick, savePick } from '@/lib/personnel';
import { ageSex, fmtDate } from '@/lib/format';
import { DECISION, VISIT_TYPE, LATERALITY, BOOKING_STATUS, serviceLabel, telHref } from '@/lib/workflow';
import { BookingForm } from '@/components/BookingForm';

type P = { id: string; uhid: string; op_number: string | null; full_name: string; age_years: number | null; sex: string;
  phone: string | null; phone_2: string | null; allergy_status: string | null; allergies: string | null; comorbidities: string[] };
type V = { id: string; visit_at: string; visit_type: string; diagnosis: string | null; laterality: string | null; notes: string | null;
  investigations_advised: string | null; decision: string; follow_up_on: string | null; consultant: { full_name: string } | null };
type B = { id: string; list_type: string; planned_procedure: string; status: string; planned_date: string | null };

export default function OpdVisitPage() { return <Suspense><OpdVisit /></Suspense>; }

function OpdVisit() {
  const sp = useSearchParams();
  const id = sp.get('p') ?? '';
  const presetType = sp.get('t');
  const s = useSession();
  const [p, setP] = useState<P | null>(null);
  const [visits, setVisits] = useState<V[]>([]);
  const [bookings, setBookings] = useState<B[]>([]);
  const [admitted, setAdmitted] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; decision: string; diagnosis: string; laterality: string } | null>(null);
  const [booked, setBooked] = useState(false);

  const load = useCallback(async () => {
    const [pp, vv, bb, aa] = await Promise.all([
      supabase.from('patients').select('id, uhid, op_number, full_name, age_years, sex, phone, phone_2, allergy_status, allergies, comorbidities').eq('id', id).single(),
      supabase.from('opd_visits').select('*, consultant:unit_personnel!opd_visits_consultant_person_id_fkey(full_name)').eq('patient_id', id).order('visit_at', { ascending: false }).limit(10),
      supabase.from('surgery_waitlist').select('id, list_type, planned_procedure, status, planned_date').eq('patient_id', id).in('status', ['waiting', 'scheduled', 'postponed']),
      supabase.from('admissions').select('id').eq('patient_id', id).eq('status', 'admitted').maybeSingle(),
    ]);
    setP(pp.data as P); setVisits((vv.data as V[]) ?? []); setBookings((bb.data as B[]) ?? []); setAdmitted(aa.data?.id ?? null);
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  if (!p) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <div className="card">
        <div className="spread"><h2 style={{ margin: 0 }}>{p.full_name}</h2><span className="muted">{ageSex(p.age_years, p.sex)}</span></div>
        <div className="small row" style={{ gap: 12 }}>
          <span>UHID <b>{p.uhid}</b></span>{p.op_number && <span>OP {p.op_number}</span>}
          {p.phone && <a href={telHref(p.phone)}>{p.phone}</a>}{p.phone_2 && <a href={telHref(p.phone_2)}>{p.phone_2}</a>}
        </div>
        {p.allergy_status === 'yes' && <div className="msg err small" style={{ marginTop: 8 }}><b>Allergies:</b> {p.allergies}</div>}
        {p.comorbidities.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{p.comorbidities.join(', ')}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <Link className="btn ghost" href={`/patient/?id=${p.id}`}>Full record</Link>
          {admitted && <span className="badge teal">Currently admitted</span>}
        </div>
      </div>

      {bookings.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>On the waiting list</h3>
          {bookings.map((b) => (
            <Link key={b.id} href={`/booking/?id=${b.id}`} className="spread small" style={{ color: 'inherit' }}>
              <span><b>{serviceLabel(b.list_type)}</b> · {b.planned_procedure}</span>
              <span className="badge teal">{BOOKING_STATUS[b.status]}{b.planned_date ? ` · ${fmtDate(b.planned_date)}` : ''}</span>
            </Link>
          ))}
        </div>
      )}

      {s.can('patient.write') && !saved && <VisitForm patient={p} last={visits[0]} presetType={presetType} onSaved={(v) => { setSaved(v); load(); }} />}

      {saved && (
        <div className="card stack">
          <div className="msg ok">Visit saved · {DECISION[saved.decision]}</div>
          {saved.decision === 'book' && !booked && s.can('ot.prepare') && (
            <BookingForm patientId={p.id} phone={p.phone} opdVisitId={saved.id} admissionId={admitted}
              diagnosis={saved.diagnosis} laterality={saved.laterality} onDone={() => { setBooked(true); load(); }} />
          )}
          {booked && <div className="msg ok">Added to the waiting list. <Link href="/waiting/">Open waiting list →</Link></div>}
          {saved.decision === 'admit' && !admitted && <Link className="btn teal" href={`/patient/?id=${p.id}`}>Admit now →</Link>}
          <div className="row">
            <button className="ghost" onClick={() => { setSaved(null); setBooked(false); }}>Record another visit</button>
            <Link className="btn ghost" href="/opd/">Back to OPD</Link>
          </div>
        </div>
      )}

      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Previous visits</h3>
        {visits.length === 0 && <p className="muted small" style={{ margin: 0 }}>First visit.</p>}
        {visits.map((v) => (
          <div key={v.id} className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '6px 0' }}>
            <div className="spread"><b>{fmtDate(v.visit_at)} · {VISIT_TYPE[v.visit_type]}</b><span className="badge">{DECISION[v.decision]}</span></div>
            <div>{v.diagnosis ?? '—'}{v.laterality && v.laterality !== 'na' ? ` (${LATERALITY[v.laterality]})` : ''}{v.consultant ? ` · ${v.consultant.full_name}` : ''}</div>
            {v.notes && <div className="muted">{v.notes}</div>}
            {v.investigations_advised && <div className="muted">Tests advised: {v.investigations_advised}</div>}
            {v.follow_up_on && <div className="muted">Follow-up {fmtDate(v.follow_up_on)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function VisitForm({ patient, last, presetType, onSaved }: { patient: P; last?: V; presetType?: string | null; onSaved: (v: { id: string; decision: string; diagnosis: string; laterality: string }) => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const consultants = people.filter((x) => ['unit_chief', 'consultant', 'assistant_professor'].includes(x.category));
  const lastC = lastPick('opd_consultant');
  const [f, setF] = useState({
    visit_type: presetType && ['new', 'follow_up', 'post_op', 'referral'].includes(presetType) ? presetType : last ? 'follow_up' : 'new', consultant: '', diagnosis: last?.diagnosis ?? '', laterality: last?.laterality ?? '',
    notes: '', investigations_advised: '', decision: 'follow_up', follow_up_on: '',
  });
  useEffect(() => { if (!f.consultant && consultants.some((c) => c.id === lastC)) setF((x) => ({ ...x, consultant: lastC })); }, [consultants.length]); // eslint-disable-line
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const { data, error } = await supabase.from('opd_visits').insert({
      patient_id: patient.id, unit_id: s.unit!.id, visit_type: f.visit_type, consultant_person_id: f.consultant || null,
      diagnosis: f.diagnosis.trim() || null, laterality: f.laterality || null, notes: f.notes.trim() || null,
      investigations_advised: f.investigations_advised.trim() || null, decision: f.decision,
      follow_up_on: f.decision === 'follow_up' && f.follow_up_on ? f.follow_up_on : null,
    }).select('id').single();
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    savePick('opd_consultant', f.consultant);
    onSaved({ id: data.id, decision: f.decision, diagnosis: f.diagnosis.trim(), laterality: f.laterality });
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Today’s visit</h3>
      <div className="grid g2">
        <div className="field"><label>Visit type</label><select value={f.visit_type} onChange={set('visit_type')}>
          {Object.entries(VISIT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Consultant</label><select value={f.consultant} onChange={set('consultant')}><option value="">—</option>
          {consultants.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Diagnosis</label><input value={f.diagnosis} onChange={set('diagnosis')} /></div>
        <div className="field"><label>Side</label><select value={f.laterality} onChange={set('laterality')}><option value="">—</option>
          {Object.entries(LATERALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="field"><label>Clinical notes</label><textarea value={f.notes} onChange={set('notes')} style={{ minHeight: 70 }} /></div>
      <div className="field"><label>Investigations advised</label><input value={f.investigations_advised} onChange={set('investigations_advised')} placeholder="e.g. CBC, RFT, USG abdomen" /></div>
      <div className="field"><label>Decision</label>
        <div className="row" style={{ gap: 6 }}>
          {['follow_up', 'book', 'admit', 'discharge'].map((d) => (
            <button type="button" key={d} className={f.decision === d ? 'teal' : 'ghost'} onClick={() => setF({ ...f, decision: d })}>{DECISION[d]}</button>
          ))}
        </div>
      </div>
      {f.decision === 'follow_up' && <div className="field"><label>Follow-up date</label><input type="date" value={f.follow_up_on} onChange={set('follow_up_on')} /></div>}
      {f.decision === 'book' && <p className="small muted" style={{ margin: 0 }}>After saving, the booking form opens with the diagnosis filled in.</p>}
      {err && <div className="msg err">{err}</div>}
      <button disabled={busy}>{busy ? 'Saving…' : 'Save visit'}</button>
    </form>
  );
}
