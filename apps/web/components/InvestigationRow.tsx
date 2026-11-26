'use client';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { fmtDateTime } from '@/lib/format';
import type { Person } from '@/lib/personnel';

export type Inv = { id: string; admission_id: string; name: string; status: string; result: string | null; ordered_at: string;
  resulted_at: string | null; abnormal: boolean | null; assigned_person_id: string | null; collected_at: string | null; reviewed_at: string | null };

/** One investigation with its steps: ordered → collected → result → reviewed. */
export function InvestigationRow({ r, people, onChange, extra }: { r: Inv; people: Person[]; onChange: () => void; extra?: React.ReactNode }) {
  const s = useSession();
  const [res, setRes] = useState('');
  const [abn, setAbn] = useState(false);
  const [err, setErr] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [hist, setHist] = useState<{ id: string; value: string; abnormal: boolean; resulted_at: string }[] | null>(null);
  const showHistory = async () => {
    if (hist) { setHist(null); return; }
    const { data } = await supabase.from('investigation_results').select('id, value, abnormal, resulted_at').eq('investigation_id', r.id).order('resulted_at', { ascending: false });
    setHist(data ?? []);
  };
  const addResult = async () => done((await supabase.from('investigation_results').insert({ investigation_id: r.id, value: res.trim(), abnormal: abn })).error);
  const done = (error: unknown) => { if (error) setErr(friendlyError(error)); else { setErr(''); onChange(); } };
  const who = people.find((p) => p.id === r.assigned_person_id)?.full_name;
  const write = s.can('ipd.write');
  return (
    <div className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '6px 0' }}>
      <div className="spread">
        <span><b>{r.name}</b>{extra}</span>
        {r.status === 'pending' ? <span className="badge warn">{r.collected_at ? 'Collected, result due' : 'Pending'}</span>
          : r.status === 'cancelled' ? <span className="badge">Cancelled</span>
          : <span className={`badge ${r.abnormal ? 'bad' : 'ok'}`}>{r.abnormal ? 'Abnormal' : 'Resulted'}{r.reviewed_at ? ' · reviewed' : ''}</span>}
      </div>
      <div className="muted">Ordered {fmtDateTime(r.ordered_at)}{who ? ` · ${who}` : ''}{r.collected_at ? ` · collected ${fmtDateTime(r.collected_at)}` : ''}</div>
      {r.result && <div>{r.result} <span className="muted">· {fmtDateTime(r.resulted_at)}</span></div>}
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        {r.status === 'pending' && !r.collected_at && s.can('task.update') &&
          <button className="ghost" style={{ padding: '4px 10px' }} onClick={async () => done((await supabase.rpc('mark_investigation_collected', { p_id: r.id })).error)}>Mark collected</button>}
        {r.status === 'pending' && write && (
          <select value={r.assigned_person_id ?? ''} style={{ width: 'auto', padding: '4px 8px' }}
            onChange={async (e) => done((await supabase.from('investigations').update({ assigned_person_id: e.target.value || null }).eq('id', r.id)).error)}>
            <option value="">Assign…</option>
            {people.filter((p) => ['pg', 'senior_resident', 'intern'].includes(p.category)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>)}
        {r.status === 'resulted' && write && !repeat &&
          <button className="ghost" style={{ padding: '4px 10px' }} onClick={() => setRepeat(true)}>Add repeat result</button>}
        {r.status === 'resulted' &&
          <button className="ghost" style={{ padding: '4px 10px' }} onClick={showHistory}>{hist ? 'Hide' : 'All results'}</button>}
        {r.status === 'resulted' && !r.reviewed_at && write &&
          <button className="ghost" style={{ padding: '4px 10px' }} onClick={async () => done((await supabase.from('investigations').update({ reviewed_at: new Date().toISOString(), reviewed_by: s.session!.user.id }).eq('id', r.id)).error)}>Mark reviewed</button>}
      </div>
      {hist && (
        <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
          {hist.map((h) => <div key={h.id}>{fmtDateTime(h.resulted_at)} · <b style={{ color: h.abnormal ? 'var(--bad)' : undefined }}>{h.value}</b></div>)}
        </div>
      )}
      {(r.status === 'pending' || repeat) && write && (
        <form className="row" style={{ marginTop: 4, flexWrap: 'nowrap', gap: 6 }} onSubmit={async (e) => { e.preventDefault(); await addResult(); setRes(''); setAbn(false); setRepeat(false); setHist(null); }}>
          <input required placeholder="Result" value={res} onChange={(e) => setRes(e.target.value)} style={{ padding: '6px 8px' }} />
          <label className="small" style={{ margin: 0, whiteSpace: 'nowrap' }}><input type="checkbox" checked={abn} onChange={(e) => setAbn(e.target.checked)} style={{ width: 'auto' }} /> Abnormal</label>
          <button className="ghost" style={{ padding: '6px 10px' }}>Save</button>
        </form>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}
