'use client';
import { useState } from 'react';

export type IntraOp = {
  surgery_date?: string; urgency?: string; procedure_done: string; surgeon: string; assistants: string; anaesthetist: string;
  anaesthesia: string; position: string; start_time: string; end_time: string; incision: string; findings: string;
  procedure_steps: string; implants: string; specimen: string; drains: string; blood_loss_ml: string; closure: string;
  complications: string; postop_diagnosis: string; postop_instructions: string;
};

export const INTRAOP_FIELDS: { k: keyof IntraOp; label: string; long?: boolean; ph?: string }[] = [
  { k: 'incision', label: 'Incision / approach', ph: 'e.g. 4-port laparoscopic' },
  { k: 'findings', label: 'Intra-operative findings', long: true },
  { k: 'procedure_steps', label: 'Procedure details', long: true },
  { k: 'implants', label: 'Implants / mesh', ph: 'e.g. Polypropylene mesh 15×15 cm' },
  { k: 'specimen', label: 'Specimen sent', ph: 'e.g. Gallbladder for HPE' },
  { k: 'drains', label: 'Drains', ph: 'e.g. 14 Fr in subhepatic space' },
  { k: 'closure', label: 'Closure' },
  { k: 'complications', label: 'Intra-op complications', ph: 'None' },
  { k: 'postop_diagnosis', label: 'Post-operative diagnosis' },
  { k: 'postop_instructions', label: 'Post-operative instructions', long: true, ph: 'NPO till…, IV fluids, antibiotics, drain care' },
];

export const blankIntraOp = (seed: Partial<IntraOp> = {}): IntraOp => ({
  procedure_done: '', surgeon: '', assistants: '', anaesthetist: '', anaesthesia: '', position: '', start_time: '', end_time: '',
  incision: '', findings: '', procedure_steps: '', implants: '', specimen: '', drains: '', blood_loss_ml: '', closure: '',
  complications: '', postop_diagnosis: '', postop_instructions: '', ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v ?? ''])),
});

/** Full intra-operative note. withDate adds surgery date and urgency (for an operation recorded outside an OT list). */
export function IntraOpForm({ value, onChange, withDate }: { value: IntraOp; onChange: (v: IntraOp) => void; withDate?: boolean }) {
  const set = (k: keyof IntraOp) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="stack" style={{ gap: 8 }}>
      {withDate && (
        <div className="grid g2">
          <div className="field"><label className="req">Date of surgery</label><input type="date" required value={value.surgery_date ?? ''} onChange={set('surgery_date')} /></div>
          <div className="field"><label>Urgency</label><select value={value.urgency ?? 'elective'} onChange={set('urgency')}><option value="elective">Elective</option><option value="emergency">Emergency</option></select></div>
        </div>
      )}
      <div className="field"><label className="req">Procedure done</label><input required value={value.procedure_done} onChange={set('procedure_done')} /></div>
      <div className="grid g2">
        <div className="field"><label>Operating surgeon</label><input value={value.surgeon} onChange={set('surgeon')} /></div>
        <div className="field"><label>Assistants</label><input value={value.assistants} onChange={set('assistants')} /></div>
        <div className="field"><label>Anaesthetist</label><input value={value.anaesthetist} onChange={set('anaesthetist')} /></div>
        <div className="field"><label>Anaesthesia</label><input value={value.anaesthesia} onChange={set('anaesthesia')} placeholder="GA / SA / LA" /></div>
        <div className="field"><label>Position</label><input value={value.position} onChange={set('position')} /></div>
        <div className="field"><label>Blood loss (ml)</label><input type="number" min={0} inputMode="numeric" value={value.blood_loss_ml} onChange={set('blood_loss_ml')} /></div>
        <div className="field"><label>Start time</label><input type="time" value={value.start_time} onChange={set('start_time')} /></div>
        <div className="field"><label>End time</label><input type="time" value={value.end_time} onChange={set('end_time')} /></div>
      </div>
      {INTRAOP_FIELDS.map((f) => (
        <div key={f.k} className="field"><label>{f.label}</label>
          {f.long ? <textarea value={value[f.k] ?? ''} onChange={set(f.k)} placeholder={f.ph} style={{ minHeight: 64 }} />
            : <input value={value[f.k] ?? ''} onChange={set(f.k)} placeholder={f.ph} />}
        </div>
      ))}
    </div>
  );
}

/** Read-only intra-operative note. */
export function IntraOpView({ s }: { s: Partial<Record<keyof IntraOp, string | number | null>> & { surgery_date?: string | null } }) {
  const [open, setOpen] = useState(false);
  const rows: [string, unknown][] = [
    ['Surgeon', s.surgeon], ['Assistants', s.assistants], ['Anaesthetist', s.anaesthetist], ['Anaesthesia', s.anaesthesia],
    ['Position', s.position], ['Time', s.start_time ? `${String(s.start_time).slice(0, 5)}${s.end_time ? ` – ${String(s.end_time).slice(0, 5)}` : ''}` : null],
    ['Blood loss', s.blood_loss_ml != null && s.blood_loss_ml !== '' ? `${s.blood_loss_ml} ml` : null],
    ...INTRAOP_FIELDS.map((f) => [f.label, s[f.k]] as [string, unknown]),
  ];
  const filled = rows.filter(([, v]) => v != null && v !== '');
  const shown = open ? filled : filled.slice(0, 4);
  return (
    <div className="small stack" style={{ gap: 2 }}>
      {shown.map(([k, v]) => <div key={k}><span className="muted">{k}:</span> <span style={{ whiteSpace: 'pre-wrap' }}>{String(v)}</span></div>)}
      {filled.length > 4 && <button className="ghost" style={{ padding: '3px 8px', alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show full note (${filled.length} items)`}</button>}
      {filled.length === 0 && <div className="muted">Intra-operative note not written yet.</div>}
    </div>
  );
}

/** Turn a note into the shape the database expects (empty → null, numbers parsed). */
export function intraOpToRow(v: IntraOp) {
  const out: Record<string, string | number | null> = {};
  for (const [k, raw] of Object.entries(v)) {
    const t = typeof raw === 'string' ? raw.trim() : raw;
    out[k] = t === '' || t == null ? null : k === 'blood_loss_ml' ? Number(t) : (t as string);
  }
  return out;
}
