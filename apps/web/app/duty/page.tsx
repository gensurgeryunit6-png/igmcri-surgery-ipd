'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { todayIst } from '@/lib/workflow';

const SHIFTS: Record<string, string> = { day: 'Day duty', night: 'Night duty', emergency: 'Emergency duty', on_call: 'On call' };
type Report = { id: string; duty_date: string; shift: string; submitted_by: string; census: Record<string, number>; admissions: string | null;
  emergency_procedures: string | null; critical_patients: string | null; handover: string; issues: string | null; status: string;
  reviewed_at: string | null; review_note: string | null; created_at: string;
  author: { full_name: string } | null; reviewer: { full_name: string } | null };
const SEL = '*, author:staff!duty_reports_submitted_by_fkey(full_name), reviewer:staff!duty_reports_reviewed_by_fkey(full_name)';

export default function DutyPage() { return <Suspense><Duty /></Suspense>; }

/** Duty report: the handover at the end of a duty, reviewed by faculty. */
function Duty() {
  const id = useSearchParams().get('id');
  const s = useSession();
  const [adding, setAdding] = useState(false);
  const live = useLive(async () => must(supabase.from('duty_reports').select(SEL).eq('unit_id', s.unit!.id).order('duty_date', { ascending: false }).order('created_at', { ascending: false }).limit(60)),
    ['duty_reports'], [s.unit?.id]);
  const rows = (live.data as unknown as Report[]) ?? [];
  if (id) { const r = rows.find((x) => x.id === id); return r ? <ReportView r={r} onChange={live.reload} /> : <p className="muted">{live.data ? 'Report not found.' : 'Loading…'}</p>; }
  const toReview = rows.filter((r) => r.status === 'submitted');
  return (
    <div className="stack">
      {s.can('duty.submit') && !adding && <button className="teal" onClick={() => setAdding(true)}>+ Submit duty report</button>}
      {adding && <NewReport onDone={() => { setAdding(false); live.reload(); }} />}
      {live.error && <div className="msg err">{live.error}</div>}
      {s.can('duty.review') && toReview.length > 0 && <div className="msg info small">{toReview.length} report{toReview.length > 1 ? 's' : ''} waiting for your review.</div>}
      {live.data && rows.length === 0 && <p className="muted">No duty reports yet.</p>}
      <div className="mobile-list">
        {rows.map((r) => (
          <Link key={r.id} href={`/duty/?id=${r.id}`} className="mcard">
            <div className="spread"><b>{fmtDate(r.duty_date)} · {SHIFTS[r.shift]}</b>
              <span className={`badge ${r.status === 'reviewed' ? 'ok' : 'warn'}`}>{r.status === 'reviewed' ? 'Reviewed' : 'To review'}</span></div>
            <div className="small muted">{r.author?.full_name}{r.census?.total != null ? ` · ${r.census.total} inpatients` : ''}</div>
            <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.handover}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NewReport({ onDone }: { onDone: () => void }) {
  const s = useSession();
  const router = useRouter();
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const [f, setF] = useState({ duty_date: todayIst(), shift: hour >= 8 && hour < 20 ? 'day' : 'night', admissions: '', emergency_procedures: '', critical_patients: '', handover: '', issues: '' });
  const [census, setCensus] = useState<Record<string, number>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  // Fill from the live record so the handover starts from facts, not memory.
  useEffect(() => {
    (async () => {
      const unit = s.unit!.id;
      const from = new Date(`${f.duty_date}T00:00:00+05:30`).toISOString();
      const to = new Date(new Date(`${f.duty_date}T00:00:00+05:30`).getTime() + 864e5).toISOString();
      const [c, adm, crit, ot] = await Promise.all([
        supabase.from('v_census_today').select('*').eq('unit_id', unit).maybeSingle(),
        supabase.from('admissions').select('ip_number, admission_type, patients(full_name, age_years, sex), diagnoses(description)').eq('unit_id', unit).gte('admitted_at', from).lt('admitted_at', to),
        supabase.from('v_inpatients').select('full_name, bed, diagnosis, last_status').eq('unit_id', unit).in('last_status', ['critical', 'worsening']),
        supabase.from('ot_cases').select('procedure, procedure_done, status, patients(full_name), manual_name, ot_lists!inner(session, list_date, unit_id)').eq('ot_lists.unit_id', unit).eq('ot_lists.list_date', f.duty_date).eq('ot_lists.session', 'emergency'),
      ]);
      const cc = (c.data ?? {}) as Record<string, number>;
      setCensus({ total: cc.total_admitted ?? 0, new: cc.new_admissions ?? 0, discharged: cc.discharged_today ?? 0, critical: cc.critical ?? 0, postop: cc.postoperative ?? 0 });
      type A = { ip_number: string; admission_type: string; patients: { full_name: string; age_years: number | null; sex: string }; diagnoses: { description: string }[] };
      type K = { full_name: string; bed: string | null; diagnosis: string | null; last_status: string };
      type O = { procedure: string; procedure_done: string | null; status: string; patients: { full_name: string } | null; manual_name: string | null };
      setF((x) => ({
        ...x,
        admissions: x.admissions || ((adm.data ?? []) as unknown as A[]).filter((a) => a.patients).map((a) => `${a.patients.full_name} (${a.patients.age_years ?? '?'}/${a.patients.sex}), IP ${a.ip_number}, ${a.admission_type}${a.diagnoses?.[0] ? ` — ${a.diagnoses[0].description}` : ''}`).join('\n'),
        critical_patients: x.critical_patients || ((crit.data ?? []) as K[]).map((k) => `${k.bed ?? 'No bed'} ${k.full_name} — ${k.diagnosis ?? ''} (${k.last_status})`).join('\n'),
        emergency_procedures: x.emergency_procedures || ((ot.data ?? []) as unknown as O[]).map((o) => `${o.patients?.full_name ?? o.manual_name}: ${o.procedure_done ?? o.procedure} (${o.status})`).join('\n'),
      }));
    })();
  }, [s.unit, f.duty_date]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const { data, error } = await supabase.from('duty_reports').insert({ unit_id: s.unit!.id, duty_date: f.duty_date, shift: f.shift, census,
      admissions: f.admissions.trim() || null, emergency_procedures: f.emergency_procedures.trim() || null, critical_patients: f.critical_patients.trim() || null,
      handover: f.handover.trim(), issues: f.issues.trim() || null }).select('id').single();
    setBusy(false);
    if (error) setErr(friendlyError(error)); else { onDone(); router.push(`/duty/?id=${data.id}`); }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>Duty report</h2>
      <div className="grid g2">
        <div className="field"><label>Date</label><input type="date" value={f.duty_date} max={todayIst()} onChange={set('duty_date')} /></div>
        <div className="field"><label>Duty</label><select value={f.shift} onChange={set('shift')}>{Object.entries(SHIFTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="countgrid">
        {[['total', 'Inpatients'], ['new', 'New'], ['discharged', 'Discharged'], ['critical', 'Critical']].map(([k, l]) => <div key={k} className="count"><b>{census[k] ?? '–'}</b><span>{l}</span></div>)}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Filled from the app; edit as needed.</p>
      <div className="field"><label>Admissions</label><textarea value={f.admissions} onChange={set('admissions')} style={{ minHeight: 60 }} /></div>
      <div className="field"><label>Emergency procedures</label><textarea value={f.emergency_procedures} onChange={set('emergency_procedures')} style={{ minHeight: 50 }} /></div>
      <div className="field"><label>Sick patients to watch</label><textarea value={f.critical_patients} onChange={set('critical_patients')} style={{ minHeight: 50 }} /></div>
      <div className="field"><label className="req">Handover</label><textarea required value={f.handover} onChange={set('handover')} style={{ minHeight: 80 }} placeholder="What the next team must know or do" /></div>
      <div className="field"><label>Problems faced</label><textarea value={f.issues} onChange={set('issues')} style={{ minHeight: 50 }} placeholder="e.g. no ICU bed, drug shortage, equipment" /></div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function ReportView({ r, onChange }: { r: Report; onChange: () => void }) {
  const s = useSession();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const review = async () => {
    const { error } = await supabase.from('duty_reports').update({ status: 'reviewed', review_note: note.trim() || null }).eq('id', r.id);
    if (error) setErr(friendlyError(error)); else onChange();
  };
  const block = (label: string, v: string | null) => v ? <div><div className="small muted" style={{ fontWeight: 600 }}>{label}</div><div style={{ whiteSpace: 'pre-wrap' }}>{v}</div></div> : null;
  return (
    <div className="stack">
      <div className="row no-print"><button onClick={() => window.print()}>Print</button><Link className="btn ghost" href="/duty/">All duty reports</Link></div>
      <div className="card stack report">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>IGMCRI · Department of General Surgery · {s.unit?.name}</div>
          <h2 style={{ margin: '4px 0' }}>{SHIFTS[r.shift]} report · {fmtDate(r.duty_date)}</h2>
          <div className="small muted">By {r.author?.full_name} · submitted {fmtDateTime(r.created_at)}</div>
        </div>
        <div className="small">Inpatients {r.census?.total ?? '—'} · new {r.census?.new ?? '—'} · discharged {r.census?.discharged ?? '—'} · critical {r.census?.critical ?? '—'} · post-op {r.census?.postop ?? '—'}</div>
        {block('Admissions', r.admissions)}
        {block('Emergency procedures', r.emergency_procedures)}
        {block('Sick patients to watch', r.critical_patients)}
        {block('Handover', r.handover)}
        {block('Problems faced', r.issues)}
        {r.status === 'reviewed'
          ? <div className="msg ok small">Reviewed by {r.reviewer?.full_name} · {fmtDateTime(r.reviewed_at)}{r.review_note ? ` · ${r.review_note}` : ''}</div>
          : s.can('duty.review') && r.submitted_by !== s.session?.user.id ? (
            <div className="stack no-print" style={{ gap: 6 }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment (optional)" />
              <button className="teal" onClick={review}>Mark reviewed</button>
            </div>) : <div className="msg info small no-print">Waiting for faculty review.</div>}
        {err && <div className="msg err">{err}</div>}
      </div>
    </div>
  );
}
