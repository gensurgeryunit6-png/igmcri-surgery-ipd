'use client';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { fmtDate, fmtDateTime, ageSex, nowLocalInput, istInputToIso, isoToIstInput, STATUS_LABEL } from '@/lib/format';
import { IntraOpForm, IntraOpView, blankIntraOp, intraOpToRow, type IntraOp } from '@/components/IntraOpNote';
import { BedPicker } from '@/components/BedPicker';
import { StatusBadge, AllergyField } from '@/components/ui';
import { usePersonnel, lastPick, savePick } from '@/lib/personnel';
import { BookingForm } from '@/components/BookingForm';
import { InvestigationRow, type Inv } from '@/components/InvestigationRow';
import { serviceLabel, BOOKING_STATUS, CASE_STATUS, DECISION, VISIT_TYPE } from '@/lib/workflow';
import { Photos } from '@/components/Photos';

type Patient = { id: string; uhid: string; full_name: string; age_years: number | null; sex: string;
  phone: string | null; phone_2: string | null; op_number: string | null; emergency_contact_name: string | null; emergency_contact_phone: string | null;
  allergy_status: 'yes' | 'no' | null; allergies: string | null; comorbidities: string[]; created_at: string };
type Admission = { id: string; ip_number: string; admitted_at: string; admission_type: string; status: string; discharged_at: string | null; follow_up_on: string | null;
  planned_discharge_on: string | null; discharge_note: string | null; consultant_id: string | null; assigned_pg_id: string | null;
  consultant: { full_name: string } | null; pg: { full_name: string } | null;
  cp: { full_name: string } | null; pgp: { full_name: string } | null;
  asst_prof_person_id: string | null; intern_person_id: string | null; pg_person_id: string | null; consultant_person_id: string | null };

export default function PatientPage() { return <Suspense><PatientView /></Suspense>; }

function PatientView() {
  const id = useSearchParams().get('id') ?? '';
  const s = useSession();
  const [p, setP] = useState<Patient | null>(null);
  const [adms, setAdms] = useState<Admission[]>([]);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(useSearchParams().get('tab') ?? 'registration');

  const load = useCallback(async () => {
    const [pp, aa] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).maybeSingle(),
      supabase.from('admissions').select('*, consultant:staff!admissions_consultant_id_fkey(full_name), pg:staff!admissions_assigned_pg_id_fkey(full_name), cp:unit_personnel!admissions_consultant_person_id_fkey(full_name), pgp:unit_personnel!admissions_pg_person_id_fkey(full_name)')
        .eq('patient_id', id).order('admitted_at', { ascending: false }),
    ]);
    if (pp.error) setErr(friendlyError(pp.error));
    setP(pp.data as Patient); setAdms((aa.data as Admission[]) ?? []);
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  if (err) return <div className="msg err">{err}</div>;
  if (!p) return <p className="muted">Loading…</p>;
  const active = adms.find((a) => a.status === 'admitted');
  const current = active ?? adms[0];

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div>
            <h2 style={{ fontSize: 20, margin: 0 }}>{p.full_name}</h2>
            <div className="row small" style={{ gap: 14 }}>
              <span>UHID <b>{p.uhid}</b></span><span>{ageSex(p.age_years, p.sex)}</span>
              {p.op_number && <span>OP {p.op_number}</span>}
              {p.phone && <a href={`tel:${p.phone}`}>{p.phone}</a>}{p.phone_2 && <a href={`tel:${p.phone_2}`}>{p.phone_2}</a>}
              <span>Allergies: {p.allergy_status === 'yes' ? 'Yes' : p.allergy_status === 'no' ? 'No' : 'not recorded'}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {s.can('patient.write') && !editing && <button className="ghost" onClick={() => setEditing(true)}>Edit details</button>}
            {s.can('patient.write') && <Link className="btn ghost" href={`/opd-visit/?p=${p.id}`}>OPD visit</Link>}
            {s.can('patient.archive') && !active && <button className="danger" onClick={async () => {
              const reason = prompt('Reason for removing this patient record (e.g. duplicate registration). The record is archived, not erased, and kept in the audit log.');
              if (!reason) return;
              const { error } = await supabase.rpc('archive_patient', { p_patient: p.id, p_reason: reason });
              if (error) alert(friendlyError(error)); else { alert('Patient record removed from lists.'); history.back(); }
            }}>Remove record</button>}
          </div>
        </div>
        {p.allergy_status !== 'no' && p.allergies && <div className="msg err" style={{ marginTop: 10 }}><b>Allergies:</b> {p.allergies}</div>}
        {editing ? <EditPatient p={p} onDone={() => { setEditing(false); load(); }} /> : (
          <div className="grid g3 small" style={{ marginTop: 10 }}>
            <div><label>Comorbidities</label>{p.comorbidities.length ? p.comorbidities.join(', ') : 'None recorded'}</div>
            <div><label>Emergency contact</label>{p.emergency_contact_name ?? '—'} {p.emergency_contact_phone ?? ''}</div>
          </div>
        )}
      </div>

      <div className="tabs steps">
        {TABS.filter((t) => current || !t.needsAdmission).map((t, i) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.step ? `${t.step}. ` : ''}{t.label}</button>
        ))}
      </div>
      {!active && current && ['rounds', 'surgery', 'discharge'].includes(tab) && (
        <div className="msg info small">Showing the last admission (IP {current.ip_number}, {current.status.replace(/_/g, ' ')}).</div>
      )}

      {tab === 'registration' && (
        <>
          {active ? <ActiveAdmission a={active} onChange={load} />
            : s.can('ipd.write') ? <AdmitForm patient={p} onDone={load} />
            : <div className="card muted">Not currently admitted.</div>}
          {active && <Diagnoses admissionId={active.id} />}
        </>
      )}
      {current && tab === 'rounds' && (
        <>
          <Rounds admissionId={current.id} active={!!active} />
          <Investigations admissionId={current.id} />
          <Medications admissionId={current.id} />
        </>
      )}
      {tab === 'surgery' && <Surgeries admissionId={current?.id ?? null} patient={p} />}
      {current && tab === 'discharge' && <DischargeStep a={current} onChange={load} />}
      {tab === 'followup' && <FollowUp patient={p} last={current ?? null} onChange={load} />}
      {tab === 'photos' && <Photos patientId={p.id} admissionId={active?.id} />}
      {tab === 'history' && (
        <div className="card">
          <h3>Admission history</h3>
          {adms.length === 0 ? <p className="muted small">No admissions yet.</p> : adms.map((a) => (
            <div key={a.id} className="spread small" style={{ borderBottom: '1px solid #edf0f4', padding: '8px 0' }}>
              <span><b>IP {a.ip_number}</b> · {fmtDate(a.admitted_at)} → {a.discharged_at ? fmtDate(a.discharged_at) : 'now'}
                <span className="muted"> · {a.admission_type}{(a.cp ?? a.consultant) ? ` · ${(a.cp ?? a.consultant)!.full_name}` : ''}</span></span>
              <span className="row" style={{ gap: 6 }}><Link href={`/discharge/?a=${a.id}`}>Summary</Link><span className={`badge ${a.status === 'admitted' ? 'teal' : ''}`}>{a.status}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inpatient workflow: Registration → Ward rounds → Surgery → Discharge → Follow-up. */
const TABS = [
  { key: 'registration', label: 'Registration', step: 1 },
  { key: 'rounds', label: 'Ward rounds', step: 2, needsAdmission: true },
  { key: 'surgery', label: 'Surgery', step: 3 },
  { key: 'discharge', label: 'Discharge', step: 4, needsAdmission: true },
  { key: 'followup', label: 'Follow-up', step: 5 },
  { key: 'photos', label: 'Photos' },
  { key: 'history', label: 'History' },
];

// ---------------------------------------------------------------- edit patient
function EditPatient({ p, onDone }: { p: Patient; onDone: () => void }) {
  const [f, setF] = useState({ full_name: p.full_name, age_years: p.age_years?.toString() ?? '', sex: p.sex, phone: p.phone ?? '',
    phone_2: p.phone_2 ?? '', op_number: p.op_number ?? '',
    allergy_status: p.allergy_status ?? (p.allergies ? 'yes' : ''), allergies: p.allergies ?? '', emergency_contact_name: p.emergency_contact_name ?? '',
    emergency_contact_phone: p.emergency_contact_phone ?? '', comorbidities: p.comorbidities.join(', ') });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!f.allergy_status) { setErr('Choose Yes or No for allergies.'); return; }
    const { error } = await supabase.from('patients').update({
      full_name: f.full_name.trim(), age_years: f.age_years ? Number(f.age_years) : null, sex: f.sex, phone: f.phone || null,
      phone_2: f.phone_2.trim() || null, op_number: f.op_number.trim() || null,
      allergy_status: f.allergy_status, allergies: f.allergy_status === 'yes' ? f.allergies.trim() || null : null,
      emergency_contact_name: f.emergency_contact_name || null, emergency_contact_phone: f.emergency_contact_phone || null,
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
        <div className="field"><label>Mobile 1</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Mobile 2</label><input value={f.phone_2} onChange={set('phone_2')} /></div>
        <div className="field"><label>OP number</label><input value={f.op_number} onChange={set('op_number')} /></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Emergency contact</label><input value={f.emergency_contact_name} onChange={set('emergency_contact_name')} /></div>
        <div className="field"><label>Emergency phone</label><input value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} /></div>
      </div>
      <AllergyField status={f.allergy_status} text={f.allergies} onStatus={(v) => setF({ ...f, allergy_status: v })} onText={(v) => setF({ ...f, allergies: v })} />
      <div className="field"><label>Comorbidities (comma separated)</label><input value={f.comorbidities} onChange={set('comorbidities')} /></div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Save</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- admit
function AdmitForm({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const consultants = people.filter((x) => ['unit_chief', 'consultant', 'assistant_professor'].includes(x.category));
  const pgs = people.filter((x) => ['pg', 'senior_resident'].includes(x.category));
  const [open, setOpen] = useState(false);
  const [wards, setWards] = useState<{ id: string; code: string; name: string; free: number }[]>([]);
  const [f, setF] = useState({ ip: '', at: nowLocalInput(), type: 'elective', ward: '', diagnosis: '', consultant: '', pg: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!open || !s.unit) return;
    (async () => {
      const [w, b, occ, last] = await Promise.all([
        supabase.from('wards').select('id, code, name, sort_order').eq('unit_id', s.unit!.id).eq('active', true).order('sort_order'),
        supabase.from('ward_beds').select('id, ward_id').eq('unit_id', s.unit!.id).eq('active', true),
        supabase.from('bed_assignments').select('bed_id').eq('unit_id', s.unit!.id).is('to_at', null),
        supabase.from('admissions').select('id, diagnoses(description, created_at)').eq('patient_id', patient.id)
          .order('admitted_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const busyBeds = new Set((occ.data ?? []).map((x: { bed_id: string }) => x.bed_id));
      const list = ((w.data as { id: string; code: string; name: string }[]) ?? []).map((x) => ({
        ...x, free: ((b.data as { id: string; ward_id: string }[]) ?? []).filter((y) => y.ward_id === x.id && !busyBeds.has(y.id)).length }));
      setWards(list);
      const want = patient.sex === 'F' ? 'FSW' : 'MSW';
      const def = list.find((x) => x.code === want && x.free > 0) ?? list.find((x) => x.free > 0);
      const dx = ((last.data as any)?.diagnoses ?? []).sort((a: any, z: any) => z.created_at.localeCompare(a.created_at))[0]?.description ?? '';
      setF((cur) => ({ ...cur, ward: def?.id ?? '', diagnosis: cur.diagnosis || dx || lastPick('diagnosis') }));
    })();
  }, [open, s.unit, patient.id, patient.sex]);

  useEffect(() => {
    if (!open || !people.length) return;
    setF((cur) => ({
      ...cur,
      consultant: cur.consultant || (consultants.some((c) => c.id === lastPick('consultant')) ? lastPick('consultant') : ''),
      pg: cur.pg || (pgs.some((c) => c.id === lastPick('pg')) ? lastPick('pg') : ''),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people.length]);

  if (!open) return <div className="card spread"><span className="muted">Not currently admitted.</span><button className="teal" onClick={() => setOpen(true)}>Admit to {s.unit?.name}</button></div>;

  const ward = wards.find((w) => w.id === f.ward);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('admit_patient_auto', {
      p_patient_id: patient.id, p_unit_id: s.unit!.id, p_ip_number: f.ip.trim(), p_ward_id: f.ward || null,
      p_admitted_at: istInputToIso(f.at), p_admission_type: f.type, p_diagnosis: f.diagnosis.trim() || null,
      p_consultant_person: f.consultant || null, p_pg_person: f.pg || null,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    savePick('diagnosis', f.diagnosis.trim()); savePick('consultant', f.consultant); savePick('pg', f.pg);
    const bed = (data as { bed_label: string | null }[])?.[0]?.bed_label;
    if (bed) alert(`Admitted. Bed ${bed} in ${ward?.name ?? 'the ward'}.`);
    onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h2>New admission · {s.unit?.name}</h2>
      <div className="grid g2">
        <div className="field"><label>UHID</label><input value={patient.uhid} readOnly style={{ background: '#f3f5f8' }} /></div>
        <div className="field"><label>Patient</label><input value={`${patient.full_name} · ${ageSex(patient.age_years, patient.sex)}`} readOnly style={{ background: '#f3f5f8' }} /></div>
      </div>
      <div className="grid g3">
        <div className="field"><label className="req">IP number</label><input required value={f.ip} onChange={set('ip')} autoFocus /></div>
        <div className="field"><label className="req">Admission date and time</label><input type="datetime-local" required value={f.at} onChange={set('at')} /></div>
        <div className="field"><label>Type</label><select value={f.type} onChange={set('type')}><option value="elective">Elective</option><option value="emergency">Emergency</option></select></div>
      </div>
      <div className="field"><label className="req">Ward</label>
        <select required value={f.ward} onChange={set('ward')}>
          <option value="">Select ward</option>
          {wards.map((w) => <option key={w.id} value={w.id} disabled={w.free === 0}>{w.name} · {w.free ? `${w.free} free` : 'full'}</option>)}
        </select>
        <div className="small muted" style={{ marginTop: 4 }}>The next free bed is given automatically.</div>
      </div>
      <div className="field"><label>Provisional diagnosis</label><input value={f.diagnosis} onChange={set('diagnosis')} /></div>
      <div className="grid g2">
        <div className="field"><label>Consultant</label><select value={f.consultant} onChange={set('consultant')}><option value="">—</option>
          {consultants.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></div>
        <div className="field"><label>Assigned PG</label><select value={f.pg} onChange={set('pg')}><option value="">—</option>
          {pgs.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.pg_year ? ` · PG${c.pg_year}` : ''}</option>)}</select>
          {pgs.length === 0 && <div className="small muted" style={{ marginTop: 4 }}>No PGs yet. Add them under More → Unit personnel.</div>}
        </div>
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
  const [mode, setMode] = useState<'' | 'move'>('');
  const [newBed, setNewBed] = useState('');
  const [admAt, setAdmAt] = useState(isoToIstInput(a.admitted_at));
  const [err, setErr] = useState('');

  const [moves, setMoves] = useState<{ from_at: string; to_at: string | null; reason: string | null; ward_beds: { label: string; wards: { name: string } } }[]>([]);
  const loadBed = useCallback(async () => {
    const { data } = await supabase.from('bed_assignments').select('from_at, to_at, reason, ward_beds(label, wards(name))').eq('admission_id', a.id).order('from_at');
    const list = (data as any[]) ?? [];
    setMoves(list);
    const b = list.find((x) => !x.to_at)?.ward_beds;
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
          <div><label>Consultant</label>{(a.cp ?? a.consultant)?.full_name ?? '—'}</div>
          <div><label>Assigned PG</label>{(a.pgp ?? a.pg)?.full_name ?? '—'}</div>
          <Team a={a} onChange={onChange} />
          <div><label>Admitted on</label>
            {s.can('ipd.write') ? (
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input type="datetime-local" value={admAt} onChange={(e) => setAdmAt(e.target.value)} style={{ padding: '5px 8px' }} />
                {admAt !== isoToIstInput(a.admitted_at) && <button className="ghost" style={{ padding: '5px 10px' }}
                  onClick={() => run(() => supabase.from('admissions').update({ admitted_at: istInputToIso(admAt) }).eq('id', a.id))}>Save</button>}
              </div>) : fmtDateTime(a.admitted_at)}
          </div>
        </div>
        {s.can('ipd.write') && (
          <div className="row">
            <button className="ghost" onClick={() => setMode(mode === 'move' ? '' : 'move')}>{bed ? 'Move bed / ward' : 'Allocate bed'}</button>
          </div>
        )}
        {mode === 'move' && (
          <div className="card stack" style={{ background: '#fafbfc' }}>
            <BedPicker unitId={s.unit!.id} value={newBed} onChange={setNewBed} required />
            <div className="row"><button disabled={!newBed} onClick={() => run(() => supabase.rpc('move_patient_bed', { p_admission_id: a.id, p_bed_id: newBed, p_reason: bed ? 'Transfer' : 'Allocation' }))}>Confirm move</button>
              <button className="ghost" onClick={() => setMode('')}>Cancel</button></div>
          </div>
        )}
        {moves.length > 1 && (
          <details className="small">
            <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Bed and ward history · {moves.length} moves</summary>
            {moves.map((m, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #edf0f4' }}>
                <b>{m.ward_beds?.wards?.name} · {m.ward_beds?.label}</b> <span className="muted">{fmtDateTime(m.from_at)} → {m.to_at ? fmtDateTime(m.to_at) : 'now'}{m.reason ? ` · ${m.reason}` : ''}</span>
              </div>
            ))}
          </details>
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

function Surgeries({ admissionId, patient }: { admissionId: string | null; patient: Patient }) {
  const s = useSession();
  type Row = { id: string; surgery_date: string; procedure_done: string; urgency: string; verified_at: string | null } & Record<string, string | number | null>;
  type Bk = { id: string; list_type: string; planned_procedure: string; status: string; planned_date: string | null; preop_ready: boolean; status_reason: string | null };
  type Cs = { id: string; procedure: string; procedure_done: string | null; status: string; findings: string | null; postop_diagnosis: string | null; status_reason: string | null; ot_lists: { list_date: string; service: string } | null };
  const [rows, setRows] = useState<Row[]>([]);
  const [bks, setBks] = useState<Bk[]>([]);
  const [cases, setCases] = useState<Cs[]>([]);
  const [mode, setMode] = useState<'' | 'record' | 'book'>('');
  const [note, setNote] = useState<IntraOp>(blankIntraOp());
  const [editId, setEditId] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [b, c, r] = await Promise.all([
      supabase.from('surgery_waitlist').select('id, list_type, planned_procedure, status, planned_date, preop_ready, status_reason').eq('patient_id', patient.id).order('created_at', { ascending: false }),
      supabase.from('ot_cases').select('id, procedure, procedure_done, status, findings, postop_diagnosis, status_reason, ot_lists(list_date, service)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
      admissionId ? supabase.from('surgeries').select('*').eq('admission_id', admissionId).order('surgery_date', { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    setBks((b.data as Bk[]) ?? []); setCases((c.data as unknown as Cs[]) ?? []); setRows((r.data as Row[]) ?? []);
  }, [patient.id, admissionId]);
  useEffect(() => { load(); }, [load]);
  const done = (error: unknown) => { if (error) setErr(friendlyError(error)); else { setErr(''); setMode(''); load(); } };
  const open = bks.filter((b) => ['waiting', 'scheduled', 'postponed'].includes(b.status));

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Planned procedures</h3>
        {open.length === 0 && <p className="muted small" style={{ margin: 0 }}>Not booked for any procedure.</p>}
        {open.map((b) => (
          <Link key={b.id} href={`/booking/?id=${b.id}`} className="spread small" style={{ color: 'inherit' }}>
            <span><b>{serviceLabel(b.list_type)}</b> · {b.planned_procedure}{b.planned_date ? <span className="muted"> · {fmtDate(b.planned_date)}</span> : null}</span>
            <span className="row" style={{ gap: 4 }}><span className={`badge ${b.preop_ready ? 'ok' : 'warn'}`}>{b.preop_ready ? 'Pre-op ready' : 'Pre-op due'}</span><span className="badge teal">{BOOKING_STATUS[b.status]}</span></span>
          </Link>
        ))}
        {s.can('ot.prepare') && mode !== 'book' && <button className="ghost" onClick={() => setMode('book')}>Book a procedure</button>}
        {open.length > 0 && <div className="small muted">Pre-op work-up is done on each booking (tap it), for Major OT, Minor OT and Endoscopy alike.</div>}
      </div>
      {mode === 'book' && <BookingForm patientId={patient.id} phone={patient.phone} admissionId={admissionId} onDone={() => { setMode(''); load(); }} onCancel={() => setMode('')} />}

      {admissionId && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="spread"><h3 style={{ margin: 0 }}>Intra-operative notes</h3>
            {s.can('ipd.write') && mode === '' && <button className="ghost" style={{ padding: '6px 12px' }} onClick={() => { setNote(blankIntraOp({ surgery_date: new Date().toISOString().slice(0, 10), urgency: 'emergency' })); setMode('record'); }}>+ Record an operation</button>}</div>
          {rows.length === 0 && mode !== 'record' && <p className="muted small" style={{ margin: 0 }}>No operation recorded for this admission. Operations done from an OT list appear here automatically.</p>}
          {rows.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 6, borderBottom: '1px solid #edf0f4', paddingBottom: 8 }}>
              <div className="spread"><span><b>{fmtDate(r.surgery_date)}</b> · {r.procedure_done} <span className="muted">({r.urgency})</span></span>
                {r.verified_at ? <span className="badge ok">Date verified</span>
                  : s.can('round.verify') ? <button className="ghost" style={{ padding: '4px 10px' }} onClick={async () => done((await supabase.from('surgeries').update({ verified_at: new Date().toISOString(), verified_by: s.session!.user.id }).eq('id', r.id)).error)}>Verify date</button>
                  : <span className="badge warn">Date unverified</span>}</div>
              {editId === r.id ? (
                <div className="stack">
                  <IntraOpForm value={note} onChange={setNote} />
                  <div className="row"><button onClick={async () => { const row = intraOpToRow(note); delete row.surgery_date; delete row.urgency;
                    done((await supabase.from('surgeries').update(row).eq('id', r.id)).error); setEditId(''); }}>Save note</button>
                    <button className="ghost" onClick={() => setEditId('')}>Cancel</button></div>
                </div>
              ) : (
                <>
                  <IntraOpView s={r} />
                  {s.can('ipd.write') && <button className="ghost" style={{ padding: '4px 10px', alignSelf: 'flex-start' }} onClick={() => { setNote(blankIntraOp(r as unknown as Partial<IntraOp>)); setEditId(r.id); }}>Write / edit intra-op note</button>}
                </>
              )}
            </div>
          ))}
          {mode === 'record' && (
            <form className="stack" onSubmit={async (e) => { e.preventDefault(); done((await supabase.from('surgeries').insert({ admission_id: admissionId, ...intraOpToRow(note) })).error); }}>
              <IntraOpForm value={note} onChange={setNote} withDate />
              <div className="row"><button>Save operation</button><button type="button" className="ghost" onClick={() => setMode('')}>Cancel</button></div>
            </form>
          )}
          <p className="muted small" style={{ margin: 0 }}>Post-op day counts from the verified surgery date.</p>
        </div>
      )}

      {cases.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>OT, minor OT and endoscopy record</h3>
          {cases.map((c) => (
            <div key={c.id} className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
              <div className="spread"><span><b>{c.ot_lists ? fmtDate(c.ot_lists.list_date) : ''}</b> · {serviceLabel(c.ot_lists?.service ?? '')} · {c.procedure_done ?? c.procedure}</span>
                <span className={`badge ${c.status === 'done' ? 'ok' : c.status === 'planned' ? 'teal' : 'warn'}`}>{CASE_STATUS[c.status]}</span></div>
              {c.findings && <div className="muted">Findings: {c.findings}</div>}
              {c.postop_diagnosis && <div className="muted">{c.ot_lists?.service === 'endoscopy' ? 'Impression' : 'Post-op diagnosis'}: {c.postop_diagnosis}</div>}
              {c.status_reason && <div className="muted">Reason: {c.status_reason}</div>}
            </div>
          ))}
        </div>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function Investigations({ admissionId }: { admissionId: string }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const { rows, load } = usePanel<Inv>('investigations', admissionId, '*', 'ordered_at');
  const [name, setName] = useState(''); const [err, setErr] = useState('');
  return (
    <div className="card stack" style={{ gap: 4 }}>
      <h3>Investigations</h3>
      {rows.length === 0 && <p className="muted small">None recorded.</p>}
      {rows.map((r) => <InvestigationRow key={r.id} r={r} people={people} onChange={load} />)}
      {s.can('ipd.write') && (
        <form className="row" style={{ flexWrap: 'nowrap', marginTop: 8 }} onSubmit={async (e) => { e.preventDefault();
          const { error } = await supabase.from('investigations').insert({ admission_id: admissionId, name: name.trim() });
          if (error) setErr(friendlyError(error)); else { setErr(''); setName(''); load(); } }}>
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

function Rounds({ admissionId, active }: { admissionId: string; active: boolean }) {
  type Row = { id: string; round_at: string; round_type: string; clinical_status: string; postop_day: number | null; plan: string | null;
    complaints: string | null; verified_at: string | null; author: { full_name: string } | null };
  const { rows } = usePanel<Row>('ward_round_entries', admissionId, '*, author:staff!ward_round_entries_entered_by_fkey(full_name)', 'round_at');
  return (
    <div className="card stack">
      <div className="spread"><h3 style={{ margin: 0 }}>Daily ward rounds</h3>{active && <Link className="btn teal" style={{ padding: '6px 12px' }} href={`/round/?a=${admissionId}`}>Write today’s round</Link>}</div>
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

/** Assistant professor and intern for this admission; consultant and PG can be changed here too. */
function Team({ a, onChange }: { a: Admission; onChange: () => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ consultant_person_id: a.consultant_person_id ?? '', asst_prof_person_id: a.asst_prof_person_id ?? '',
    pg_person_id: a.pg_person_id ?? '', intern_person_id: a.intern_person_id ?? '' });
  const [err, setErr] = useState('');
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? '—';
  const pick = (cats: string[], k: keyof typeof f, label: string) => (
    <div className="field"><label>{label}</label><select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">—</option>
      {people.filter((p) => cats.includes(p.category)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>);
  if (!edit) return (
    <>
      <div><label>Asst. Professor</label>{name(a.asst_prof_person_id)}</div>
      <div><label>Intern</label>{name(a.intern_person_id)}
        {s.can('ipd.write') && <div><button className="ghost" style={{ padding: '3px 8px', marginTop: 4 }} onClick={() => setEdit(true)}>Change team</button></div>}</div>
    </>
  );
  const save = async () => {
    const pg = people.find((p) => p.id === f.pg_person_id);
    const { error } = await supabase.from('admissions').update({
      consultant_person_id: f.consultant_person_id || null, asst_prof_person_id: f.asst_prof_person_id || null,
      pg_person_id: f.pg_person_id || null, intern_person_id: f.intern_person_id || null,
      assigned_pg_id: pg?.user_id ?? null,
    }).eq('id', a.id);
    if (error) setErr(friendlyError(error)); else { setEdit(false); onChange(); }
  };
  return (
    <div className="stack" style={{ gridColumn: '1 / -1' }}>
      <div className="grid g2">
        {pick(['unit_chief', 'consultant'], 'consultant_person_id', 'Consultant')}
        {pick(['assistant_professor', 'consultant'], 'asst_prof_person_id', 'Asst. Professor')}
        {pick(['pg', 'senior_resident'], 'pg_person_id', 'Assigned PG')}
        {pick(['intern'], 'intern_person_id', 'Intern')}
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button onClick={save}>Save team</button><button className="ghost" onClick={() => setEdit(false)}>Cancel</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- step 4: discharge
function DischargeStep({ a, onChange }: { a: Admission; onChange: () => void }) {
  const s = useSession();
  const [sum, setSum] = useState<{ status: string; finalised_at: string | null } | null>(null);
  const [planned, setPlanned] = useState(a.planned_discharge_on ?? '');
  const [fu, setFu] = useState(a.follow_up_on ?? '');
  const [dStatus, setDStatus] = useState('discharged');
  const [dNote, setDNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { supabase.from('discharge_summaries').select('status, finalised_at').eq('admission_id', a.id).maybeSingle().then(({ data }) => setSum(data)); }, [a.id]);
  const run = async (p: PromiseLike<{ error: unknown }>) => { setErr(''); const { error } = await p; if (error) setErr(friendlyError(error)); else { setConfirm(false); onChange(); } };
  const admitted = a.status === 'admitted';
  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Discharge summary</h3>
        <div className="spread small">
          <span>{sum ? (sum.status === 'final' ? `Approved ${fmtDateTime(sum.finalised_at)}` : 'Draft — not yet approved by faculty') : 'Not started'}</span>
          <span className={`badge ${sum?.status === 'final' ? 'ok' : 'warn'}`}>{sum?.status === 'final' ? 'Final' : sum ? 'Draft' : 'To do'}</span>
        </div>
        <Link className="btn teal" href={`/discharge/?a=${a.id}`}>{sum ? 'Open discharge summary' : 'Write discharge summary'}</Link>
      </div>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Dates</h3>
        <div className="grid g2">
          {admitted && <div className="field"><label>Planned discharge</label>
            <input type="date" disabled={!s.can('ipd.write')} value={planned} onChange={(e) => setPlanned(e.target.value)} /></div>}
          <div className="field"><label>Follow-up date</label>
            <input type="date" disabled={!s.can('ipd.write')} value={fu} onChange={(e) => setFu(e.target.value)} /></div>
        </div>
        {s.can('ipd.write') && (planned !== (a.planned_discharge_on ?? '') || fu !== (a.follow_up_on ?? '')) &&
          <button onClick={() => run(supabase.from('admissions').update({ planned_discharge_on: planned || null, follow_up_on: fu || null }).eq('id', a.id))}>Save dates</button>}
        <div className="small muted">The follow-up date puts the patient on the OPD follow-up list on that day.</div>
      </div>
      {admitted ? (s.can('ipd.discharge') && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Discharge the patient</h3>
          {sum?.status !== 'final' && <div className="msg info small">The discharge summary is not approved yet.</div>}
          {!fu && <div className="msg info small">No follow-up date set.</div>}
          <div className="grid g2">
            <div className="field"><label>Outcome</label><select value={dStatus} onChange={(e) => setDStatus(e.target.value)}>
              <option value="discharged">Discharged</option><option value="transferred_out">Transferred to another unit / hospital</option>
              <option value="dama">Discharged against medical advice</option><option value="absconded">Absconded</option><option value="expired">Expired</option></select></div>
            <div className="field"><label>Note</label><input value={dNote} onChange={(e) => setDNote(e.target.value)} /></div>
          </div>
          {!confirm ? <button onClick={() => setConfirm(true)}>{dStatus === 'discharged' ? 'Discharge' : 'Record outcome'}</button> : (
            <>
              <div className="msg info small">This closes the admission and frees the bed. It cannot be undone from the app.</div>
              <div className="row"><button className="danger" onClick={() => run(supabase.rpc('discharge_patient', { p_admission_id: a.id, p_status: dStatus, p_note: dNote || null }))}>Confirm</button>
                <button className="ghost" onClick={() => setConfirm(false)}>Back</button></div>
            </>
          )}
        </div>
      )) : (
        <div className="card small">Outcome: <b>{a.status.replace(/_/g, ' ')}</b> on {fmtDateTime(a.discharged_at)}</div>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- step 5: follow-up
function FollowUp({ patient, last, onChange }: { patient: Patient; last: Admission | null; onChange: () => void }) {
  const s = useSession();
  type V = { id: string; visit_at: string; visit_type: string; diagnosis: string | null; notes: string | null; decision: string; follow_up_on: string | null };
  const [visits, setVisits] = useState<V[]>([]);
  useEffect(() => {
    supabase.from('opd_visits').select('id, visit_at, visit_type, diagnosis, notes, decision, follow_up_on').eq('patient_id', patient.id)
      .order('visit_at', { ascending: false }).limit(20).then(({ data }) => setVisits((data as V[]) ?? []));
  }, [patient.id]);
  const after = last?.discharged_at ? visits.filter((v) => v.visit_at >= last.discharged_at!) : visits;
  const nextDate = [last?.follow_up_on, visits[0]?.follow_up_on].filter(Boolean).sort().at(-1) as string | undefined;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="spread"><h3 style={{ margin: 0 }}>Next follow-up</h3>
          <span className="badge teal">{nextDate ? fmtDate(nextDate) : 'Not set'}</span></div>
        {last && last.status === 'admitted' && <div className="small muted">Set the follow-up date in step 4 (Discharge).</div>}
        {s.can('patient.write') && <Link className="btn teal" href={`/opd-visit/?p=${patient.id}&t=${last?.status === 'discharged' ? 'post_op' : 'follow_up'}`}>Record follow-up visit</Link>}
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>{last?.discharged_at ? 'Visits since discharge' : 'OPD visits'}</h3>
        {after.length === 0 && <p className="muted small" style={{ margin: 0 }}>None yet.</p>}
        {after.map((v) => (
          <div key={v.id} className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
            <div className="spread"><b>{fmtDate(v.visit_at)} · {VISIT_TYPE[v.visit_type]}</b><span className="badge">{DECISION[v.decision]}</span></div>
            <div>{v.diagnosis ?? '—'}</div>{v.notes && <div className="muted">{v.notes}</div>}
            {v.follow_up_on && <div className="muted">Next: {fmtDate(v.follow_up_on)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
