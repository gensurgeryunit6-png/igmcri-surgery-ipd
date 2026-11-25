'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must, type Inpatient } from '@/lib/data';
import { usePersonnel } from '@/lib/personnel';
import { fmtDate } from '@/lib/format';
import { TASK_KIND, TASK_STATUS, todayIst } from '@/lib/workflow';
import { InvestigationRow, type Inv } from '@/components/InvestigationRow';

type Task = { id: string; admission_id: string | null; kind: string; description: string; status: string; created_at: string;
  assigned_person_id: string | null; due_on: string | null; closed_at: string | null };

const VIEWS = [{ k: 'mine', label: 'My tasks' }, { k: 'open', label: 'All pending' }, { k: 'verify', label: 'To verify' },
  { k: 'tests', label: 'Investigations' }] as const;

/** Tasks for PGs and interns, with faculty verification; and pending investigations across the unit. */
export default function TasksPage() { return <Suspense><Tasks /></Suspense>; }

function Tasks() {
  const s = useSession();
  const unitId = s.unit?.id;
  const people = usePersonnel(s.unit?.id);
  const me = people.filter((p) => p.user_id === s.session?.user.id).map((p) => p.id);
  const [view, setView] = useState<(typeof VIEWS)[number]['k']>((useSearchParams().get('v') as 'mine') ?? 'mine');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const today = todayIst();

  const live = useLive(async () => {
    const [t, pts, inv] = await Promise.all([
      must(supabase.from('care_tasks').select('id, admission_id, kind, description, status, created_at, assigned_person_id, due_on, closed_at')
        .eq('unit_id', unitId!).in('status', ['open', 'in_progress', 'done']).order('created_at')),
      must(supabase.from('v_inpatients').select('admission_id, full_name, bed, ward, ip_number, patient_id').eq('unit_id', unitId!).order('ward_sort').order('bed_sort')),
      must(supabase.from('investigations').select('id, admission_id, name, status, result, ordered_at, resulted_at, abnormal, assigned_person_id, collected_at, reviewed_at')
        .eq('unit_id', unitId!).or('status.eq.pending,and(status.eq.resulted,reviewed_at.is.null)').order('ordered_at')),
    ]);
    return { tasks: t as Task[], pts: pts as Pick<Inpatient, 'admission_id' | 'full_name' | 'bed' | 'ward' | 'ip_number' | 'patient_id'>[], inv: inv as Inv[] };
  }, ['care_tasks', 'investigations', 'admissions'], [unitId]);

  const pt = (aid: string | null) => live.data?.pts.find((p) => p.admission_id === aid);
  const tasks = (live.data?.tasks ?? []).filter((t) =>
    view === 'mine' ? me.includes(t.assigned_person_id ?? '') && t.status !== 'done'
    : view === 'open' ? ['open', 'in_progress'].includes(t.status)
    : view === 'verify' ? t.status === 'done' : false);
  const counts = {
    mine: (live.data?.tasks ?? []).filter((t) => me.includes(t.assigned_person_id ?? '') && t.status !== 'done').length,
    open: (live.data?.tasks ?? []).filter((t) => ['open', 'in_progress'].includes(t.status)).length,
    verify: (live.data?.tasks ?? []).filter((t) => t.status === 'done').length,
    tests: live.data?.inv.length ?? 0,
  };

  const setStatus = async (id: string, st: string) => {
    setErr('');
    const { error } = await supabase.rpc('set_task_status', { p_task: id, p_status: st });
    if (error) setErr(friendlyError(error)); else live.reload();
  };

  return (
    <div className="stack">
      <div className="tabs">{VIEWS.filter((v) => v.k !== 'verify' || s.can('task.verify')).map((v) =>
        <button key={v.k} className={view === v.k ? 'on' : ''} onClick={() => setView(v.k)}>{v.label} · {counts[v.k]}</button>)}</div>
      {view !== 'tests' && s.can('round.write') && !adding && <button className="teal" onClick={() => setAdding(true)}>+ New task</button>}
      {adding && <NewTask pts={live.data?.pts ?? []} onDone={() => { setAdding(false); live.reload(); }} />}
      {err && <div className="msg err">{err}</div>}
      {live.error && <div className="msg err">{live.error}</div>}
      {view === 'mine' && me.length === 0 && <div className="msg info small">Your login is not linked to a name in Unit personnel, so no tasks are assigned to you yet.</div>}

      {view !== 'tests' && (
        <div className="mobile-list">
          {live.data && tasks.length === 0 && <p className="muted">Nothing here.</p>}
          {tasks.map((t) => {
            const p = pt(t.admission_id);
            const mine = me.includes(t.assigned_person_id ?? '');
            const canMove = s.can('round.write') || (mine && s.can('task.update'));
            return (
              <div key={t.id} className="mcard stack" style={{ gap: 4 }}>
                <div className="spread"><b>{t.description}</b>
                  <span className={`badge ${t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'teal' : 'warn'}`}>{TASK_STATUS[t.status]}</span></div>
                <div className="small muted">{TASK_KIND[t.kind] ?? t.kind}{p ? <> · <Link href={`/patient/?id=${p.patient_id}`}>{p.bed ?? 'No bed'} {p.full_name}</Link></> : ''}
                  {t.assigned_person_id ? ` · ${people.find((x) => x.id === t.assigned_person_id)?.full_name ?? ''}` : ' · Unassigned'}
                  {t.due_on ? ` · due ${fmtDate(t.due_on)}` : ''}{t.due_on && t.due_on < today && t.status !== 'done' ? ' (overdue)' : ''}</div>
                <div className="row" style={{ gap: 6 }}>
                  {canMove && t.status === 'open' && <button className="ghost" style={{ padding: '5px 10px' }} onClick={() => setStatus(t.id, 'in_progress')}>Start</button>}
                  {canMove && ['open', 'in_progress'].includes(t.status) && <button className="teal" style={{ padding: '5px 10px' }} onClick={() => setStatus(t.id, 'done')}>Completed</button>}
                  {s.can('task.verify') && t.status === 'done' && <button className="teal" style={{ padding: '5px 10px' }} onClick={() => setStatus(t.id, 'verified')}>Verify</button>}
                  {canMove && t.status === 'done' && <button className="ghost" style={{ padding: '5px 10px' }} onClick={() => setStatus(t.id, 'open')}>Reopen</button>}
                  {s.can('round.write') && ['open', 'in_progress'].includes(t.status) && <button className="ghost" style={{ padding: '5px 10px' }} onClick={() => setStatus(t.id, 'cancelled')}>Drop</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'tests' && (
        <div className="card stack" style={{ gap: 0 }}>
          <p className="small muted" style={{ margin: '0 0 6px' }}>Pending results and results not yet reviewed, for every inpatient.</p>
          {live.data?.inv.length === 0 && <p className="muted small">No pending investigations.</p>}
          {live.data?.inv.map((r) => {
            const p = pt(r.admission_id);
            return <InvestigationRow key={r.id} r={r} people={people} onChange={live.reload}
              extra={p ? <> · <Link href={`/patient/?id=${p.patient_id}`}>{p.bed ?? 'No bed'} {p.full_name}</Link></> : null} />;
          })}
        </div>
      )}
    </div>
  );
}

function NewTask({ pts, onDone }: { pts: Pick<Inpatient, 'admission_id' | 'full_name' | 'bed'>[]; onDone: () => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id).filter((p) => ['pg', 'senior_resident', 'intern'].includes(p.category));
  const [f, setF] = useState({ description: '', kind: 'task', admission_id: '', assigned_person_id: '', due_on: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.from('care_tasks').insert({ unit_id: s.unit!.id, description: f.description.trim(), kind: f.kind,
      admission_id: f.admission_id || null, assigned_person_id: f.assigned_person_id || null, due_on: f.due_on || null });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <div className="field"><label className="req">Task</label><input required value={f.description} onChange={set('description')} placeholder="e.g. Collect CECT report" autoFocus /></div>
      <div className="grid g2">
        <div className="field"><label>Type</label><select value={f.kind} onChange={set('kind')}>{Object.entries(TASK_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Assign to</label><select value={f.assigned_person_id} onChange={set('assigned_person_id')}><option value="">—</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.category === 'intern' ? ' (Intern)' : ''}</option>)}</select></div>
        <div className="field"><label>Patient</label><select value={f.admission_id} onChange={set('admission_id')}><option value="">Not for one patient</option>
          {pts.map((p) => <option key={p.admission_id} value={p.admission_id}>{p.bed ?? 'No bed'} · {p.full_name}</option>)}</select></div>
        <div className="field"><label>Due</label><input type="date" value={f.due_on} onChange={set('due_on')} /></div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Add task</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
