'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel } from '@/lib/personnel';
import { fmtDateTime } from '@/lib/format';

export const WOUND: Record<string, string> = { healthy: 'Healthy', serous: 'Serous discharge', slough: 'Slough', infected: 'Infected', gaping: 'Gaping', other: 'Other' };
type Row = { id: string; done_at: string; site: string; wound_status: string; findings: string | null; dressing_used: string | null;
  done_by_person_id: string | null; supervised_by_person_id: string | null };

/** Dressing records for an admission. Interns can record supervised dressings. */
export function Dressings({ admissionId, active }: { admissionId: string; active: boolean }) {
  const s = useSession();
  const people = usePersonnel(s.unit?.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const mine = people.find((p) => p.user_id === s.session?.user.id);
  const [f, setF] = useState({ site: '', wound_status: 'healthy', findings: '', dressing_used: '', done_by: '', supervised_by: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const load = useCallback(async () => {
    const { data } = await supabase.from('dressing_records').select('*').eq('admission_id', admissionId).order('done_at', { ascending: false });
    setRows((data as Row[]) ?? []);
  }, [admissionId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mine && !f.done_by) setF((x) => ({ ...x, done_by: mine.id })); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string | null) => people.find((p) => p.id === id)?.full_name;

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const { error } = await supabase.from('dressing_records').insert({ admission_id: admissionId, site: f.site.trim(), wound_status: f.wound_status,
      findings: f.findings.trim() || null, dressing_used: f.dressing_used.trim() || null, done_by_person_id: f.done_by || null, supervised_by_person_id: f.supervised_by || null });
    if (error) setErr(friendlyError(error)); else { setOpen(false); setF({ ...f, findings: '', dressing_used: '' }); load(); }
  };

  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="spread"><h3 style={{ margin: 0 }}>Dressings</h3>
        {active && s.can('task.update') && !open && <button className="ghost" style={{ padding: '6px 12px' }} onClick={() => { setOpen(true); if (rows[0]) setF((x) => ({ ...x, site: x.site || rows[0].site })); }}>+ Record dressing</button>}</div>
      {open && (
        <form className="stack" onSubmit={save}>
          <div className="grid g2">
            <div className="field"><label className="req">Site</label><input required value={f.site} onChange={set('site')} placeholder="e.g. Midline wound, port sites" /></div>
            <div className="field"><label>Wound</label><select value={f.wound_status} onChange={set('wound_status')}>{Object.entries(WOUND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div className="field"><label>Findings</label><input value={f.findings} onChange={set('findings')} placeholder="e.g. Clean, edges apposed, no discharge" /></div>
          <div className="field"><label>Dressing used</label><input value={f.dressing_used} onChange={set('dressing_used')} placeholder="e.g. Povidone-iodine, dry gauze" /></div>
          <div className="grid g2">
            <div className="field"><label>Done by</label><select value={f.done_by} onChange={set('done_by')}><option value="">—</option>
              {people.filter((p) => ['pg', 'senior_resident', 'intern'].includes(p.category)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
            <div className="field"><label>Supervised by</label><select value={f.supervised_by} onChange={set('supervised_by')}><option value="">—</option>
              {people.filter((p) => p.category !== 'intern').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          </div>
          <div className="small muted">Add a wound photo under Photos.</div>
          {err && <div className="msg err">{err}</div>}
          <div className="row"><button>Save</button><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {rows.length === 0 && !open && <p className="muted small" style={{ margin: 0 }}>No dressings recorded.</p>}
      {rows.map((r) => (
        <div key={r.id} className="small" style={{ borderBottom: '1px solid #edf0f4', padding: '4px 0' }}>
          <div className="spread"><b>{fmtDateTime(r.done_at)} · {r.site}</b>
            <span className={`badge ${['infected', 'gaping'].includes(r.wound_status) ? 'bad' : r.wound_status === 'healthy' ? 'ok' : 'warn'}`}>{WOUND[r.wound_status]}</span></div>
          {r.findings && <div>{r.findings}</div>}
          <div className="muted">{[r.dressing_used, name(r.done_by_person_id) && `by ${name(r.done_by_person_id)}`, name(r.supervised_by_person_id) && `supervised by ${name(r.supervised_by_person_id)}`].filter(Boolean).join(' · ')}</div>
        </div>
      ))}
    </div>
  );
}
