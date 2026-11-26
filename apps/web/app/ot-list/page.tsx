'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel } from '@/lib/personnel';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { downloadXlsx, type Report } from '@/lib/reports';
import { ReportView } from '@/components/ReportView';
import { IntraOpForm, blankIntraOp, type IntraOp } from '@/components/IntraOpNote';
import { CASE_STATUS, LATERALITY, SESSIONS, serviceLabel, isReportService, loadOtList, caseWho, type OtCase, type OtList, type WaitRow } from '@/lib/workflow';

export default function OtListPage() { return <Suspense><OtListView /></Suspense>; }

function OtListView() {
  const id = useSearchParams().get('id') ?? '';
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const [list, setList] = useState<OtList | null>(null);
  const [cases, setCases] = useState<OtCase[]>([]);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'' | 'add' | 'manual' | 'print'>('');
  const can = s.can('ot.prepare');

  const load = useCallback(async () => {
    try {
      const r = await loadOtList(id);
      setList(r.list); setCases(r.cases);
      const bids = r.cases.map((c) => c.booking_id).filter(Boolean) as string[];
      if (bids.length) {
        const { data } = await supabase.from('surgery_waitlist').select('id, preop_ready').in('id', bids);
        setReady(Object.fromEntries((data ?? []).map((x: { id: string; preop_ready: boolean }) => [x.id, x.preop_ready])));
      }
    } catch (e) { setErr(friendlyError(e)); }
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  const run = async (p: PromiseLike<{ error: unknown }>) => {
    setErr('');
    const { error } = await p;
    if (error) { setErr(friendlyError(error)); return false; }
    load(); return true;
  };

  if (err && !list) return <div className="msg err">{err}</div>;
  if (!list) return <p className="muted">Loading…</p>;
  const draft = list.status === 'draft';
  const editable = can && draft;
  const consultant = people.find((p) => p.id === list.consultant_person_id)?.full_name;

  const move = (i: number, d: number) => {
    const ids = cases.map((c) => c.id);
    const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(supabase.rpc('reorder_ot_cases', { p_list: list.id, p_ids: ids }));
  };

  if (mode === 'print') {
    const r = listReport(list, cases, consultant);
    return (
      <div className="stack">
        <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
        <div className="row no-print">
          <button onClick={() => window.print()}>Print or save as PDF</button>
          <button className="ghost" onClick={() => downloadXlsx(r, `${list.service}-ot-list-${list.list_date}.xlsx`)}>Download Excel</button>
          <button className="ghost" onClick={() => setMode('')}>Back</button>
        </div>
        <ReportView report={r} made={new Date().toISOString()} />
      </div>
    );
  }

  return (
    <div className="stack">
      <ListHeader list={list} editable={editable} consultant={consultant} onSave={(patch) => run(supabase.from('ot_lists').update(patch).eq('id', list.id))} />

      <div className="row">
        <button onClick={() => setMode('print')}>Print list</button>
        {s.can('ot.approve') && (draft
          ? <button className="teal" disabled={!cases.length} onClick={() => run(supabase.from('ot_lists').update({ status: 'final' }).eq('id', list.id))}>Finalise list</button>
          : <button className="ghost" onClick={() => run(supabase.from('ot_lists').update({ status: 'draft' }).eq('id', list.id))}>Reopen for changes</button>)}
      </div>
      {!draft && <div className="msg info small">Final{list.finalised_at ? ` since ${fmtDateTime(list.finalised_at)}` : ''}. Cases can still be marked done, postponed or cancelled.</div>}
      {draft && !s.can('ot.approve') && <div className="small muted">A Consultant or the Unit Chief finalises the list.</div>}
      {err && <div className="msg err">{err}</div>}

      {cases.length === 0 && <p className="muted">No cases yet.</p>}
      {cases.map((c, i) => <CaseCard key={c.id} c={c} n={i + 1} ready={c.booking_id ? ready[c.booking_id] : undefined}
        editable={editable} canOutcome={can} service={list.service}
        onUp={i > 0 ? () => move(i, -1) : undefined} onDown={i < cases.length - 1 ? () => move(i, 1) : undefined}
        onSave={(patch) => run(supabase.from('ot_cases').update(patch).eq('id', c.id))}
        onOutcome={(st, reason, note) => run(supabase.rpc('set_ot_case_outcome', { p_case: c.id, p_status: st, p_reason: reason ?? null, p_note: note ?? {} }))} />)}

      {editable && mode === '' && (
        <div className="row">
          <button className="teal" onClick={() => setMode('add')}>+ Add from waiting list</button>
          <button className="ghost" onClick={() => setMode('manual')}>+ Add by hand</button>
        </div>
      )}
      {editable && mode === 'add' && <AddFromWaiting list={list} onDone={() => { setMode(''); load(); }} />}
      {editable && mode === 'manual' && <ManualCase list={list} onDone={() => { setMode(''); load(); }} />}
    </div>
  );
}

function ListHeader({ list, editable, consultant, onSave }: { list: OtList; editable: boolean; consultant?: string; onSave: (p: Partial<OtList>) => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id).filter((p) => ['unit_chief', 'consultant', 'assistant_professor'].includes(p.category));
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(list);
  useEffect(() => setF(list), [list]);
  if (!edit) return (
    <div className="card">
      <div className="spread"><h2 style={{ margin: 0 }}>{serviceLabel(list.service)} · {fmtDate(list.list_date)}</h2>
        <span className={`badge ${list.status === 'final' ? 'navy' : 'warn'}`}>{list.status === 'final' ? 'Final' : 'Draft'}</span></div>
      <div className="small muted">{SESSIONS[list.session]}{list.ot_room ? ` · ${list.ot_room}` : ''}{consultant ? ` · ${consultant}` : ''}{list.anaesthetist ? ` · Anaesthetist ${list.anaesthetist}` : ''}</div>
      {list.notes && <div className="small">{list.notes}</div>}
      {editable && <button className="ghost" style={{ marginTop: 8 }} onClick={() => setEdit(true)}>Edit list details</button>}
    </div>
  );
  return (
    <div className="card stack">
      <div className="grid g3">
        <div className="field"><label>Date</label><input type="date" value={f.list_date} onChange={(e) => setF({ ...f, list_date: e.target.value })} /></div>
        <div className="field"><label>OT room</label><input value={f.ot_room} onChange={(e) => setF({ ...f, ot_room: e.target.value })} /></div>
        <div className="field"><label>Session</label><select value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })}>{Object.entries(SESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Operating consultant</label><select value={f.consultant_person_id ?? ''} onChange={(e) => setF({ ...f, consultant_person_id: e.target.value || null })}><option value="">—</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
        <div className="field"><label>Anaesthetist</label><input value={f.anaesthetist ?? ''} onChange={(e) => setF({ ...f, anaesthetist: e.target.value })} /></div>
      </div>
      <div className="field"><label>Notes</label><input value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="row"><button onClick={() => { onSave({ list_date: f.list_date, ot_room: f.ot_room.trim(), session: f.session, consultant_person_id: f.consultant_person_id, anaesthetist: f.anaesthetist?.trim() || null, notes: f.notes?.trim() || null }); setEdit(false); }}>Save</button>
        <button className="ghost" onClick={() => setEdit(false)}>Cancel</button></div>
    </div>
  );
}

function CaseCard({ c, n, ready, editable, canOutcome, service, onUp, onDown, onSave, onOutcome }: {
  c: OtCase; n: number; ready?: boolean; editable: boolean; canOutcome: boolean; service: string;
  onUp?: () => void; onDown?: () => void; onSave: (p: Partial<OtCase>) => void;
  onOutcome: (status: string, reason?: string, note?: Record<string, string>) => void;
}) {
  const w = caseWho(c);
  const [mode, setMode] = useState<'' | 'edit' | 'done' | 'postponed' | 'cancelled'>('');
  const [f, setF] = useState(c);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState({ procedure_done: c.procedure, findings: '', postop_diagnosis: '', complications: '' });
  const [op, setOp] = useState<IntraOp>(blankIntraOp({ procedure_done: c.procedure, surgeon: c.surgeon ?? '', assistants: c.assistants ?? '', anaesthesia: c.anaesthesia ?? '', position: c.position ?? '' }));
  useEffect(() => setF(c), [c]);
  const endo = isReportService(service);
  const set = (k: keyof OtCase) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });

  return (
    <div className="card stack" style={{ gap: 6, opacity: ['postponed', 'cancelled'].includes(c.status) ? 0.6 : 1 }}>
      <div className="spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div>
          <b>{n}. {w.name}</b> <span className="muted small">{w.ageSex} · {w.id}</span>
          <div className="small"><b>{c.procedure}</b>{c.laterality && c.laterality !== 'na' ? ` (${LATERALITY[c.laterality]})` : ''}{c.diagnosis ? <span className="muted"> · {c.diagnosis}</span> : null}</div>
        </div>
        {editable && <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="ghost" style={{ padding: '4px 10px' }} disabled={!onUp} onClick={onUp} aria-label="Move up">↑</button>
          <button className="ghost" style={{ padding: '4px 10px' }} disabled={!onDown} onClick={onDown} aria-label="Move down">↓</button>
        </div>}
      </div>
      <div className="row small" style={{ gap: 6 }}>
        <span className={`badge ${c.status === 'done' ? 'ok' : c.status === 'planned' ? 'teal' : 'warn'}`}>{CASE_STATUS[c.status]}</span>
        {c.status === 'planned' && ready !== undefined && <span className={`badge ${ready ? 'ok' : 'bad'}`}>{ready ? 'Pre-op ready' : 'Pre-op incomplete'}</span>}
        {c.anaesthesia && <span className="badge">{c.anaesthesia}</span>}
        {c.serology && <span className="badge">Serology {c.serology}</span>}
        {c.position && <span className="badge">{c.position}</span>}
      </div>
      {(c.surgeon || c.assistants) && <div className="small">Surgeon {c.surgeon ?? '—'}{c.assistants ? ` · Assist ${c.assistants}` : ''}</div>}
      {c.special_requirements && <div className="small muted">Needs: {c.special_requirements}</div>}
      {c.status_reason && <div className="small muted">Reason: {c.status_reason}</div>}
      {c.status === 'done' && (
        <div className="small" style={{ background: '#f6f8fa', padding: 8, borderRadius: 6 }}>
          <b>{endo ? 'Endoscopy report' : 'Operation note'}</b> · {c.procedure_done}
          {c.findings && <div>{endo ? 'Findings' : 'Findings'}: {c.findings}</div>}
          {c.postop_diagnosis && <div>{endo ? 'Impression' : 'Post-op diagnosis'}: {c.postop_diagnosis}</div>}
          {c.complications && <div>Complications: {c.complications}</div>}
        </div>
      )}
      {c.booking_id && <Link className="small" href={`/booking/?id=${c.booking_id}`}>Booking and pre-op checklist →</Link>}

      {mode === '' && (
        <div className="row" style={{ gap: 6 }}>
          {editable && c.status === 'planned' && <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => setMode('edit')}>Edit</button>}
          {canOutcome && c.status === 'planned' && <>
            <button className="teal" style={{ padding: '6px 10px' }} onClick={() => setMode('done')}>Done</button>
            <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => setMode('postponed')}>Postpone</button>
            <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => setMode('cancelled')}>Cancel</button>
          </>}
          {canOutcome && ['postponed', 'cancelled'].includes(c.status) && <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => onOutcome('planned')}>Put back on list</button>}
        </div>
      )}
      {mode === 'edit' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="field"><label>Procedure</label><input value={f.procedure} onChange={set('procedure')} /></div>
          <div className="grid g2">
            <div className="field"><label>Diagnosis</label><input value={f.diagnosis ?? ''} onChange={set('diagnosis')} /></div>
            <div className="field"><label>Side</label><select value={f.laterality ?? ''} onChange={set('laterality')}><option value="">—</option>{Object.entries(LATERALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label>Operating surgeon</label><input value={f.surgeon ?? ''} onChange={set('surgeon')} /></div>
            <div className="field"><label>Assistants</label><input value={f.assistants ?? ''} onChange={set('assistants')} /></div>
            <div className="field"><label>Anaesthesia</label><input value={f.anaesthesia ?? ''} onChange={set('anaesthesia')} placeholder="GA / SA / LA" /></div>
            <div className="field"><label>Serology</label><input value={f.serology ?? ''} onChange={set('serology')} /></div>
            <div className="field"><label>Position</label><input value={f.position ?? ''} onChange={set('position')} /></div>
            <div className="field"><label>Special requirements</label><input value={f.special_requirements ?? ''} onChange={set('special_requirements')} /></div>
          </div>
          <div className="row"><button onClick={() => { onSave({ procedure: f.procedure, diagnosis: f.diagnosis, laterality: f.laterality, surgeon: f.surgeon, assistants: f.assistants, anaesthesia: f.anaesthesia, serology: f.serology, position: f.position, special_requirements: f.special_requirements }); setMode(''); }}>Save</button>
            <button className="ghost" onClick={() => setMode('')}>Cancel</button></div>
        </div>
      )}
      {mode === 'done' && !endo && (
        <div className="stack" style={{ gap: 8 }}>
          <b className="small">Intra-operative note</b>
          <IntraOpForm value={op} onChange={setOp} />
          <div className="row"><button className="teal" disabled={!op.procedure_done.trim()} onClick={() => { onOutcome('done', undefined, op as unknown as Record<string, string>); setMode(''); }}>Save intra-operative note</button>
            <button className="ghost" onClick={() => setMode('')}>Back</button></div>
        </div>
      )}
      {mode === 'done' && endo && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="field"><label className="req">{endo ? 'Procedure done' : 'Procedure done'}</label><input value={note.procedure_done} onChange={(e) => setNote({ ...note, procedure_done: e.target.value })} /></div>
          <div className="field"><label>Findings</label><textarea value={note.findings} onChange={(e) => setNote({ ...note, findings: e.target.value })} style={{ minHeight: 60 }} /></div>
          <div className="field"><label>{endo ? 'Impression' : 'Post-op diagnosis'}</label><input value={note.postop_diagnosis} onChange={(e) => setNote({ ...note, postop_diagnosis: e.target.value })} /></div>
          <div className="field"><label>Complications</label><input value={note.complications} onChange={(e) => setNote({ ...note, complications: e.target.value })} placeholder="None" /></div>
          {!endo && <p className="small muted" style={{ margin: 0 }}>For an admitted patient this also records the surgery, so the post-op day count starts once a Consultant verifies the date.</p>}
          <div className="row"><button className="teal" disabled={!note.procedure_done.trim()} onClick={() => { onOutcome('done', undefined, note); setMode(''); }}>Save {endo ? 'report' : 'operation note'}</button>
            <button className="ghost" onClick={() => setMode('')}>Back</button></div>
        </div>
      )}
      {(mode === 'postponed' || mode === 'cancelled') && (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Reason ${mode === 'postponed' ? 'for postponing' : 'for cancelling'}`} autoFocus />
          <button className="danger" disabled={!reason.trim()} onClick={() => { onOutcome(mode, reason.trim()); setMode(''); setReason(''); }}>Confirm</button>
          <button className="ghost" onClick={() => setMode('')}>Back</button>
        </div>
      )}
      {['postponed', 'cancelled'].includes(mode) && c.booking_id && <div className="small muted">The patient goes back to the waiting list.</div>}
    </div>
  );
}

function AddFromWaiting({ list, onDone }: { list: OtList; onDone: () => void }) {
  const [rows, setRows] = useState<WaitRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('v_waiting_list').select('*').eq('unit_id', list.unit_id).eq('list_type', list.service).in('status', ['waiting', 'postponed'])
      .then(({ data, error }) => {
        if (error) setErr(friendlyError(error));
        setRows(((data as WaitRow[]) ?? []).sort((a, b) => Number(b.preop_ready) - Number(a.preop_ready) || Number(b.is_admitted) - Number(a.is_admitted)));
      });
  }, [list]);
  const add = async (bid: string) => {
    setErr('');
    const { error } = await supabase.rpc('add_booking_to_list', { p_list: list.id, p_booking: bid });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="spread"><h3 style={{ margin: 0 }}>Waiting for {serviceLabel(list.service)}</h3><button className="ghost" onClick={onDone}>Close</button></div>
      {err && <div className="msg err">{err}</div>}
      {rows && rows.length === 0 && <p className="muted small">Nobody is waiting. <Link href="/waiting/">Open waiting list</Link></p>}
      {rows?.map((r) => (
        <div key={r.id} className="spread small" style={{ borderBottom: '1px solid #edf0f4', padding: '6px 0', flexWrap: 'nowrap' }}>
          <span><b>{r.full_name}</b> · {r.planned_procedure}
            <div className="row" style={{ gap: 4, marginTop: 2 }}>
              <span className={`badge ${r.preop_ready ? 'ok' : 'warn'}`}>{r.preop_ready ? 'Pre-op ready' : 'Pre-op incomplete'}</span>
              {r.is_admitted ? <span className="badge teal">Admitted</span> : <span className="badge">OPD</span>}
              {r.priority !== 'routine' && <span className="badge bad">{r.priority}</span>}
            </div></span>
          <button className="teal" style={{ padding: '6px 12px' }} onClick={() => add(r.id)}>Add</button>
        </div>
      ))}
    </div>
  );
}

function ManualCase({ list, onDone }: { list: OtList; onDone: () => void }) {
  const [f, setF] = useState({ manual_name: '', manual_age_sex: '', manual_ip_op: '', diagnosis: '', procedure: '', anaesthesia: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr('');
    const { data: mx } = await supabase.from('ot_cases').select('seq').eq('list_id', list.id).order('seq', { ascending: false }).limit(1);
    const { error } = await supabase.from('ot_cases').insert({ list_id: list.id, seq: ((mx?.[0]?.seq as number) ?? 0) + 1,
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Add a case by hand</h3>
      <p className="small muted" style={{ margin: 0 }}>For a patient not yet in the app. Registering them first keeps their record linked.</p>
      <div className="field"><label className="req">Patient name</label><input value={f.manual_name} onChange={set('manual_name')} /></div>
      <div className="grid g2">
        <div className="field"><label>Age / sex</label><input value={f.manual_age_sex} onChange={set('manual_age_sex')} placeholder="45/M" /></div>
        <div className="field"><label>IP / OP no.</label><input value={f.manual_ip_op} onChange={set('manual_ip_op')} /></div>
      </div>
      <div className="field"><label>Diagnosis</label><input value={f.diagnosis} onChange={set('diagnosis')} /></div>
      <div className="grid g2">
        <div className="field"><label className="req">Procedure</label><input value={f.procedure} onChange={set('procedure')} /></div>
        <div className="field"><label>Anaesthesia</label><input value={f.anaesthesia} onChange={set('anaesthesia')} /></div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button disabled={!f.manual_name.trim() || !f.procedure.trim()} onClick={save}>Add case</button><button className="ghost" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

function listReport(l: OtList, cases: OtCase[], consultant?: string): Report {
  const active = cases.filter((c) => !['postponed', 'cancelled'].includes(c.status));
  const off = cases.filter((c) => ['postponed', 'cancelled'].includes(c.status));
  const row = (c: OtCase, i: number) => {
    const w = caseWho(c);
    return [String(i + 1), w.name, w.ageSex, w.id, c.diagnosis ?? '', `${c.procedure}${c.laterality && c.laterality !== 'na' ? ` (${LATERALITY[c.laterality]})` : ''}`,
      c.anaesthesia ?? '', c.serology ?? '', c.position ?? '', [c.surgeon, c.assistants].filter(Boolean).join(' / '), c.special_requirements ?? ''];
  };
  return {
    title: `${serviceLabel(l.service).toUpperCase()} LIST`,
    subtitle: `${fmtDate(l.list_date)} · ${SESSIONS[l.session]}${l.ot_room ? ` · ${l.ot_room}` : ''}${consultant ? ` · Consultant: ${consultant}` : ''}${l.anaesthetist ? ` · Anaesthetist: ${l.anaesthetist}` : ''}${l.status === 'draft' ? ' · DRAFT' : ''}`,
    sections: [
      { heading: `Cases · ${active.length}`, columns: ['No', 'Patient', 'Age/Sex', 'IP/OP', 'Diagnosis', 'Procedure', 'Anaesthesia', 'Serology', 'Position', 'Surgeon / Assistants', 'Remarks'], rows: active.map(row), note: l.notes ?? undefined },
      ...(off.length ? [{ heading: 'Postponed or cancelled', columns: ['Patient', 'Procedure', 'Status', 'Reason'], rows: off.map((c) => [caseWho(c).name, c.procedure, CASE_STATUS[c.status], c.status_reason ?? '']) }] : []),
    ],
  };
}
