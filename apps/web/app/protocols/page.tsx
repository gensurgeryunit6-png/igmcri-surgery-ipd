'use client';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { fmtDate } from '@/lib/format';

const CATS: Record<string, string> = { preop: 'Pre-operative', postop: 'Post-operative', antibiotics: 'Antibiotics', emergency: 'Emergencies',
  wound: 'Wound care', procedures: 'Procedures', ward: 'Ward routine', other: 'Other' };
type Protocol = { id: string; category: string; title: string; body: string; link: string | null; version: number; active: boolean; updated_at: string };

/** Unit protocols: the unit's agreed way of doing things, kept in one place. */
export default function ProtocolsPage() {
  const s = useSession();
  const can = s.can('protocol.manage');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Protocol | 'new' | null>(null);
  const live = useLive(async () => must(supabase.from('protocols').select('*').eq('unit_id', s.unit!.id).order('category').order('title')), ['protocols'], [s.unit?.id]);
  const all = ((live.data as Protocol[]) ?? []).filter((p) => p.active || can);
  const rows = all.filter((p) => (!cat || p.category === cat) && (!q.trim() || `${p.title} ${p.body}`.toLowerCase().includes(q.trim().toLowerCase())));
  const used = Object.keys(CATS).filter((k) => all.some((p) => p.category === k));

  return (
    <div className="stack">
      {can && !edit && <button className="teal" onClick={() => setEdit('new')}>+ Add protocol</button>}
      {edit && <Editor p={edit === 'new' ? null : edit} onDone={() => { setEdit(null); live.reload(); }} />}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search protocols" />
      {used.length > 1 && (
        <div className="tabs">
          <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>All</button>
          {used.map((k) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{CATS[k]}</button>)}
        </div>
      )}
      {live.error && <div className="msg err">{live.error}</div>}
      {live.data && rows.length === 0 && <p className="muted">{all.length ? 'No match.' : can ? 'No protocols yet. Add the unit’s first one.' : 'No protocols added yet.'}</p>}
      {rows.map((p) => (
        <div key={p.id} className="card stack" style={{ gap: 6, opacity: p.active ? 1 : 0.55 }}>
          <button className="ghost" style={{ textAlign: 'left', border: 0, padding: 0, background: 'none', color: 'inherit' }} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div className="spread"><b style={{ color: 'var(--navy)' }}>{p.title}</b><span className="badge">{CATS[p.category]}</span></div>
            <div className="small muted">Version {p.version} · updated {fmtDate(p.updated_at)}{p.active ? '' : ' · withdrawn'}</div>
          </button>
          {open === p.id && (
            <>
              <div style={{ whiteSpace: 'pre-wrap' }}>{p.body}</div>
              {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer">Open the full document →</a>}
              {can && <div className="row"><button className="ghost" onClick={() => setEdit(p)}>Edit</button>
                <button className="ghost" onClick={async () => { await supabase.from('protocols').update({ active: !p.active }).eq('id', p.id); live.reload(); }}>{p.active ? 'Withdraw' : 'Restore'}</button></div>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Editor({ p, onDone }: { p: Protocol | null; onDone: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ category: p?.category ?? 'postop', title: p?.title ?? '', body: p?.body ?? '', link: p?.link ?? '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const row = { category: f.category, title: f.title.trim(), body: f.body.trim(), link: f.link.trim() || null };
    if (row.link && !row.link.startsWith('https://')) { setErr('The link must start with https://'); return; }
    const { error } = p ? await supabase.from('protocols').update(row).eq('id', p.id) : await supabase.from('protocols').insert({ ...row, unit_id: s.unit!.id });
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>{p ? `Edit protocol (now version ${p.version})` : 'New protocol'}</h3>
      <div className="grid g2">
        <div className="field"><label>Category</label><select value={f.category} onChange={set('category')}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label className="req">Title</label><input required minLength={2} value={f.title} onChange={set('title')} /></div>
      </div>
      <div className="field"><label className="req">Protocol</label><textarea required value={f.body} onChange={set('body')} style={{ minHeight: 180 }} placeholder="Steps, doses and responsibilities, one per line" /></div>
      <div className="field"><label>Link to full document (optional)</label><input value={f.link} onChange={set('link')} placeholder="https://" inputMode="url" /></div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button>Save</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
