'use client';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { fmtDate, fmtDateTime, ageSex, nowLocalInput, istInputToIso, STATUS_LABEL } from '@/lib/format';
import { useColleagues, isFaculty, isPG } from '@/lib/staff';
import { BedPicker } from '@/components/BedPicker';
import { StatusBadge } from '@/components/ui';

type Patient = { id: string; uhid: string; full_name: string; age_years: number | null; date_of_birth: string | null; sex: string;
  phone: string | null; address: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null;
  allergies: string | null; comorbidities: string[]; blood_group: string | null; created_at: string };
type Admission = { id: string; ip_number: string; admitted_at: string; admission_type: string; status: string; discharged_at: string | null;
  planned_discharge_on: string | null; discharge_note: string | null; consultant_id: string | null; assigned_pg_id: string | null;
  consultant: { full_name: string } | null; pg: { full_name: string } | null };

export default function PatientPage() { return <Suspense><PatientView /></Suspense>; }

function PatientView() {
  const id = useSearchParams().get('id') ?? '';
  const s = useSession();
  const [p, setP] = useState<Patient | null>(null);
  const [adms, setAdms] = useState<Admission[]>([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('admission');

  const load = useCallback(async () => {
    const [pp, aa] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).maybeSingle(),
      supabase.from('admissions').select('*, consultant:staff!admissions_consultant_id_fkey(full_name), pg:staff!admissions_assigned_pg_id_fkey(full_name)')
        .eq('patient_id', id).order('admitted_at', { ascending: false }),
    ]);
    if (pp.error) setErr(friendlyError(pp.error));
    setP(pp.data as Patient); setAdms((aa.data as Admission[]) ?? []);
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  if (err) return <div className="msg err">{err}</div>;
  if (!p) return <p className="muted">Loading…</p>;
  const active = adms.find((a) => a.status === 'admitted');

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div>
            <h2 style={{ fontSize: 20, margin: 0 }}>{p.full_name}</h2>
            <div className="row small" style={{ gap: 14 }}>
              <span>UHID <b>{p.uhid}</b></span><span>{ageSex(p.age_years, p.sex)}</span>
              {p.blood_group && <span>Blood group {p.blood_group}</span>}{p.phone && <span>{p.phone}</span>}
            </div>
          </div>
          {s.can('patient.write') && !editing && <button className="ghost" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
        {p.allergies && <div className="msg err" style={{ marginTop: 10 }}><b>Allergies:</b> {p.allergies}</div>}
        {editing ? <EditPatient p={p} onDone={() => { setEditing(false); load(); }} /> : (
          <div className="grid g3 small" style={{ marginTop: 10 }}>
            <div><label>Comorbidities</label>{p.comorbidities.length ? p.comorbidities.join(', ') : 'None recorded'}</div>
            <div><label>Address</label>{p.address ?? '—'}</div>
            <div><label>Emergency contact</label>{p.emergency_contact_name ?? '—'} {p.emergency_contact_phone ?? ''}</div>
          </div>
        )}
      </div>

      <div className="tabs">
        {TABS.filter((t) => active || ['admission', 'history'].includes(t.key)).map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'admission' && (active ? <ActiveAdmission a={active} onChange={load} />
        : s.can('ipd.write') ? <AdmitForm patientId={p.id} onDone={load} />
        : <div className="card muted">Not currently admitted.</div>)}
      {active && tab === 'diagnosis' && <Diagnoses admissionId={active.id} />}
      {active && tab === 'surgery' && <Surgeries admissionId={active.id} patientId={p.id} />}
      {active && tab === 'tests' && <Investigations admissionId={active.id} />}
      {active && tab === 'medicines' && <Medications admissionId={active.id} />}
      {active && tab === 'rounds' && <Rounds admissionId={active.id} />}
      {tab === 'history' && (
        <div className="card">
          <h3>Admission history</h3>
          {adms.length === 0 ? <p className="muted small">No admissions yet.</p> : adms.map((a) => (
            <div key={a.id} className="spread small" style={{ borderBottom: '1px solid #edf0f4', padding: '8px 0' }}>
              <span><b>IP {a.ip_number}</b> · {fmtDate(a.admitted_at)} → {a.discharged_at ? fmtDate(a.discharged_at) : 'now'}
                <span className="muted"> · {a.admission_type}{a.consultant ? ` · ${a.consultant.full_name}` : ''}</span></span>
              <span className={`badge ${a.status === 'admitted' ? 'teal' : ''}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: 'admission', label: 'Admission' }, { key: 'diagnosis', label: 'Diagnosis' }, { key: 'surgery', label: 'Surgery' },
  { key: 'tests', label: 'Investigations' }, { key: 'medicines', label: 'Medicines' }, { key: 'rounds', label: 'Ward rounds' },
  { key: 'history', label: 'History' },
];

// ---------------------------------------------------------------- edit patient
function EditPatient({ p, onDone }: { p: Patient; onDone: () => void }) {
  const [f, setF] = useState({ full_name: p.full_name, age_years: p.age_years?.toString() ?? '', sex: p.sex, phone: p.phone ?? '',
    address: p.address ?? '', allergies: p.allergies ?? '', emergency_contact_name: p.emergency_contact_name ?? '',
    emergency_contact_phone: p.emergency_contact_phone ?? '', comorbidities: p.comorbidities.join(', '), blood_group: p.blood_group ?? '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('patients').update({
      full_name: f.full_name.trim(), age_years: f.age_years ? Number(f.age_years) : null, sex: f.sex, phone: f.phone || null,
      address: f.address || null, allergies: f.allergies || null, emergency_contact_name: f.emergency_contact_name || null,
      emergency_contact_phone: f.emergency_contact_phone || null, blood_group: f.blood_group || null,
      comorbidities: f.comorbidities.split(',').map((x) => x.trim()).filter(Boolean),
    }).eq('id', p.id);
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="stack" style={{ marginTop: 12 }} onSubmit={save}>
      <p className="muted small" style={{ margin: 0 }}>UHID cannot be changed here. Every edit is kept in the audit log.</p>
      <div className="grid g4">
        <div className="field" style={{ gridColumn: 'span 2' }}><label>Name</label><input required value={f.full_name} onChange={set('full_name')} /></div>
        <div className="field"><label>Age</label><input type="number" value={f.age_years} onChange={set('age_years')} /></div>
        <div className="field"><label>Sex</label><select value={f.sex} onChange={set('sex')}><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></div>
      </div>
      <div className="grid g3">
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Emergency contact</label><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
        <div className="field"><label>Emergency phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></div>
      </div>
      <div className="field"><label>Address</label><input value={f.address} onChange={set('address')} /></div>
      <div className="field"><label>Allergies</label><input value={f.allergies} onChange={set('allergies')} /></div>
      <div className="field"><label>Comorbidities (comma separated)</label><input value={f.comorbidities} onChange={set('comorbidities')} /></div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Save</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- admit
function AdmitForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const s = useSession();
  const staff = useColleagues(s.unit?.id);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ip: '', at: nowLocalInput(), type: 'elective', diagnosis: '', consultant: '', pg: '' });
  const [bed, setBed] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  if (!open) return <div className="card spread"><span className="muted">Not currently admitted.</span><button className="teal" onClick={() => setOpen(true)}>Admit to {s.unit?.name}</button></div>;

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const chief = staff.find((c) => c.roles.includes('unit_chief'));
    const { error } = await supabase.rpc('admit_patient', {
      p_patient_id: patientId, p_unit_id: s.unit!.id, p_ip_number: f.ip.trim(), p_bed_id: bed || null,
      p_admitted_at: istInputToIso(f.at), p_admission_type: f.type, p_diagnosis: f.diagnosis || null,
      p_consultant_id: f.consultant || null, p_unit_chief_id: chief?.user_id ?? null, p_assigned_pg_id: f.pg || null,
    });
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h2>New admission · {s.unit?.name}</h2>
      <div className="grid g3">
        <div className="field"><label className="req">IP number</label><input required value={f.ip} onChange={set('ip')} autoFocus /></div>
        <div className="field"><label className="req">Admitted at</label><input type="datetime-local" required value={f.at} onChange={set('at')} /></div>
        <div className="field"><label>Type</label><select value={f.type} onChange={set('type')}><option value="elective">Elective</option><option value="emergency">Emergency</option></select></div>
      </div>
      <BedPicker unitId={s.unit!.id} value={bed} onChange={setBed} />
      <div className="field"><label>Provisional diagnosis</label><input value={f.diagnosis} onChange={set('diagnosis')} /></div>
      <div className="grid g2">
        <div className="field"><label>Consultant</label><select value={f.consultant} onChange={set('consultant')}><option value="">—</option>
          {staff.filter(isFaculty).map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}</select></div>
        <div className="field"><label>Assigned PG</label><select value={f.pg} onChange={set('pg')}><option value="">—</option>
          {staff.filter(isPG).map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}</select></div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button disabled={busy}>{busy ? 'Admitting…' : 'Admit patient'}</button><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- active admission
function ActiveAdmission({ a, onChange }: { a: Admission; onChange: () => void }) {
  const s = useSession();
  const [bed, setBed] = useState<{ label: string; ward: string } | null>(null);
  const [mode, setMode] = useState<'' | 'move' | 'discharge'>('');
  const [newBed, setNewBed] = useState('');
  const [dStatus, setDStatus] = useState('discharged');
  const [dNote, setDNote] = useState('');
  const [planned, setPlanned] = useState(a.planned_discharge_on ?? '');
  const [err, setErr] = useState('');

  const loadBed = useCallback(async () => {
    const { data } = await supabase.from('bed_assignments').select('ward_beds(label, wards(name))').eq('admission_id', a.id).is('to_at', null).maybeSingle();
    const b = (data as any)?.ward_beds;
    setBed(b ? { label: b.label, ward: b.wards?.name } : null);
  }, [a.id]);
  useEffect(() => { loadBed(); }, [loadBed]);

  const run = async (fn: () => PromiseLike<{ error: any }>) => {
    setErr('');
    const { error } = await fn();
    if (error) { setErr(friendlyError(error)); return false; }
    setMode(''); onChange(); loadBed(); return true;
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread">
          <div>
            <h2 style={{ margin: 0 }}>Current admission · IP {a.ip_number}</h2>
            <div className="small muted">Admitted {fmtDateTime(a.admitted_at)} · {a.admission_type}</div>
          </div>
          <span className="badge navy" style={{ fontSize: 14 }}>{bed ? `${bed.ward} · ${bed.label}` : 'No bed allocated'}</span>
        </div>
        <div className="grid g3 small">
          <div><label>Consultant</label>{a.consultant?.full_name ?? '—'}</div>
          <div><label>Assigned PG</label>{a.pg?.full_name ?? '—'}</div>
          <div><label>Planned discharge</label>
            {s.can('ipd.write') ? (
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} style={{ padding: '5px 8px' }} />
                {planned !== (a.planned_discharge_on ?? '') && <button className="ghost" style={{ padding: '5px 10px' }}
                  onClick={() => run(() => supabase.from('admissions').update({ planned_discharge_on: planned || null }).eq('id', a.id))}>Save</button>}
              </div>) : fmtDate(a.planned_discharge_on)}
          </div>
        </div>
        {s.can('ipd.write') && (
          <div className="row">
            <button className="ghost" onClick={() => setMode(mode === 'move' ? '' : 'move')}>{bed ? 'Move bed / ward' : 'Allocate bed'}</button>
            {s.can('ipd.discharge') && <button className="ghost" onClick={() => setMode(mode === 'discharge' ? '' : 'discharge')}>Discharge</button>}
          </div>
        )}
        {mode === 'move' && (
          <div className="card stack" style={{ background: '#fafbfc' }}>
            <BedPicker unitId={s.unit!.id} value={newBed} onChange={setNewBed} required />
            <div className="row"><button disabled={!newBed} onClick={() => run(() => supabase.rpc('move_patient_bed', { p_admission_id: a.id, p_bed_id: newBed, p_reason: bed ? 'Transfer' : 'Allocation' }))}>Confirm move</button>
              <button className="ghost" onClick={() => setMode('')}>Cancel</button></div>
          </div>
        )}
        {mode === 'discharge' && (
          <div className="card stack" style={{ background: '#fafbfc' }}>
            <div className="grid g2">
              <div className="field"><label>Outcome</label><select value={dStatus} onChange={(e) => setDStatus(e.target.value)}>
                <option value="discharged">Discharged</option><option value="transferred_out">Transferred to another unit / hospital</option>
                <option value="dama">Discharged against medical advice</option><option value="absconded">Absconded</option><option value="expired">Expired</option></select></div>
              <div className="field"><label>Note</label><input value={dNote} onChange={(e) => setDNote(e.target.value)} /></div>
            </div>
            <div className="msg info small">This closes the admission and frees the bed. It cannot be undone from the app.</div>
            <div className="row"><button onClick={() => run(() => supabase.rpc('discharge_patient', { p_admission_id: a.id, p_status: dStatus, p_note: dNote || null }))}>Confirm {dStatus === 'discharged' ? 'discharge' : dStatus.replace('_', ' ')}</button>
              <button className="ghost" onClick={() => setMode('')}>Cancel</button></div>
          </div>
        )}
        {err && <div className="msg err">{err}</div>}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------- sub-panels
function usePanel<T>(table: string, admissionId: string, select = '*', order = 'created_at') {
  const [rows, setRows] = useState<T[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from(table).select(select).eq('admission_id', admissionId).order(order, { ascending: false });
    setRows((data as T[]) ?? []);
  }, [table, admissionId, select, order]);
  useEffect(() => { load(); }, [load]);
  return { rows, load };
}

function Diagnoses({ admissionId }: { admissionId: string }) {
  const s = useSession();
  const { rows, load } = usePanel<{ id: string; kind: string; description: string; created_at: string }>('diagnoses', admissionId);
  const [text, setText] = useState(''); const [kind, setKind] = useState('final'); const [err, setErr] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('diagnoses').insert({ admission_id: admissionId, kind, description: text.trim() });
    if (error) setErr(friendlyError(error)); else { setText(''); setErr(''); load(); }
  };
  return (
    <div className="card stack">
      <h3>Diagnosis</h3>
      {rows.length === 0 ? <p className="muted small">None recorded.</p> : rows.map((d) => (
        <div key={d.id} className="small"><span className={`badge ${d.kind === 'final' ? 'navy' : ''}`}>{d.kind}</span> {d.description} <span className="muted">· {fmtDate(d.created_at)}</span></div>
      ))}
      {s.can('ipd.write') && (
        <form className="row" onSubmit={add} style={{ flexWrap: 'nowrap' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130 }}><option value="final">Final</option><option value="provisional">Provisional</option><option value="secondary">Secondary</option></select>
          <input required value={text} onChange={(e) => setText(e.target.value)} placeholder="Add diagnosis" />
          <button className="ghost">Add</button>
        </form>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function Surgeries({ admissionId, patientId }: { admissionId: string; patientId: string }) {
  const s = useSession();
  type Row = { id: string; surgery_date: string; procedure_done: string; urgency: string; surgeon: string | null; verified_at: string | null };
  const { rows, load } = usePanel<Row>('surgeries', admissionId, '*', 'surgery_date');
  const wl = usePanel<{ id: string; planned_procedure: string; list_type: string; status: string; planned_date: string | null }>('surgery_waitlist', admissionId);
  const [mode, setMode] = useState<'' | 'record' | 'list'>('');
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), proc: '', urgency: 'elective', surgeon: '', type: 'major', planned: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const done = (error: any) => { if (error) setErr(friendlyError(error)); else { setErr(''); setMode(''); load(); wl.load(); } };

  return (
    <div className="card stack">
      <h3>Surgery</h3>
      {wl.rows.filter((w) => ['waiting', 'scheduled', 'postponed'].includes(w.status)).map((w) => (
        <div key={w.id} className="small"><span className="badge teal">Awaiting · {w.list_type}</span> {w.planned_procedure} {w.planned_date && <span className="muted">· planned {fmtDate(w.planned_date)}</span>}</div>
      ))}
      {rows.length === 0 && wl.rows.length === 0 && <p className="muted small">No surgery recorded or planned.</p>}
      {rows.map((r) => (
        <div key={r.id} className="small spread">
          <span><b>{fmtDate(r.surgery_date)}</b> · {r.procedure_done} <span className="muted">({r.urgency}{r.surgeon ? `, ${r.surgeon}` : ''})</span></span>
          {r.verified_at ? <span className="badge ok">Verified</span>
            : s.can('round.verify') ? <button className="ghost" style={{ padding: '4px 10px' }} onClick={async () => done((await supabase.from('surgeries').update({ verified_at: new Date().toISOString(), verified_by: s.session!.user.id }).eq('id', r.id)).error)}>Verify date</button>
            : <span className="badge warn">Unverified</span>}
        </div>
      ))}
      <p className="muted small" style={{ margin: 0 }}>Postoperative day counts from the verified surgery date. Full OT scheduling arrives in Phase 5.</p>
      {s.can('ipd.write') && mode === '' && <div className="row"><button className="ghost" onClick={() => setMode('list')}>Add to waiting list</button><button className="ghost" onClick={() => setMode('record')}>Record surgery done</button></div>}
      {mode === 'list' && (
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('surgery_waitlist').insert({ patient_id: patientId, admission_id: admissionId, unit_id: s.unit!.id, list_type: f.type, planned_procedure: f.proc.trim(), planned_date: f.planned || null })).error); }}>
          <div className="grid g3"><div className="field" style={{ gridColumn: 'span 2' }}><label className="req">Planned procedure</label><input required value={f.proc} onChange={set('proc')} /></div>
            <div className="field"><label>List</label><select value={f.type} onChange={set('type')}><option value="major">Major OT</option><option value="minor">Minor OT</option><option value="emergency">Emergency</option></select></div></div>
          <div className="field"><label>Planned date</label><input type="date" value={f.planned} onChange={set('planned')} /></div>
          <div className="row"><button>Add</button><button type="button" className="ghost" onClick={() => setMode('')}>Cancel</button></div>
        </form>
      )}
      {mode === 'record' && (
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('surgeries').insert({ admission_id: admissionId, surgery_date: f.date, procedure_done: f.proc.trim(), urgency: f.urgency, surgeon: f.surgeon || null })).error); }}>
          <div className="grid g2"><div className="field"><label className="req">Date</label><input type="date" required value={f.date} onChange={set('date')} /></div>
            <div className="field"><label>Urgency</label><select value={f.urgency} onChange={set('urgency')}><option value="elective">Elective</option><option value="emergency">Emergency</option></select></div></div>
          <div className="field"><label className="req">Procedure done</label><input required value={f.proc} onChange={set('proc')} /></div>
          <div className="field"><label>Operating surgeon</label><input value={f.surgeon} onChange={set('surgeon')} /></div>
          <div className="row"><button>Save</button><button type="button" className="ghost" onClick={() => setMode('')}>Cancel</button></div>
        </form>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function Investigations({ admissionId }: { admissionId: string }) {
  const s = useSession();
  type Row = { id: string; name: string; status: string; result: string | null; ordered_at: string; resulted_at: string | null; abnormal: boolean | null };
  const { rows, load } = usePanel<Row>('investigations', admissionId, '*', 'ordered_at');
  const [name, setName] = useState(''); const [res, setRes] = useState<Record<string, string>>({}); const [err, setErr] = useState('');
  const done = (error: any) => { if (error) setErr(friendlyError(error)); else { setErr(''); load(); } };
  return (
    <div className="card stack">
      <h3>Investigations</h3>
      {rows.length === 0 && <p className="muted small">None recorded.</p>}
      {rows.map((r) => (
        <div key={r.id} className="small" style={{ borderBottom: '1px solid #edf0f4', paddingBottom: 6 }}>
          <div className="spread"><b>{r.name}</b>{r.status === 'pending' ? <span className="badge warn">Pending</span> : <span className={`badge ${r.abnormal ? 'bad' : 'ok'}`}>{r.abnormal ? 'Abnormal' : 'Resulted'}</span>}</div>
          {r.result && <div>{r.result} <span className="muted">· {fmtDateTime(r.resulted_at)}</span></div>}
          {r.status === 'pending' && s.can('ipd.write') && (
            <form className="row" style={{ marginTop: 4, flexWrap: 'nowrap' }} onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('investigations').update({ status: 'resulted', result: res[r.id], resulted_at: new Date().toISOString() }).eq('id', r.id)).error); }}>
              <input required placeholder="Result" value={res[r.id] ?? ''} onChange={(e) => setRes({ ...res, [r.id]: e.target.value })} style={{ padding: '6px 8px' }} />
              <button className="ghost" style={{ padding: '6px 10px' }}>Save</button>
            </form>
          )}
        </div>
      ))}
      {s.can('ipd.write') && (
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('investigations').insert({ admission_id: admissionId, name: name.trim() })).error); setName(''); }}>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Order investigation, e.g. CECT abdomen" />
          <button className="ghost">Add</button>
        </form>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function Medications({ admissionId }: { admissionId: string }) {
  const s = useSession();
  type Row = { id: string; drug: string; dose: string | null; route: string | null; frequency: string | null; start_on: string; status: string };
  const { rows, load } = usePanel<Row>('medication_records', admissionId, '*', 'start_on');
  const [f, setF] = useState({ drug: '', dose: '', route: 'IV', frequency: '' }); const [err, setErr] = useState('');
  const done = (error: any) => { if (error) setErr(friendlyError(error)); else { setErr(''); load(); } };
  return (
    <div className="card stack">
      <h3>Medications</h3>
      {rows.length === 0 && <p className="muted small">None recorded.</p>}
      {rows.map((r) => (
        <div key={r.id} className="small spread" style={{ opacity: r.status === 'stopped' ? .55 : 1 }}>
          <span><b>{r.drug}</b> {[r.dose, r.route, r.frequency].filter(Boolean).join(' · ')} <span className="muted">from {fmtDate(r.start_on)}</span></span>
          {r.status === 'active' ? (s.can('ipd.write') && <button className="ghost" style={{ padding: '3px 9px' }} onClick={async () => done((await supabase.from('medication_records').update({ status: 'stopped', stop_on: new Date().toISOString().slice(0, 10) }).eq('id', r.id)).error)}>Stop</button>)
            : <span className="badge">Stopped</span>}
        </div>
      ))}
      {s.can('ipd.write') && (
        <form className="grid g4" onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('medication_records').insert({ admission_id: admissionId, drug: f.drug.trim(), dose: f.dose || null, route: f.route || null, frequency: f.frequency || null })).error); setF({ ...f, drug: '', dose: '', frequency: '' }); }}>
          <input required value={f.drug} onChange={(e) => setF({ ...f, drug: e.target.value })} placeholder="Drug" />
          <input value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} placeholder="Dose" />
          <select value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })}>{['IV', 'IM', 'Oral', 'SC', 'Topical', 'PR', 'Inhaled'].map((r) => <option key={r}>{r}</option>)}</select>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} placeholder="Freq." /><button className="ghost">Add</button></div>
        </form>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function Rounds({ admissionId }: { admissionId: string }) {
  type Row = { id: string; round_at: string; round_type: string; clinical_status: string; postop_day: number | null; plan: string | null;
    complaints: string | null; verified_at: string | null; author: { full_name: string } | null };
  const { rows } = usePanel<Row>('ward_round_entries', admissionId, '*, author:staff!ward_round_entries_entered_by_fkey(full_name)', 'round_at');
  return (
    <div className="card stack">
      <div className="spread"><h3 style={{ margin: 0 }}>Ward rounds</h3><span className="muted small">Entry screens: Phase 4</span></div>
      {rows.length === 0 ? <p className="muted small">No ward-round entries yet.</p> : rows.map((r) => (
        <div key={r.id} className="small" style={{ borderBottom: '1px solid #edf0f4', paddingBottom: 6 }}>
          <div className="spread"><span><b>{fmtDateTime(r.round_at)}</b> · {r.round_type}{r.postop_day != null && ` · POD ${r.postop_day}`} · {r.author?.full_name}</span>
            <span className="row" style={{ gap: 6 }}><StatusBadge s={r.clinical_status} />{r.verified_at ? <span className="badge ok">Verified</span> : <span className="badge">Unverified</span>}</span></div>
          {r.complaints && <div>C/o {r.complaints}</div>}
          {r.plan && <div><span className="muted">Plan:</span> {r.plan}</div>}
        </div>
      ))}
    </div>
  );
}
