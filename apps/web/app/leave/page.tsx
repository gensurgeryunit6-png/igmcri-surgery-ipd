'use client';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { usePersonnel } from '@/lib/personnel';
import { fmtDate } from '@/lib/format';
import { todayIst } from '@/lib/workflow';

const KINDS: Record<string, string> = { casual: 'Casual', earned: 'Earned', medical: 'Medical', academic: 'Academic / conference',
  duty_leave: 'Duty leave', maternity: 'Maternity', other: 'Other' };
type Leave = { id: string; user_id: string; kind: string; from_date: string; to_date: string; reason: string | null; cover_person_id: string | null;
  status: string; decision_note: string | null; created_at: string; who: { full_name: string } | null; decider: { full_name: string } | null };
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const range = (l: Leave) => `${fmtDate(l.from_date)}${l.to_date !== l.from_date ? ` – ${fmtDate(l.to_date)}` : ''} · ${days(l.from_date, l.to_date)} day${days(l.from_date, l.to_date) > 1 ? 's' : ''}`;

/** Apply for leave; approvers decide; everyone sees who is away. */
export default function LeavePage() {
  const s = useSession();
  const me = s.session?.user.id;
  const people = usePersonnel(s.unit?.id);
  const today = todayIst();
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState('');
  const live = useLive(async () => must(supabase.from('leave_requests').select('*, who:staff!leave_requests_user_id_fkey(full_name), decider:staff!leave_requests_decided_by_fkey(full_name)')
    .eq('unit_id', s.unit!.id).gte('to_date', new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).order('from_date')), ['leave_requests'], [s.unit?.id]);
  const rows = (live.data as unknown as Leave[]) ?? [];
  const pending = rows.filter((l) => l.status === 'pending' && l.user_id !== me);
  const mine = rows.filter((l) => l.user_id === me).reverse();
  const away = rows.filter((l) => l.status === 'approved' && l.to_date >= today && l.from_date <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const cover = (id: string | null) => people.find((p) => p.id === id)?.full_name;

  const act = async (id: string, patch: Record<string, unknown>) => {
    setErr('');
    const { error } = await supabase.from('leave_requests').update(patch).eq('id', id);
    if (error) setErr(friendlyError(error)); else live.reload();
  };

  return (
    <div className="stack">
      {s.can('leave.apply') && !applying && <button className="teal" onClick={() => setApplying(true)}>+ Apply for leave</button>}
      {applying && <Apply onDone={() => { setApplying(false); live.reload(); }} />}
      {err && <div className="msg err">{err}</div>}
      {live.error && <div className="msg err">{live.error}</div>}

      {s.can('leave.approve') && pending.length > 0 && (
        <div className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>To approve · {pending.length}</h3>
          {pending.map((l) => <Decide key={l.id} l={l} cover={cover(l.cover_person_id)} onAct={act} />)}
        </div>
      )}

      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Away now and in the next 30 days</h3>
        {away.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nobody.</p>}
        {away.map((l) => (
          <div key={l.id} className="small spread" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
            <span><b>{l.who?.full_name}</b> · {KINDS[l.kind]}{cover(l.cover_person_id) ? ` · cover: ${cover(l.cover_person_id)}` : ''}</span>
            <span className={`badge ${l.from_date <= today ? 'warn' : ''}`}>{l.from_date <= today ? 'Away now' : range(l)}</span>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>My leave</h3>
        {mine.length === 0 && <p className="muted small" style={{ margin: 0 }}>No requests.</p>}
        {mine.map((l) => (
          <div key={l.id} className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
            <div className="spread"><b>{KINDS[l.kind]} · {range(l)}</b>
              <span className={`badge ${l.status === 'approved' ? 'ok' : l.status === 'pending' ? 'warn' : l.status === 'rejected' ? 'bad' : ''}`}>{l.status[0].toUpperCase() + l.status.slice(1)}</span></div>
            {l.reason && <div className="muted">{l.reason}</div>}
            {l.decision_note && <div className="muted">{l.decider?.full_name}: {l.decision_note}</div>}
            {(l.status === 'pending' || (l.status === 'approved' && l.from_date > today)) &&
              <button className="ghost" style={{ padding: '4px 10px', marginTop: 4 }} onClick={() => act(l.id, { status: 'cancelled' })}>Cancel request</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Apply({ onDone }: { onDone: () => void }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id).filter((p) => p.user_id !== s.session?.user.id);
  const [f, setF] = useState({ kind: 'casual', from_date: todayIst(), to_date: todayIst(), reason: '', cover: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.to_date < f.from_date) { setErr('The last day is before the first day.'); return; }
    const { error } = await supabase.from('leave_requests').insert({ unit_id: s.unit!.id, kind: f.kind, from_date: f.from_date, to_date: f.to_date,
      reason: f.reason.trim() || null, cover_person_id: f.cover || null });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Apply for leave</h3>
      <div className="field"><label>Type</label><select value={f.kind} onChange={set('kind')}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="grid g2">
        <div className="field"><label className="req">From</label><input type="date" required value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: f.to_date < e.target.value ? e.target.value : f.to_date })} /></div>
        <div className="field"><label className="req">To</label><input type="date" required min={f.from_date} value={f.to_date} onChange={set('to_date')} /></div>
      </div>
      <div className="field"><label>Reason</label><input value={f.reason} onChange={set('reason')} /></div>
      <div className="field"><label>Who covers your work</label><select value={f.cover} onChange={set('cover')}><option value="">—</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Send request</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function Decide({ l, cover, onAct }: { l: Leave; cover?: string; onAct: (id: string, patch: Record<string, unknown>) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="small stack" style={{ gap: 4, borderBottom: '1px solid #edf0f4', paddingBottom: 8 }}>
      <div><b>{l.who?.full_name}</b> · {KINDS[l.kind]} · {range(l)}</div>
      {l.reason && <div className="muted">{l.reason}</div>}
      <div className="muted">Cover: {cover ?? 'not named'}</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <div className="row" style={{ gap: 6 }}>
        <button className="teal" style={{ padding: '6px 12px' }} onClick={() => onAct(l.id, { status: 'approved', decision_note: note.trim() || null })}>Approve</button>
        <button className="danger" style={{ padding: '6px 12px' }} onClick={() => onAct(l.id, { status: 'rejected', decision_note: note.trim() || null })}>Reject</button>
      </div>
    </div>
  );
}
