'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { effective, type Entry, type Amendment } from '@/lib/rounds';

const FIELDS = [
  { k: 'diagnosis', label: 'Final diagnosis', rows: 2 },
  { k: 'procedure', label: 'Procedure(s) done', rows: 2 },
  { k: 'presentation', label: 'Presenting complaints', rows: 2 },
  { k: 'course', label: 'Course in hospital', rows: 5 },
  { k: 'investigations', label: 'Significant investigations', rows: 4 },
  { k: 'condition', label: 'Condition at discharge', rows: 2 },
  { k: 'medications', label: 'Medicines on discharge', rows: 4 },
  { k: 'advice', label: 'Advice', rows: 3 },
  { k: 'follow_up', label: 'Follow-up', rows: 2 },
] as const;
type Content = Partial<Record<(typeof FIELDS)[number]['k'], string>>;

type Adm = { id: string; ip_number: string; admitted_at: string; discharged_at: string | null; status: string; unit_id: string;
  patients: { id: string; full_name: string; uhid: string; age_years: number | null; sex: string; allergy_status: string | null; allergies: string | null };
  consultant: { full_name: string } | null; pg: { full_name: string } | null;
  cp: { full_name: string } | null; pgp: { full_name: string } | null };
type Summary = { id: string; content: Content; status: string; finalised_at: string | null; finalised_by: string | null; finaliser?: { full_name: string } | null };

export default function DischargePage() { return <Suspense><DischargeView /></Suspense>; }

function DischargeView() {
  const id = useSearchParams().get('a') ?? '';
  const s = useSession();
  const [adm, setAdm] = useState<Adm | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [c, setC] = useState<Content>({});
  const [bed, setBed] = useState('');
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const a = await supabase.from('admissions').select('*, patients(id, full_name, uhid, age_years, sex, allergy_status, allergies), consultant:staff!admissions_consultant_id_fkey(full_name), pg:staff!admissions_assigned_pg_id_fkey(full_name), cp:unit_personnel!admissions_consultant_person_id_fkey(full_name), pgp:unit_personnel!admissions_pg_person_id_fkey(full_name)').eq('id', id).single();
    if (a.error) return setMsg({ kind: 'err', text: friendlyError(a.error) });
    setAdm(a.data as Adm);
    const b = await supabase.from('bed_assignments').select('ward_beds(label, wards(name))').eq('admission_id', id).order('from_at', { ascending: false }).limit(1).maybeSingle();
    const wb = (b.data as any)?.ward_beds; setBed(wb ? `${wb.wards?.name} · ${wb.label}` : '—');
    const d = await supabase.from('discharge_summaries').select('*, finaliser:staff!discharge_summaries_finalised_by_fkey(full_name)').eq('admission_id', id).maybeSingle();
    if (d.data) { setSum(d.data as Summary); setC((d.data as Summary).content ?? {}); }
    else setC(await prefill(id));
    setDirty(false);
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  if (!adm) return msg ? <div className="msg err">{msg.text}</div> : <p className="muted">Loading…</p>;
  const final = sum?.status === 'final';
  const canEdit = !final && s.can('ipd.write');

  const save = async (finalise = false) => {
    setMsg(null);
    if (finalise && !confirm('Finalise this discharge summary? It cannot be changed afterwards.')) return;
    const r = sum
      ? await supabase.from('discharge_summaries').update({ content: c, ...(finalise ? { status: 'final' } : {}) }).eq('id', sum.id)
      : await supabase.from('discharge_summaries').insert({ admission_id: id, content: c });
    if (r.error) return setMsg({ kind: 'err', text: friendlyError(r.error) });
    if (finalise && !sum) {
      const again = await supabase.from('discharge_summaries').update({ status: 'final' }).eq('admission_id', id);
      if (again.error) return setMsg({ kind: 'err', text: friendlyError(again.error) });
    }
    setMsg({ kind: 'ok', text: finalise ? 'Discharge summary finalised and locked.' : 'Draft saved.' });
    load();
  };
  const p = adm.patients;

  return (
    <div className="stack">
      <div className="spread no-print">
        <Link href={`/patient/?id=${p.id}`} className="small">← {p.full_name}</Link>
        <span className={`badge ${final ? 'ok' : 'warn'}`}>{final ? 'Final' : sum ? 'Draft saved' : 'New draft'}</span>
      </div>
      {msg && <div className={`msg ${msg.kind} no-print`}>{msg.text}</div>}

      {canEdit && (
        <div className="card stack no-print">
          <p className="small muted" style={{ margin: 0 }}>Filled in from the admission: diagnosis, surgery, investigation results, active medicines and the latest round. Check and edit every section.</p>
          {FIELDS.map((f) => (
            <label key={f.k} className="small" style={{ margin: 0 }}>{f.label}
              <textarea rows={f.rows} value={c[f.k] ?? ''} style={{ marginTop: 3, minHeight: f.rows * 22 }}
                onChange={(e) => { setC({ ...c, [f.k]: e.target.value }); setDirty(true); }} /></label>
          ))}
          <div className="grid g2">
            <button className="ghost" onClick={() => save(false)} disabled={!dirty && !!sum}>Save draft</button>
            {s.can('ipd.discharge')
              ? <button className="teal" onClick={() => save(true)}>Finalise and lock</button>
              : <span className="small muted" style={{ alignSelf: 'center' }}>A senior resident or faculty finalises it.</span>}
          </div>
          {!sum && <button className="ghost small" onClick={async () => { setC(await prefill(id)); setDirty(true); }}>Refill from the record</button>}
        </div>
      )}

      <div className="row no-print"><button onClick={() => window.print()}>Print or save as PDF</button></div>

      <style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style>
      <div className="report ds">
        <div className="letterhead">
          <b>INDIRA GANDHI MEDICAL COLLEGE &amp; RESEARCH INSTITUTE, PUDUCHERRY</b>
          <span>Department of General Surgery · {s.unit?.name}</span>
          <h2>DISCHARGE SUMMARY{final ? '' : ' — DRAFT'}</h2>
        </div>
        <table className="ds-head"><tbody>
          <tr><td><span>Name</span>{p.full_name}</td><td><span>Age / Sex</span>{p.age_years ?? '—'} / {p.sex}</td><td><span>UHID</span>{p.uhid}</td></tr>
          <tr><td><span>IP number</span>{adm.ip_number}</td><td><span>Admitted</span>{fmtDate(adm.admitted_at)}</td><td><span>Discharged</span>{adm.discharged_at ? fmtDate(adm.discharged_at) : '—'}</td></tr>
          <tr><td><span>Ward / bed</span>{bed}</td><td><span>Consultant</span>{(adm.cp ?? adm.consultant)?.full_name ?? '—'}</td><td><span>Allergies</span>{p.allergy_status !== 'no' && p.allergies ? p.allergies : 'None known'}</td></tr>
        </tbody></table>
        {FIELDS.filter((f) => c[f.k]?.trim()).map((f) => (
          <div key={f.k} className="ds-sec"><h4>{f.label}</h4><p>{c[f.k]}</p></div>
        ))}
        <div className="ds-sign">
          <div>{(adm.pgp ?? adm.pg)?.full_name ?? ''}<span>Postgraduate</span></div>
          <div>{final ? sum?.finaliser?.full_name : ''}<span>Faculty / Unit Chief{final ? ` · finalised ${fmtDateTime(sum?.finalised_at)}` : ''}</span></div>
        </div>
        <div className="report-foot">In an emergency go to the IGMCRI casualty. Bring this summary to every follow-up visit.</div>
      </div>
    </div>
  );
}

/** Draft content assembled from the admission's own records. */
async function prefill(admissionId: string): Promise<Content> {
  const [dx, sx, inv, meds, rounds] = await Promise.all([
    supabase.from('diagnoses').select('kind, description').eq('admission_id', admissionId).order('created_at'),
    supabase.from('surgeries').select('surgery_date, procedure_done, findings, urgency').eq('admission_id', admissionId).order('surgery_date'),
    supabase.from('investigations').select('name, result, abnormal, status').eq('admission_id', admissionId).eq('status', 'resulted').order('resulted_at'),
    supabase.from('medication_records').select('drug, dose, route, frequency').eq('admission_id', admissionId).eq('status', 'active'),
    supabase.from('ward_round_entries').select('*').eq('admission_id', admissionId).order('round_at'),
  ]);
  const ents = (rounds.data ?? []) as Entry[];
  const am = ents.length ? ((await supabase.from('ward_round_amendments').select('*').in('entry_id', ents.map((e) => e.id))).data ?? []) as Amendment[] : [];
  const first = ents[0] ? effective(ents[0], am) : null;
  const last = ents.at(-1) ? effective(ents.at(-1)!, am) : null;
  const dxl = (dx.data ?? []) as { kind: string; description: string }[];
  const finals = dxl.filter((d) => d.kind === 'final');
  return {
    diagnosis: (finals.length ? finals : dxl.filter((d) => d.kind === 'provisional')).map((d) => d.description).join('\n'),
    procedure: ((sx.data ?? []) as any[]).map((x) => `${x.procedure_done} (${fmtDate(x.surgery_date)}, ${x.urgency})${x.findings ? ` — findings: ${x.findings}` : ''}`).join('\n'),
    presentation: first?.complaints ?? '',
    course: ((sx.data ?? []) as any[]).length
      ? `Admitted and evaluated. Underwent ${((sx.data ?? []) as any[]).map((x) => x.procedure_done).join(', ')}. Postoperative period ${last?.clinical_status === 'stable' || last?.clinical_status === 'improving' ? 'uneventful' : '[describe]'}.`
      : 'Admitted and evaluated. [Describe management.]',
    investigations: ((inv.data ?? []) as any[]).map((x) => `${x.name}: ${x.result}${x.abnormal ? ' (abnormal)' : ''}`).join('\n'),
    condition: last ? `${last.clinical_status === 'stable' || last.clinical_status === 'improving' ? 'Stable' : '[condition]'}${last.vitals?.pulse ? `. Pulse ${last.vitals.pulse}` : ''}${last.vitals?.bp ? `, BP ${last.vitals.bp}` : ''}.` : '',
    medications: ((meds.data ?? []) as any[]).map((m) => [m.drug, m.dose, m.route, m.frequency].filter(Boolean).join(' ')).join('\n'),
    advice: last?.discharge_plan ?? '',
    follow_up: 'Surgery OPD, Unit VI on [date] with this summary and reports.',
  };
}
