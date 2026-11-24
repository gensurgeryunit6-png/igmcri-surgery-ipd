'use client';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';

type W = { id: string; code: string; name: string; kind: string; sort_order: number; active: boolean };
type B = { id: string; ward_id: string; label: string; sort_order: number; active: boolean };
const KINDS = [['male', 'Male ward'], ['female', 'Female ward'], ['special', 'Special ward'], ['emergency', 'Emergency'], ['other', 'Other']];

/** Wards and beds for the unit. Beds are switched off, never deleted, because history refers to them. */
export default function SettingsPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const q = useLive(async () => {
    const [w, b, occ] = await Promise.all([
      must(supabase.from('wards').select('*').eq('unit_id', unitId!).order('sort_order')),
      must(supabase.from('ward_beds').select('*').eq('unit_id', unitId!).order('sort_order')),
      must(supabase.from('bed_assignments').select('bed_id').eq('unit_id', unitId!).is('to_at', null)),
    ]);
    return { wards: w as W[], beds: b as B[], occupied: new Set((occ as { bed_id: string }[]).map((x) => x.bed_id)) };
  }, ['wards', 'ward_beds', 'bed_assignments'], [unitId]);

  if (!s.can('settings.manage')) return <div className="msg err">Only administrators can change wards and beds.</div>;

  const run = async (p: PromiseLike<{ error: any }>, ok: string) => {
    const { error } = await p;
    setMsg(error ? { kind: 'err', text: friendlyError(error) } : { kind: 'ok', text: ok });
    q.reload();
  };

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Changes show up immediately on every phone and computer. A bed with a patient in it cannot be switched off.</p>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {q.error && <div className="msg err">{q.error}</div>}
      <ReportTime unitId={unitId!} run={run} />
      {(q.data?.wards ?? []).map((w) => (
        <WardCard key={w.id} w={w} beds={(q.data?.beds ?? []).filter((b) => b.ward_id === w.id)} occupied={q.data!.occupied} run={run} />
      ))}
      <AddWard unitId={unitId!} next={(q.data?.wards.length ?? 0) + 1} run={run} />
    </div>
  );
}

function WardCard({ w, beds, occupied, run }: { w: W; beds: B[]; occupied: Set<string>; run: (p: PromiseLike<{ error: any }>, ok: string) => void }) {
  const [name, setName] = useState(w.name);
  const [kind, setKind] = useState(w.kind);
  const [prefix, setPrefix] = useState(beds[0]?.label.replace(/\d+$/, '') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const active = beds.filter((b) => b.active);
  const nextNo = Math.max(0, ...beds.map((b) => Number(b.label.match(/(\d+)$/)?.[1] ?? 0))) + 1;

  const addBeds = () => {
    const a = Number(from || nextNo), z = Number(to || from || nextNo);
    if (!(a > 0) || z < a || z - a > 60) return run(Promise.resolve({ error: { message: 'Enter a bed number range of up to 60 beds.' } }), '');
    // unit_id is filled in by the database from the ward.
    const rows = Array.from({ length: z - a + 1 }, (_, i) => ({ ward_id: w.id, label: `${prefix}${a + i}`, sort_order: a + i }))
      .filter((r) => !beds.some((b) => b.label === r.label));
    if (!rows.length) return run(Promise.resolve({ error: { message: 'Those beds already exist.' } }), '');
    run(supabase.from('ward_beds').insert(rows), `${rows.length} bed${rows.length > 1 ? 's' : ''} added to ${w.name}.`);
    setFrom(''); setTo('');
  };

  return (
    <div className="card stack" style={{ opacity: w.active ? 1 : 0.6 }}>
      <div className="grid g2">
        <div className="field"><label>Ward name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Type (used for the census)</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div className="row">
        {(name !== w.name || kind !== w.kind) && <button onClick={() => run(supabase.from('wards').update({ name: name.trim(), kind }).eq('id', w.id), 'Ward updated.')}>Save ward</button>}
        <button className="ghost" onClick={() => confirm(`${w.active ? 'Switch off' : 'Switch on'} ${w.name}?`) && run(supabase.from('wards').update({ active: !w.active }).eq('id', w.id), w.active ? 'Ward switched off.' : 'Ward switched on.')}>
          {w.active ? 'Switch ward off' : 'Switch ward on'}</button>
        <span className="muted small">{active.length} active beds · {active.filter((b) => occupied.has(b.id)).length} occupied</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {beds.map((b) => (
          <button key={b.id} title={occupied.has(b.id) ? 'Occupied' : b.active ? 'Tap to switch off' : 'Tap to switch on'}
            className={b.active ? (occupied.has(b.id) ? '' : 'ghost') : 'ghost'}
            style={{ padding: '6px 10px', fontWeight: 600, textDecoration: b.active ? 'none' : 'line-through', opacity: b.active ? 1 : 0.5 }}
            onClick={() => confirm(`${b.active ? 'Switch off' : 'Switch on'} bed ${b.label}?`) && run(supabase.from('ward_beds').update({ active: !b.active }).eq('id', b.id), `Bed ${b.label} ${b.active ? 'switched off' : 'switched on'}.`)}>
            {b.label}</button>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Dark = occupied. Tap a bed to switch it off or on.</p>
      <div className="grid g4" style={{ alignItems: 'end' }}>
        <div className="field"><label>Bed prefix</label><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. M" /></div>
        <div className="field"><label>From no.</label><input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={String(nextNo)} /></div>
        <div className="field"><label>To no.</label><input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} placeholder={from || String(nextNo)} /></div>
        <button className="ghost" onClick={addBeds}>Add beds</button>
      </div>
    </div>
  );
}

function AddWard({ unitId, next, run }: { unitId: string; next: number; run: (p: PromiseLike<{ error: any }>, ok: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('other');
  if (!open) return <button className="ghost" onClick={() => setOpen(true)}>+ Add a ward</button>;
  return (
    <div className="card stack">
      <h3>New ward</h3>
      <div className="grid g3">
        <div className="field"><label className="req">Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Surgical ICU" /></div>
        <div className="field"><label className="req">Short code</label><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. SICU" /></div>
        <div className="field"><label>Type</label><select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div className="row">
        <button disabled={!name.trim() || !code.trim()} onClick={() => { run(supabase.from('wards').insert({ unit_id: unitId, name: name.trim(), code: code.trim(), kind, sort_order: next }), `${name} added. Now add its beds.`); setOpen(false); setName(''); setCode(''); }}>Add ward</button>
        <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function ReportTime({ unitId, run }: { unitId: string; run: (p: PromiseLike<{ error: any }>, ok: string) => void }) {
  const q = useLive(async () => must(supabase.from('unit_settings').select('morning_report_hour, morning_report_enabled').eq('unit_id', unitId).maybeSingle()) as Promise<{ morning_report_hour: number; morning_report_enabled: boolean } | null>, ['unit_settings'], [unitId]);
  const v = q.data;
  if (!v) return null;
  return (
    <div className="card stack">
      <h3>Morning ward report</h3>
      <p className="small muted" style={{ margin: 0 }}>Every day at this time the unit&apos;s ward data is saved, so the morning report can be printed later exactly as it was.</p>
      <div className="row">
        <select value={v.morning_report_hour} style={{ width: 'auto' }}
          onChange={(e) => run(supabase.from('unit_settings').update({ morning_report_hour: Number(e.target.value) }).eq('unit_id', unitId), 'Report time saved.')}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
        <label className="row small" style={{ gap: 6, margin: 0, color: 'var(--ink)' }}>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={v.morning_report_enabled}
            onChange={(e) => run(supabase.from('unit_settings').update({ morning_report_enabled: e.target.checked }).eq('unit_id', unitId), e.target.checked ? 'Automatic saving on.' : 'Automatic saving off.')} />
          Save automatically</label>
      </div>
    </div>
  );
}
