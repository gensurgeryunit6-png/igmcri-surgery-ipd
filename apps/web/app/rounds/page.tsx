'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Inpatient, type Ward } from '@/lib/data';
import { todayLabel, fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/ui';

/** Ward-wise list of patients with today's round status. Tap a patient to write their round. */
export default function RoundsPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const me = s.session?.user.id;
  const [pick, setPick] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const q = useLive(async () => {
    const [w, p] = await Promise.all([
      must(supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId!).eq('active', true).order('sort_order')),
      must(supabase.from('v_inpatients').select('*').eq('unit_id', unitId!).order('ward_sort').order('bed_sort')),
    ]);
    return { wards: w as Ward[], pts: p as Inpatient[] };
  }, LIVE_TABLES, [unitId]);

  const wards = q.data?.wards ?? [];
  const all = q.data?.pts ?? [];
  const ward = pick || 'all';
  const list = all
    .filter((p) => (ward === 'all' ? true : ward === 'none' ? !p.ward_id : p.ward_id === ward))
    .filter((p) => !mineOnly || p.assigned_pg_id === me);
  const pending = list.filter((p) => p.rounds_today === 0);
  const firstPending = pending[0];

  return (
    <div className="stack">
      <div className="spread">
        <span className="muted small">{todayLabel()}</span>
        <label className="small row" style={{ gap: 6, margin: 0, color: 'var(--ink)' }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} style={{ width: 18, height: 18 }} />
          My patients only
        </label>
      </div>

      <div className="tabs">
        <button className={ward === 'all' ? 'on' : ''} onClick={() => setPick('all')}>All wards {all.filter((p) => !p.rounds_today).length ? `· ${all.filter((p) => !p.rounds_today).length} due` : '· done'}</button>
        {wards.map((w) => {
          const inWard = all.filter((p) => p.ward_id === w.id);
          const left = inWard.filter((p) => p.rounds_today === 0).length;
          return <button key={w.id} className={ward === w.id ? 'on' : ''} onClick={() => setPick(w.id)}>
            {w.name.replace(' Surgical Ward', '').replace(' / Other beds', '')} {left ? `· ${left} due` : '· done'}</button>;
        })}
        {all.some((p) => !p.ward_id) && <button className={ward === 'none' ? 'on' : ''} onClick={() => setPick('none')}>No bed</button>}
      </div>

      {q.error && <div className="msg err">{q.error}</div>}

      {firstPending && s.can('round.write') && (
        <Link href={`/round/?a=${firstPending.admission_id}&ward=${ward}`} className="btn teal" style={{ padding: 14, fontSize: 15 }}>
          Start rounds · {pending.length} due{ward === 'all' ? '' : ' in this ward'}
        </Link>
      )}
      {list.length > 0 && pending.length === 0 && <div className="msg ok">Every patient here has a round today.</div>}
      {list.length === 0 && q.data && <p className="muted">No patients here.</p>}

      <div className="mobile-list">
        {list.map((p, i) => (<div key={p.admission_id} className="stack" style={{ gap: 8 }}>
          {ward === 'all' && (i === 0 || list[i - 1].ward_id !== p.ward_id) && <h3 style={{ margin: '8px 0 0' }}>{p.ward ?? 'No bed allocated'}</h3>}
          <Link href={`/round/?a=${p.admission_id}&ward=${ward}`} className="mcard">
            <div className="spread">
              <span><b>{p.bed ?? '—'}</b> · {p.full_name} <span className="muted small">{p.age_years}/{p.sex}</span></span>
              <span className="row" style={{ gap: 6 }}>
                {p.postop_day != null && <span className="badge teal">POD {p.postop_day}</span>}
                {p.last_status && <StatusBadge s={p.last_status} />}
              </span>
            </div>
            <div className="muted small">IP {p.ip_number} · {p.diagnosis ?? 'No diagnosis yet'}</div>
            <div className="small" style={{ marginTop: 3 }}>
              {p.rounds_today
                ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{p.rounds_today} round{p.rounds_today > 1 ? 's' : ''} today{p.unverified_today ? ` · ${p.unverified_today} not verified` : ' · verified'}</span>
                : <span style={{ color: 'var(--warn)', fontWeight: 600 }}>Round due{p.last_round_at ? ` · last ${fmtDateTime(p.last_round_at)}` : ''}</span>}
              {p.open_tasks > 0 && <span className="muted"> · {p.open_tasks} open task{p.open_tasks > 1 ? 's' : ''}</span>}
            </div>
          </Link>
        </div>))}
      </div>
    </div>
  );
}
