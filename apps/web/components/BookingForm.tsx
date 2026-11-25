'use client';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel } from '@/lib/personnel';
import { SERVICES, PRIORITY, LATERALITY } from '@/lib/workflow';

/** Book a patient for Major OT, Minor OT or Endoscopy. Puts them on the waiting list.
 *  Asks for the mobile number here if the patient record has none. */
export function BookingForm({ patientId, phone, admissionId, opdVisitId, diagnosis, laterality, onDone, onCancel }: {
  patientId: string; phone: string | null; admissionId?: string | null; opdVisitId?: string | null;
  diagnosis?: string | null; laterality?: string | null; onDone: (id: string) => void; onCancel?: () => void;
}) {
  const s = useSession();
  const pgs = usePersonnel(s.unit?.id).filter((p) => ['pg', 'senior_resident'].includes(p.category));
  const [f, setF] = useState({
    list_type: 'major', planned_procedure: '', diagnosis: diagnosis ?? '', laterality: laterality ?? '', priority: 'routine',
    planned_date: '', responsible_pg_person_id: '', indication: '', notes: '', phone: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    if (!phone) {
      if (!f.phone.trim()) { setErr('Enter the patient’s mobile number. It is needed to call them for the procedure.'); setBusy(false); return; }
      const u = await supabase.from('patients').update({ phone: f.phone.trim() }).eq('id', patientId);
      if (u.error) { setErr(friendlyError(u.error)); setBusy(false); return; }
    }
    const { data, error } = await supabase.from('surgery_waitlist').insert({
      patient_id: patientId, unit_id: s.unit!.id, admission_id: admissionId ?? null, opd_visit_id: opdVisitId ?? null,
      list_type: f.list_type, planned_procedure: f.planned_procedure.trim(), diagnosis: f.diagnosis.trim() || null,
      laterality: f.laterality || null, priority: f.priority, planned_date: f.planned_date || null,
      responsible_pg_person_id: f.responsible_pg_person_id || null, indication: f.indication.trim() || null, notes: f.notes.trim() || null,
    }).select('id').single();
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onDone(data.id);
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Book a procedure</h3>
      <div className="row" style={{ gap: 6 }}>
        {SERVICES.map((sv) => (
          <button type="button" key={sv.v} className={f.list_type === sv.v ? 'teal' : 'ghost'} onClick={() => setF({ ...f, list_type: sv.v })}>{sv.label}</button>
        ))}
      </div>
      <div className="field"><label className="req">Planned procedure</label><input required value={f.planned_procedure} onChange={set('planned_procedure')} placeholder={f.list_type === 'endoscopy' ? 'e.g. UGI endoscopy' : 'e.g. Lap cholecystectomy'} /></div>
      <div className="field"><label>Diagnosis</label><input value={f.diagnosis} onChange={set('diagnosis')} /></div>
      <div className="grid g2">
        <div className="field"><label>Side</label><select value={f.laterality} onChange={set('laterality')}><option value="">—</option>
          {Object.entries(LATERALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Priority</label><select value={f.priority} onChange={set('priority')}>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Planned date</label><input type="date" value={f.planned_date} onChange={set('planned_date')} /></div>
        <div className="field"><label>Responsible PG</label><select value={f.responsible_pg_person_id} onChange={set('responsible_pg_person_id')}><option value="">—</option>
          {pgs.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
      </div>
      <div className="field"><label>Indication</label><input value={f.indication} onChange={set('indication')} /></div>
      {!phone && <div className="field"><label className="req">Mobile number</label><input required value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="Needed to call the patient" /></div>}
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button disabled={busy}>{busy ? 'Saving…' : 'Add to waiting list'}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
