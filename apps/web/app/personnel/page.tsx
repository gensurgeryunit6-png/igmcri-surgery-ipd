'use client';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel, CATEGORIES, categoryLabel, type Person } from '@/lib/personnel';
import { useColleagues } from '@/lib/staff';

/** Unit personnel: the unit's people, used in consultant and PG dropdowns. */
export default function PersonnelPage() {
  const s = useSession();
  const people = usePersonnel(s.unit?.id, true);
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const canManage = s.can('personnel.manage');

  const groups = CATEGORIES.map((c) => ({ ...c, list: people.filter((p) => p.category === c.v) })).filter((g) => g.list.length);
  return (
    <div className="stack">
      {canManage && !edit && <button className="teal" onClick={() => setEdit('new')}>Add person</button>}
      {edit && <PersonForm person={edit === 'new' ? null : edit} onDone={() => { setEdit(null); people.reload(); }} />}
      {groups.length === 0 && <div className="card muted">No people added yet.</div>}
      {groups.map((g) => (
        <div key={g.v} className="card">
          <h3>{g.label}{g.list.length > 1 ? 's' : ''} · {g.list.filter((p) => p.active).length}</h3>
          {g.list.map((p) => (
            <div key={p.id} className="spread small" style={{ borderBottom: '1px solid #edf0f4', padding: '8px 0', opacity: p.active ? 1 : 0.5 }}>
              <span>
                <b>{p.full_name}</b>{p.pg_year ? ` · PG year ${p.pg_year}` : ''}{p.designation && p.designation !== categoryLabel(p.category) ? ` · ${p.designation}` : ''}
                {!p.active && ' · left the unit'}
                {p.phone && <div className="muted"><a href={`tel:${p.phone}`}>{p.phone}</a></div>}
                {p.responsibilities && <div className="muted">{p.responsibilities}</div>}
              </span>
              {canManage && <button className="ghost" style={{ padding: '5px 10px' }} onClick={() => setEdit(p)}>Edit</button>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PersonForm({ person, onDone }: { person: Person | null; onDone: () => void }) {
  const s = useSession();
  const logins = useColleagues(s.unit?.id);
  const [f, setF] = useState({
    full_name: person?.full_name ?? '', category: person?.category ?? 'pg', designation: person?.designation ?? '',
    pg_year: person?.pg_year?.toString() ?? '', phone: person?.phone ?? '', responsibilities: person?.responsibilities ?? '',
    user_id: person?.user_id ?? '', active: person?.active ?? true, sort_order: person?.sort_order?.toString() ?? '0',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const row = {
      full_name: f.full_name.trim(), category: f.category, designation: f.designation.trim() || categoryLabel(f.category),
      pg_year: f.category === 'pg' && f.pg_year ? Number(f.pg_year) : null, phone: f.phone.trim() || null,
      responsibilities: f.responsibilities.trim() || null, user_id: f.user_id || null, active: f.active, sort_order: Number(f.sort_order) || 0,
    };
    const { error } = person
      ? await supabase.from('unit_personnel').update(row).eq('id', person.id)
      : await supabase.from('unit_personnel').insert({ ...row, unit_id: s.unit!.id });
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onDone();
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h2>{person ? 'Edit person' : 'Add person'}</h2>
      <div className="field"><label className="req">Name</label><input required minLength={2} value={f.full_name} onChange={set('full_name')} placeholder="Dr. …" autoFocus /></div>
      <div className="grid g2">
        <div className="field"><label className="req">Category</label><select value={f.category} onChange={set('category')}>
          {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></div>
        {f.category === 'pg'
          ? <div className="field"><label>PG year</label><select value={f.pg_year} onChange={set('pg_year')}><option value="">—</option><option value="1">1st year</option><option value="2">2nd year</option><option value="3">3rd year</option></select></div>
          : <div className="field"><label>Designation</label><input value={f.designation} onChange={set('designation')} /></div>}
      </div>
      <div className="grid g2">
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="tel" /></div>
        <div className="field"><label>Linked app login (optional)</label><select value={f.user_id} onChange={set('user_id')}><option value="">None</option>
          {logins.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name}</option>)}</select></div>
      </div>
      <div className="field"><label>Responsibilities</label><input value={f.responsibilities} onChange={set('responsibilities')} placeholder="e.g. MSW beds 1–15, endoscopy" /></div>
      <div className="grid g2">
        <div className="field"><label>Order in lists</label><input type="number" value={f.sort_order} onChange={set('sort_order')} /></div>
        <div className="field"><label>Status</label><select value={f.active ? 'y' : 'n'} onChange={(e) => setF({ ...f, active: e.target.value === 'y' })}>
          <option value="y">Working in the unit</option><option value="n">Left the unit</option></select></div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div className="row"><button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
