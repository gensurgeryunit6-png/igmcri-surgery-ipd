'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Bed, Ward } from '@/lib/data';

/** Ward + free-bed selector. Occupied beds are shown but disabled. */
export function BedPicker({ unitId, value, onChange, required }: {
  unitId: string; value: string; onChange: (bedId: string) => void; required?: boolean;
}) {
  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [ward, setWard] = useState('');

  useEffect(() => {
    (async () => {
      const [w, b, occ] = await Promise.all([
        supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId).eq('active', true).order('sort_order'),
        supabase.from('ward_beds').select('id, ward_id, label, sort_order, active').eq('unit_id', unitId).eq('active', true).order('sort_order'),
        supabase.from('bed_assignments').select('bed_id').eq('unit_id', unitId).is('to_at', null),
      ]);
      setWards((w.data as Ward[]) ?? []);
      setBeds((b.data as Bed[]) ?? []);
      setBusy(new Set((occ.data ?? []).map((x: { bed_id: string }) => x.bed_id)));
    })();
  }, [unitId]);

  useEffect(() => {
    if (value && !ward) { const b = beds.find((x) => x.id === value); if (b) setWard(b.ward_id); }
  }, [value, beds, ward]);

  const list = beds.filter((b) => b.ward_id === ward);
  const free = list.filter((b) => !busy.has(b.id)).length;
  return (
    <div className="grid g2">
      <div className="field"><label className={required ? 'req' : ''}>Ward</label>
        <select value={ward} required={required} onChange={(e) => { setWard(e.target.value); onChange(''); }}>
          <option value="">Select ward</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div className="field"><label className={required ? 'req' : ''}>Bed {ward && <span className="muted">({free} free)</span>}</label>
        <select value={value} required={required} disabled={!ward} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select bed</option>
          {list.map((b) => <option key={b.id} value={b.id} disabled={busy.has(b.id)}>{b.label}{busy.has(b.id) ? ' — occupied' : ''}</option>)}
        </select>
      </div>
    </div>
  );
}
