'use client';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { fmtDateTime } from '@/lib/format';
import type { Inpatient } from '@/lib/data';
import { StatusBadge } from '@/components/ui';
import { STATUSES, ROUND_TYPES, TEXT_FIELDS, VITALS, effective, vitalsLine, statusLabel,
  type Entry, type Amendment, type TextField } from '@/lib/rounds';

type Task = { id: string; kind: string; description: string; created_at: string };

export default function RoundPage() { return <Suspense><RoundView /></Suspense>; }

function RoundView() {
  const params = useSearchParams();
  const admissionId = params.get('a') ?? '';
  const wardId = params.get('ward') ?? '';
  const router = useRouter();
  const s = useSession();

  const [pt, setPt] = useState<Inpatient | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [amends, setAmends] = useState<Amendment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nextId, setNextId] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    const p = await supabase.from('v_inpatients').select('*').eq('admission_id', admissionId).maybeSingle();
    if (p.error) { setErr(friendlyError(p.error)); return; }
    setPt(p.data as Inpatient);
    const e = await supabase.from('ward_round_entries')
      .select('*, author:staff!ward_round_entries_entered_by_fkey(full_name), verifier:staff!ward_round_entries_verified_by_fkey(full_name)')
      .eq('admission_id', admissionId).order('round_at', { ascending: false });
    const list = (e.data as Entry[]) ?? [];
    setEntries(list);
    const ids = list.map((x) => x.id);
    const a = ids.length ? await supabase.from('ward_round_amendments')
      .select('*, author:staff!ward_round_amendments_amended_by_fkey(full_name)').in('entry_id', ids) : { data: [] };
    setAmends((a.data as Amendment[]) ?? []);
    const t = await supabase.from('care_tasks').select('id, kind, description, created_at').eq('admission_id', admissionId).in('status', ['open', 'in_progress']).order('created_at');
    setTasks((t.data as Task[]) ?? []);
    // Next patient in the same ward who still needs today's round.
    if (p.data) {
      const ward = await supabase.from('v_inpatients').select('admission_id, bed_sort, rounds_today, ward_id').eq('unit_id', (p.data as Inpatient).unit_id)
        .order('ward_sort').order('bed_sort');
      const same = ((ward.data ?? []) as Inpatient[]).filter((x) => (wardId === 'all' ? true : wardId === 'none' ? !x.ward_id : x.ward_id === (wardId || (p.data as Inpatient).ward_id)));
      const idx = same.findIndex((x) => x.admission_id === admissionId);
      const after = [...same.slice(idx + 1), ...same.slice(0, Math.max(idx, 0))].find((x) => x.rounds_today === 0 && x.admission_id !== admissionId);
      setNextId(after?.admission_id ?? null);
    }
  }, [admissionId, wardId]);
  useEffect(() => { if (admissionId) { setSaved(''); setShowOlder(false); load(); } }, [admissionId, load]);

  if (err) return <div className="msg err">{err}</div>;
  if (!pt) return <p className="muted">Loading…</p>;

  const latest = entries[0];
  const older = entries.slice(1);

  return (
    <div className="stack">
      <div className="card" style={{ padding: 12 }}>
        <div className="spread">
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy)' }}>{pt.bed ?? 'No bed'} · {pt.full_name}</div>
            <div className="muted small">{pt.age_years}/{pt.sex} · IP {pt.ip_number} · {pt.diagnosis ?? 'No diagnosis yet'}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {pt.postop_day != null && <span className="badge teal">POD {pt.postop_day}</span>}
            <Link href={`/patient/?id=${pt.patient_id}`} className="small">Record</Link>
          </div>
        </div>
        {pt.allergies && <div className="msg err small" style={{ marginTop: 8, padding: '6px 10px' }}><b>Allergy:</b> {pt.allergies}</div>}
      </div>

      {saved && (
        <div className="msg ok spread">
          <span>{saved}</span>
          {nextId ? <Link className="btn teal" href={`/round/?a=${nextId}&ward=${wardId}`}>Next bed →</Link>
            : <Link className="btn ghost" href="/rounds/">Back to ward</Link>}
        </div>
      )}

      {latest && <EntryCard e={latest} amends={amends} onChange={load} title="Last note" />}
      {older.length > 0 && (
        showOlder ? older.map((e) => <EntryCard key={e.id} e={e} amends={amends} onChange={load} />)
          : <button className="ghost" onClick={() => setShowOlder(true)}>Show {older.length} earlier note{older.length > 1 ? 's' : ''}</button>
      )}
      {!latest && <p className="muted small">No ward-round notes yet for this admission.</p>}

      {s.can('round.write') && (
        <NewEntry admissionId={admissionId} tasks={tasks} lastVitals={latest ? effective(latest, amends).vitals : {}}
          onSaved={(goNext) => {
            if (goNext && nextId) router.push(`/round/?a=${nextId}&ward=${wardId}`);
            else { setSaved(nextId ? 'Round saved.' : 'Round saved. Every patient here now has a round today.'); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
          }} hasNext={!!nextId} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one saved entry
function EntryCard({ e, amends, onChange, title }: { e: Entry; amends: Amendment[]; onChange: () => void; title?: string }) {
  const s = useSession();
  const v = effective(e, amends);
  const mine = amends.filter((a) => a.entry_id === e.id).sort((a, b) => a.amended_at.localeCompare(b.amended_at));
  const [amending, setAmending] = useState(false);
  const [err, setErr] = useState('');

  const verify = async () => {
    const { error } = await supabase.rpc('verify_ward_round', { p_entry_id: e.id });
    if (error) setErr(friendlyError(error)); else onChange();
  };

  return (
    <div className="card stack" style={{ gap: 8, padding: 12 }}>
      <div className="spread">
        <span className="small"><b>{title ? `${title} · ` : ''}{fmtDateTime(e.round_at)}</b> · {ROUND_TYPES.find((r) => r.v === e.round_type)?.label}
          {e.postop_day != null && ` · POD ${e.postop_day}`}</span>
        <StatusBadge s={v.clinical_status} />
      </div>
      {vitalsLine(v.vitals) && <div className="small">{vitalsLine(v.vitals)}</div>}
      {TEXT_FIELDS.filter((f) => v[f.k]).map((f) => (
        <div key={f.k} className="small">
          <span className="muted">{f.label}:</span> {v[f.k]}
          {v.amendedFields.includes(f.k) && <span className="badge warn" style={{ marginLeft: 6 }}>Amended</span>}
        </div>
      ))}
      {mine.length > 0 && (
        <details className="small">
          <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>{mine.length} amendment{mine.length > 1 ? 's' : ''} · original kept</summary>
          {mine.map((a) => (
            <div key={a.id} style={{ borderLeft: '2px solid var(--line)', paddingLeft: 8, marginTop: 6 }}>
              <b>{TEXT_FIELDS.find((f) => f.k === a.field)?.label ?? 'Clinical status'}</b> · {fmtDateTime(a.amended_at)} · {a.author?.full_name}<br />
              <span className="muted">Was:</span> {a.field === 'clinical_status' ? statusLabel(a.old_value ?? '') : (a.old_value || '—')}<br />
              <span className="muted">Now:</span> {a.field === 'clinical_status' ? statusLabel(a.new_value ?? '') : a.new_value}<br />
              <span className="muted">Reason:</span> {a.reason}
            </div>
          ))}
        </details>
      )}
      <div className="spread small">
        <span className="muted">By {e.author?.full_name ?? '—'}{e.verified_at ? ` · verified by ${e.verifier?.full_name ?? '—'}` : ''}</span>
        <span className="row" style={{ gap: 6 }}>
          {s.can('round.amend') && !amending && <button className="ghost" style={{ padding: '5px 10px' }} onClick={() => setAmending(true)}>Amend</button>}
          {e.verified_at ? <span className="badge ok">Verified</span>
            : s.can('round.verify') ? <button className="teal" style={{ padding: '5px 12px' }} onClick={verify}>Verify</button>
            : <span className="badge">Not verified</span>}
        </span>
      </div>
      {amending && <AmendForm e={v} onDone={() => { setAmending(false); onChange(); }} />}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}

function AmendForm({ e, onDone }: { e: Entry; onDone: () => void }) {
  const [field, setField] = useState<string>('plan');
  const current = field === 'clinical_status' ? e.clinical_status : (e[field as TextField] ?? '');
  const [value, setValue] = useState(current);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setValue(field === 'clinical_status' ? e.clinical_status : (e[field as TextField] ?? '')); }, [field, e]);

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const { error } = await supabase.from('ward_round_amendments').insert({ entry_id: e.id, field, new_value: value, reason: reason.trim() });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="stack" onSubmit={save} style={{ background: '#fafbfc', border: '1px solid var(--line)', borderRadius: 8, padding: 10, gap: 8 }}>
      <div className="small muted">The original note is kept. Your correction, name, time and reason are added on top.</div>
      <select value={field} onChange={(x) => setField(x.target.value)}>
        <option value="clinical_status">Clinical status</option>
        {TEXT_FIELDS.map((f) => <option key={f.k} value={f.k}>{f.label}</option>)}
      </select>
      {field === 'clinical_status'
        ? <select value={value} onChange={(x) => setValue(x.target.value)}>{STATUSES.map((st) => <option key={st.v} value={st.v}>{st.label}</option>)}</select>
        : <textarea value={value} onChange={(x) => setValue(x.target.value)} required />}
      <input required minLength={3} value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Reason for the correction" />
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Save amendment</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

// ---------------------------------------------------------------- new entry
function NewEntry({ admissionId, tasks, lastVitals, onSaved, hasNext }: {
  admissionId: string; tasks: Task[]; lastVitals: Record<string, string>; onSaved: (goNext: boolean) => void; hasNext: boolean;
}) {
  const hourIST = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const [roundType, setRoundType] = useState(hourIST < 14 ? 'morning' : hourIST < 21 ? 'evening' : 'night');
  const [status, setStatus] = useState('');
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [text, setText] = useState<Partial<Record<TextField, string>>>({});
  const [more, setMore] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [newTasks, setNewTasks] = useState<{ kind: string; description: string }[]>([]);
  const [taskText, setTaskText] = useState('');
  const [taskKind, setTaskKind] = useState('task');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { setStatus(''); setVitals({}); setText({}); setDone([]); setNewTasks([]); setMore(false); setErr(''); }, [admissionId]);

  const save = async (goNext: boolean) => {
    if (!status) { setErr('Choose the clinical status.'); return; }
    setBusy(true); setErr('');
    const v = Object.fromEntries(Object.entries(vitals).filter(([, x]) => x.trim() !== ''));
    const entry: Record<string, unknown> = { admission_id: admissionId, round_type: roundType, clinical_status: status, vitals: v };
    TEXT_FIELDS.forEach((f) => { const x = text[f.k]?.trim(); if (x) entry[f.k] = x; });
    const pendingNew = taskText.trim() ? [...newTasks, { kind: taskKind, description: taskText.trim() }] : newTasks;
    const { error } = await supabase.rpc('add_ward_round', { p_entry: entry, p_new_tasks: pendingNew, p_closed_task_ids: done });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setStatus(''); setVitals({}); setText({}); setDone([]); setNewTasks([]); setTaskText('');
    onSaved(goNext);
  };

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); save(false); }} style={{ gap: 12 }}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>New round note</h2>
        <select value={roundType} onChange={(e) => setRoundType(e.target.value)} style={{ width: 'auto', padding: '6px 10px' }} aria-label="Round type">
          {ROUND_TYPES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
        </select>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ marginBottom: 6 }}>Clinical status <span style={{ color: 'var(--bad)' }}>*</span></legend>
        <div className="row" style={{ gap: 6 }}>
          {STATUSES.map((st) => (
            <button type="button" key={st.v} onClick={() => setStatus(st.v)}
              className={status === st.v ? '' : 'ghost'} aria-pressed={status === st.v}
              style={{ padding: '8px 12px', fontWeight: 600, ...(status === st.v && (st.v === 'critical' || st.v === 'worsening') ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : {}) }}>
              {st.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid g3">
        {VITALS.map((x) => (
          <label key={x.k} className="small" style={{ margin: 0 }}>{x.label}
            <input inputMode={x.mode as 'numeric'} value={vitals[x.k] ?? ''} placeholder={lastVitals?.[x.k] ?? ''}
              onChange={(e) => setVitals({ ...vitals, [x.k]: e.target.value })} style={{ marginTop: 3 }} />
          </label>
        ))}
      </div>
      <p className="muted small" style={{ margin: '-4px 0 0' }}>Grey numbers are the last recorded values.</p>

      {TEXT_FIELDS.filter((f) => f.main || more).map((f) => (
        <label key={f.k} className="small" style={{ margin: 0 }}>{f.label}
          <textarea value={text[f.k] ?? ''} onChange={(e) => setText({ ...text, [f.k]: e.target.value })} style={{ marginTop: 3, minHeight: f.main ? 70 : 54 }} />
        </label>
      ))}
      {!more && <button type="button" className="ghost" onClick={() => setMore(true)}>More fields: examination, investigations, treatment, assessment, consultant instructions, discharge plan</button>}
      <button type="button" className="ghost" onClick={() => { setMore(true); setText((t) => ({
        ...t,
        complaints: t.complaints || 'Pain: \nNausea / vomiting: \nFlatus / stools: \nOral intake: ',
        systemic_exam: t.systemic_exam || 'Wound: \nDrain: ___ ml, character: \nAbdomen: soft / distended; bowel sounds: \nCalves: ',
        plan: t.plan || 'Diet: \nDrain: \nCatheter: \nMobilisation: \nAntibiotics: day ' })); }}>Use post-op note template</button>

      <div className="stack" style={{ gap: 6, background: '#fafbfc', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
        <div className="small muted" style={{ fontWeight: 600 }}>Pending tasks and investigations</div>
        {tasks.length === 0 && newTasks.length === 0 && <div className="small muted">None carried forward.</div>}
        {tasks.map((t) => (
          <label key={t.id} className="row small" style={{ gap: 8, margin: 0, color: 'var(--ink)', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={done.includes(t.id)} style={{ width: 20, height: 20, flexShrink: 0 }}
              onChange={(e) => setDone(e.target.checked ? [...done, t.id] : done.filter((x) => x !== t.id))} />
            <span style={{ textDecoration: done.includes(t.id) ? 'line-through' : 'none' }}>
              {t.kind === 'investigation' && <span className="badge" style={{ marginRight: 4 }}>Inv</span>}{t.description}
            </span>
          </label>
        ))}
        {newTasks.map((t, i) => (
          <div key={i} className="spread small"><span><span className="badge teal" style={{ marginRight: 4 }}>New</span>{t.description}</span>
            <a href="#" onClick={(e) => { e.preventDefault(); setNewTasks(newTasks.filter((_, j) => j !== i)); }}>Remove</a></div>
        ))}
        <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
          <select value={taskKind} onChange={(e) => setTaskKind(e.target.value)} style={{ width: 110 }} aria-label="Task type">
            <option value="task">Task</option><option value="investigation">Investigation</option></select>
          <input value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="Add a task to carry forward"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (taskText.trim()) { setNewTasks([...newTasks, { kind: taskKind, description: taskText.trim() }]); setTaskText(''); } } }} />
          <button type="button" className="ghost" onClick={() => { if (taskText.trim()) { setNewTasks([...newTasks, { kind: taskKind, description: taskText.trim() }]); setTaskText(''); } }}>Add</button>
        </div>
      </div>

      {err && <div className="msg err">{err}</div>}
      <div className="grid g2">
        <button disabled={busy} className="ghost">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} className="teal" onClick={() => save(hasNext)}>{hasNext ? 'Save · next bed' : 'Save · ward done'}</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Saved notes cannot be edited or deleted. Corrections are added as amendments with a reason.</p>
    </form>
  );
}
