'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AllergyField } from '@/components/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { ageSex } from '@/lib/format';

type Hit = { id: string; uhid: string; full_name: string; age_years: number | null; sex: string; phone: string | null;
  active_admission_id: string | null; ip_number: string | null; ward: string | null; bed: string | null };
type Dup = { id: string; uhid: string; full_name: string; age_years: number | null; sex: string; phone: string | null; reason: string };

export default function PatientsPage() {
  return <Suspense><Patients /></Suspense>;
}

function Patients() {
  const s = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(params.get('new') === '1');

  useEffect(() => { setQ(params.get('q') ?? ''); setShowNew(params.get('new') === '1'); }, [params]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_patients', { p_query: term });
      if (error) setErr(friendlyError(error)); else { setErr(''); setHits(data as Hit[]); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="stack">
      {s.can('patient.write') && !showNew && <button className="teal" onClick={() => setShowNew(true)}>+ Register new patient</button>}

      {showNew ? (
        <NewPatient onCancel={() => { setShowNew(false); router.replace('/patients/'); }}
          onCreated={(id) => router.push(params.get('next') === 'opd' ? `/opd-visit/?p=${id}` : `/patient/?id=${id}`)} />
      ) : (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, UHID, IP number or phone (at least 2 characters)" />
          {err && <div className="msg err">{err}</div>}
          {hits && hits.length === 0 && <p className="muted">No patient matches “{q}”.{s.can('patient.write') && <> <a href="#" onClick={(e) => { e.preventDefault(); setShowNew(true); }}>Register a new patient</a>.</>}</p>}
          {hits && hits.length > 0 && (
            <div className="mobile-list">
              {hits.map((h) => (
                <Link key={h.id} href={`/patient/?id=${h.id}`} className="mcard">
                  <div className="spread"><b>{h.full_name}</b><span className="muted small">{ageSex(h.age_years, h.sex)}</span></div>
                  <div className="muted small">UHID {h.uhid}{h.phone ? ` · ${h.phone}` : ''}</div>
                  <div style={{ marginTop: 4 }}>{h.active_admission_id ? <span className="badge teal">Admitted · IP {h.ip_number} · {h.bed ?? 'no bed'}</span> : <span className="muted small">Not admitted</span>}</div>
                </Link>
              ))}
            </div>
          )}
          {!hits && <p className="muted small">Start typing to search. Every patient has one record, linked to all their admissions.</p>}
        </>
      )}
    </div>
  );
}

const COMORBIDITIES = ['Diabetes mellitus', 'Hypertension', 'Coronary artery disease', 'COPD / Asthma', 'Chronic kidney disease',
  'Hypothyroidism', 'Tuberculosis (past)', 'Seizure disorder'];

function NewPatient({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const s = useSession();
  const [f, setF] = useState({ uhid: '', op_number: '', full_name: '', age_years: '', sex: '', phone: '', phone_2: '',
    emergency_contact_name: '', emergency_contact_phone: '', allergy_status: '', allergies: '' });
  const [como, setComo] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [dups, setDups] = useState<Dup[]>([]);
  const [ackDup, setAckDup] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (f.full_name.trim().length < 3 && f.uhid.trim().length < 2) { setDups([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_possible_duplicates', {
        p_name: f.full_name.trim(), p_phone: f.phone.trim() || null,
        p_age: f.age_years ? Number(f.age_years) : null, p_uhid: f.uhid.trim() || null,
      });
      setDups((data as Dup[]) ?? []); setAckDup(false);
    }, 350);
    return () => clearTimeout(t);
  }, [f.full_name, f.phone, f.age_years, f.uhid]);

  const sameUhid = dups.some((d) => d.reason === 'Same UHID');

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!f.allergy_status) { setErr('Choose Yes or No for allergies.'); return; }
    if (f.allergy_status === 'yes' && !f.allergies.trim()) { setErr('Write what the patient is allergic to.'); return; }
    if (dups.length && !ackDup) { setErr('Possible duplicate found. Open the existing record, or confirm this is a different patient.'); return; }
    setBusy(true);
    const comorbidities = [...como, ...other.split(',').map((x) => x.trim()).filter(Boolean)];
    const { data, error } = await supabase.from('patients').insert({
      institution_id: s.institutionId, uhid: f.uhid.trim(), full_name: f.full_name.trim(),
      age_years: f.age_years ? Number(f.age_years) : null, age_recorded_on: f.age_years ? new Date().toISOString().slice(0, 10) : null,
      sex: f.sex, phone: f.phone.trim() || null, phone_2: f.phone_2.trim() || null, op_number: f.op_number.trim() || null,
      emergency_contact_name: f.emergency_contact_name.trim() || null, emergency_contact_phone: f.emergency_contact_phone.trim() || null,
      allergy_status: f.allergy_status, allergies: f.allergy_status === 'yes' ? f.allergies.trim() : null, comorbidities,
    }).select('id').single();
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onCreated(data.id);
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Register new patient</h2>
      <div className="grid g2">
        <div className="field"><label className="req">UHID</label><input required value={f.uhid} onChange={set('uhid')} autoFocus /></div>
        <div className="field"><label>OP number</label><input value={f.op_number} onChange={set('op_number')} /></div>
      </div>
      <div className="field"><label className="req">Patient name</label><input required minLength={2} value={f.full_name} onChange={set('full_name')} /></div>
      {dups.length > 0 && (
        <div className={`msg ${sameUhid ? 'err' : 'info'}`}>
          <b>{sameUhid ? 'This UHID is already registered.' : 'Possible existing record:'}</b>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
            {dups.map((d) => <li key={d.id}><Link href={`/patient/?id=${d.id}`}>{d.full_name}</Link> · UHID {d.uhid} · {ageSex(d.age_years, d.sex)} {d.phone ? `· ${d.phone}` : ''} <span className="muted">({d.reason})</span></li>)}
          </ul>
          {!sameUhid && <label style={{ color: 'inherit', margin: 0 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />This is a different patient</label>}
        </div>
      )}
      <div className="grid g2">
        <div className="field"><label className="req">Age (years)</label><input required type="number" min={0} max={130} value={f.age_years} onChange={set('age_years')} inputMode="numeric" /></div>
        <div className="field"><label className="req">Sex</label>
          <select required value={f.sex} onChange={set('sex')}><option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Mobile 1</label><input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="Needed to book a procedure" /></div>
        <div className="field"><label>Mobile 2</label><input value={f.phone_2} onChange={set('phone_2')} inputMode="tel" /></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Emergency contact name</label><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
        <div className="field"><label>Emergency contact phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} inputMode="tel" /></div>
      </div>
      <AllergyField status={f.allergy_status} text={f.allergies} onStatus={(v) => setF({ ...f, allergy_status: v })} onText={(v) => setF({ ...f, allergies: v })} />
      <div className="field"><label>Comorbidities</label>
        <div className="row" style={{ gap: 6 }}>
          {COMORBIDITIES.map((c) => (
            <button type="button" key={c} className={como.includes(c) ? 'teal' : 'ghost'} style={{ fontWeight: 500, padding: '6px 10px' }}
              onClick={() => setComo(como.includes(c) ? como.filter((x) => x !== c) : [...como, c])}>{c}</button>
          ))}
        </div>
        <input style={{ marginTop: 8 }} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other comorbidities, separated by commas" />
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button disabled={busy || sameUhid}>{busy ? 'Saving…' : 'Register patient'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
