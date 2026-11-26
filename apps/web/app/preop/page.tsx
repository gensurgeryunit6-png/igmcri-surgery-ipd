'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { ageSex, fmtDate } from '@/lib/format';
import { SERVICES, PREOP_ITEMS, BOOKING_STATUS, serviceLabel, type WaitRow } from '@/lib/workflow';

/** Pre-op work-up for every booked patient — Major OT, Minor OT and Endoscopy, admitted or not. */
export default function PreopPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [service, setService] = useState('');
  const [only, setOnly] = useState<'incomplete' | 'ready' | 'all'>('incomplete');
  const live = useLive(async () => must(supabase.from('v_waiting_list').select('*').eq('unit_id', unitId!)
    .in('status', ['waiting', 'postponed', 'scheduled']).order('planned_date', { ascending: true, nullsFirst: false })),
    ['surgery_waitlist', 'ot_cases'], [unitId]);
  const all = ((live.data as WaitRow[]) ?? []).filter((r) => !service || r.list_type === service);
  const rows = all.filter((r) => only === 'all' || (only === 'ready' ? r.preop_ready : !r.preop_ready));

  return (
    <div className="stack">
      <div className="tabs">
        <button className={service === '' ? 'on' : ''} onClick={() => setService('')}>All</button>
        {SERVICES.map((sv) => <button key={sv.v} className={service === sv.v ? 'on' : ''} onClick={() => setService(sv.v)}>{sv.label}</button>)}
      </div>
      <div className="row">
        {(['incomplete', 'ready', 'all'] as const).map((k) => (
          <button key={k} className={only === k ? 'teal' : 'ghost'} onClick={() => setOnly(k)}>
            {k === 'incomplete' ? 'Work-up pending' : k === 'ready' ? 'Ready' : 'All'} · {all.filter((r) => k === 'all' || (k === 'ready' ? r.preop_ready : !r.preop_ready)).length}
          </button>
        ))}
      </div>
      {live.error && <div className="msg err">{live.error}</div>}
      {live.data && rows.length === 0 && <p className="muted">Nobody here.</p>}
      <div className="mobile-list">
        {rows.map((r) => {
          const missing = PREOP_ITEMS.filter((i) => !i.ok(r as never));
          return (
            <Link key={r.id} href={`/booking/?id=${r.id}`} className="mcard">
              <div className="spread"><b>{r.full_name}</b><span className="muted small">{ageSex(r.age_years, r.sex)} · UHID {r.uhid}</span></div>
              <div className="small"><b>{serviceLabel(r.list_type)}</b> · {r.planned_procedure}</div>
              <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                <span className="badge">{BOOKING_STATUS[r.status]}{r.planned_date ? ` · ${fmtDate(r.planned_date)}` : ''}</span>
                {r.is_admitted ? <span className="badge teal">Admitted{r.bed ? ` · ${r.bed}` : ''}</span> : <span className="badge">OPD</span>}
                {r.pg_name && <span className="badge">{r.pg_name}</span>}
              </div>
              {missing.length ? <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>Pending: {missing.map((m) => m.label).join(', ')}</div>
                : <div className="small" style={{ color: 'var(--ok)', marginTop: 4 }}>✓ Work-up complete</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
