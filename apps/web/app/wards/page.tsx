'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Bed, type Inpatient, type Ward } from '@/lib/data';
import { todayLabel, STATUS_LABEL } from '@/lib/format';

export default function WardBoard() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [pick, setPick] = useState<string>('');
  const q = useLive(async () => {
    const [w, b, p] = await Promise.all([
      must(supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId!).eq('active', true).order('sort_order')),
      must(supabase.from('ward_beds').select('id, ward_id, label, sort_order, active').eq('unit_id', unitId!).eq('active', true).order('sort_order')),
      must(supabase.from('v_inpatients').select('*').eq('unit_id', unitId!)),
    ]);
    return { wards: w as Ward[], beds: b as Bed[], pts: p as Inpatient[] };
  }, LIVE_TABLES, [unitId]);

  const byBed = new Map((q.data?.pts ?? []).filter((p) => p.bed_id).map((p) => [p.bed_id!, p]));
  const only = pick || q.data?.wards[0]?.id || '';
  const wards = (q.data?.wards ?? []).filter((w) => only === 'all' || w.id === only);

  return (
    <div className="stack">
      <div className="tabs">
        {(q.data?.wards ?? []).map((w) => {
          const n = (q.data?.pts ?? []).filter((p) => p.ward_id === w.id).length;
          return <button key={w.id} className={only === w.id ? 'on' : ''} onClick={() => setPick(w.id)}>{w.name.replace(' Surgical Ward', ' ward').replace(' / Other beds', '')} · {n}</button>;
        })}
        <button className={only === 'all' ? 'on' : ''} onClick={() => setPick('all')}>All</button>
      </div>
      <div className="muted small">{todayLabel()} · amber line = no round yet today · red edge = critical</div>
      {q.error && <div className="msg err">{q.error}</div>}
      {wards.map((w) => {
        const beds = (q.data?.beds ?? []).filter((b) => b.ward_id === w.id);
        const occ = beds.filter((b) => byBed.has(b.id));
        const done = occ.filter((b) => byBed.get(b.id)!.rounds_today > 0).length;
        return (
          <div key={w.id} className="card stack">
            <div className="spread">
              <h2 style={{ margin: 0 }}>{w.name}</h2>
              <div className="row small" style={{ gap: 6 }}>
                <span className="badge navy">{occ.length} / {beds.length} occupied</span>
                <span className={`badge ${done === occ.length ? 'ok' : 'warn'}`}>Rounds {done} / {occ.length}</span>
              </div>
            </div>
            <div className="beds">
              {beds.map((b) => {
                const p = byBed.get(b.id);
                if (!p) return <div key={b.id} className="bed empty"><div className="bl">{b.label}</div>Vacant</div>;
                const crit = p.last_status === 'critical';
                return (
                  <Link key={b.id} href={`/patient/?id=${p.patient_id}`} className={`bed ${crit ? 'crit' : ''} ${p.rounds_today ? '' : 'pending'}`}>
                    <div className="spread"><span className="bl">{b.label}</span>{p.postop_day != null && <span className="badge teal">POD {p.postop_day}</span>}</div>
                    <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                    <div className="muted">{p.age_years}/{p.sex} · IP {p.ip_number}</div>
                    <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.diagnosis ?? ''}</div>
                    {p.last_status && <div style={{ color: crit ? 'var(--bad)' : 'var(--muted)' }}>{STATUS_LABEL[p.last_status]}</div>}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      {(q.data?.pts ?? []).some((p) => !p.bed_id) && (
        <div className="card"><h2>Admitted without a bed</h2>
          {(q.data?.pts ?? []).filter((p) => !p.bed_id).map((p) => <div key={p.admission_id}><Link href={`/patient/?id=${p.patient_id}`}>{p.full_name}</Link> · IP {p.ip_number}</div>)}
        </div>
      )}
    </div>
  );
}
