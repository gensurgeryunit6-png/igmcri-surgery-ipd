'use client';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
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
      <div className="spread">
        <h1>Patient registry</h1>
        {s.can('patient.write') && !showNew && <button className="teal" onClick={() => setShowNew(true)}>Register new patient</button>}
      </div>

      {showNew ? (
        <NewPatient onCancel={() => { setShowNew(false); router.replace('/patients/'); }}
          onCreated={(id) => router.push(`/patient/?id=${id}`)} />
      ) : (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, UHID, IP number or phone (at least 2 characters)" />
          {err && <div className="msg err">{err}</div>}
          {hits && hits.length === 0 && <p className="muted">No patient matches “{q}”.{s.can('patient.write') && <> <a href="#" onClick={(e) => { e.preventDefault(); setShowNew(true); }}>Register a new patient</a>.</>}</p>}
          {hits && hits.length > 0 && (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Name</th><th>UHID</th><th className="hide-mobile">Age / Sex</th><th className="hide-mobile">Phone</th><th>Current admission</th></tr></thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.id}>
                      <td><Link href={`/patient/?id=${h.id}`}><b>{h.full_name}</b></Link></td>
                      <td>{h.uhid}</td>
                      <td className="hide-mobile">{ageSex(h.age_years, h.sex)}</td>
                      <td className="hide-mobile">{h.phone ?? '—'}</td>
                      <td>{h.active_admission_id ? <span className="badge teal">IP {h.ip_number} · {h.bed ?? 'no bed'}</span> : <span className="muted small">Not admitted</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
  const [f, setF] = useState({ uhid: '', full_name: '', age_years: '', date_of_birth: '', sex: '', phone: '', address: '',
    emergency_contact_name: '', emergency_contact_phone: '', allergies: '', blood_group: '' });
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
    if (!f.age_years && !f.date_of_birth) { setErr('Enter either age or date of birth.'); return; }
    if (dups.length && !ackDup) { setErr('Possible duplicate found. Open the existing record, or confirm this is a different patient.'); return; }
    setBusy(true);
    const comorbidities = [...como, ...other.split(',').map((x) => x.trim()).filter(Boolean)];
    const { data, error } = await supabase.from('patients').insert({
      institution_id: s.institutionId, uhid: f.uhid.trim(), full_name: f.full_name.trim(),
      age_years: f.age_years ? Number(f.age_years) : null, age_recorded_on: f.age_years ? new Date().toISOString().slice(0, 10) : null,
      date_of_birth: f.date_of_birth || null, sex: f.sex, phone: f.phone.trim() || null, address: f.address.trim() || null,
      emergency_contact_name: f.emergency_contact_name.trim() || null, emergency_contact_phone: f.emergency_contact_phone.trim() || null,
      allergies: f.allergies.trim() || null, blood_group: f.blood_group || null, comorbidities,
    }).select('id').single();
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onCreated(data.id);
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Register new patient</h2>
      <div className="grid g3">
        <div className="field"><label className="req">UHID</label><input required value={f.uhid} onChange={set('uhid')} autoFocus /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label className="req">Patient name</label><input required minLength={2} value={f.full_name} onChange={set('full_name')} /></div>
      </div>
      {dups.length > 0 && (
        <div className={`msg ${sameUhid ? 'err' : 'info'}`}>
          <b>{sameUhid ? 'This UHID is already registered.' : 'Possible existing record:'}</b>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
            {dups.map((d) => <li key={d.id}><Link href={`/patient/?id=${d.id}`}>{d.full_name}</Link> · UHID {d.uhid} · {ageSex(d.age_years, d.sex)} {d.phone ? `· ${d.phone}` : ''} <span className="muted">({d.reason})</span></li>)}
          </ul>
          {!sameUhid && <label style={{ color: 'inherit', margin: 0 }}><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />This is a different patient</label>}
        </div>
      )}
      <div className="grid g4">
        <div className="field"><label>Age (years)</label><input type="number" min={0} max={130} value={f.age_years} onChange={set('age_years')} inputMode="numeric" /></div>
        <div className="field"><label>or Date of birth</label><input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} /></div>
        <div className="field"><label className="req">Sex</label>
          <select required value={f.sex} onChange={set('sex')}><option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
        <div className="field"><label>Blood group</label>
          <select value={f.blood_group} onChange={set('blood_group')}><option value="">—</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((b) => <option key={b}>{b}</option>)}</select></div>
      </div>
      <div className="grid g3">
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="tel" /></div>
        <div className="field"><label>Emergency contact name</label><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
        <div className="field"><label>Emergency contact phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} inputMode="tel" /></div>
      </div>
      <div className="field"><label>Address</label><textarea value={f.address} onChange={set('address')} style={{ minHeight: 50 }} /></div>
      <div className="field"><label>Allergies</label><input value={f.allergies} onChange={set('allergies')} placeholder="e.g. Penicillin — rash. Leave blank if none known." /></div>
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
