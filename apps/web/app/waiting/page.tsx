'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { ageSex, fmtDate, fmtDateTime } from '@/lib/format';
import { SERVICES, PRIORITY, BOOKING_STATUS, CONTACT, PREOP_ITEMS, serviceLabel, telHref, type WaitRow } from '@/lib/workflow';

const VIEWS = [
  { k: 'active', label: 'Waiting', statuses: ['waiting', 'postponed'] },
  { k: 'listed', label: 'On OT list', statuses: ['scheduled'] },
  { k: 'closed', label: 'Done / cancelled', statuses: ['completed', 'cancelled'] },
] as const;

/** One waiting list for Major OT, Minor OT and Endoscopy, with call tracking. */
export default function WaitingPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [service, setService] = useState('');
  const [view, setView] = useState<(typeof VIEWS)[number]['k']>('active');
  const [contact, setContact] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const statuses = VIEWS.find((v) => v.k === view)!.statuses;

  const live = useLive(async () => must(supabase.from('v_waiting_list').select('*').eq('unit_id', unitId!)
    .in('status', statuses as unknown as string[]).order('created_at', { ascending: view !== 'closed' }).limit(view === 'closed' ? 100 : 500)),
    ['surgery_waitlist', 'booking_calls', 'ot_cases'], [unitId, view]);

  const rank = { emergency: 0, urgent: 1, routine: 2 } as Record<string, number>;
  const rows = ((live.data as WaitRow[]) ?? [])
    .filter((r) => !service || r.list_type === service)
    .filter((r) => !contact || r.contact_status === contact)
    .filter((r) => { const t = q.trim().toLowerCase(); return !t || [r.full_name, r.uhid, r.phone, r.phone_2, r.planned_procedure, r.op_number].some((x) => x?.toLowerCase().includes(t)); })
    .sort((a, b) => (rank[a.priority] - rank[b.priority]) || (a.planned_date ?? '9999').localeCompare(b.planned_date ?? '9999'));

  const call = async (id: string, outcome: string) => {
    setErr('');
    const { error } = await supabase.from('booking_calls').insert({ booking_id: id, outcome });
    if (error) setErr(friendlyError(error)); else live.reload();
  };

  const count = (sv: string) => ((live.data as WaitRow[]) ?? []).filter((r) => !sv || r.list_type === sv).length;

  return (
    <div className="stack">
      <div className="tabs">
        <button className={service === '' ? 'on' : ''} onClick={() => setService('')}>All · {count('')}</button>
        {SERVICES.map((sv) => <button key={sv.v} className={service === sv.v ? 'on' : ''} onClick={() => setService(sv.v)}>{sv.label} · {count(sv.v)}</button>)}
      </div>
      <div className="grid g2">
        <select value={view} onChange={(e) => setView(e.target.value as 'active')}>{VIEWS.map((v) => <option key={v.k} value={v.k}>{v.label}</option>)}</select>
        <select value={contact} onChange={(e) => setContact(e.target.value)}><option value="">Any call status</option>
          {Object.entries(CONTACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, UHID, mobile or procedure" />
      {err && <div className="msg err">{err}</div>}
      {live.error && <div className="msg err">{live.error}</div>}
      {live.data && rows.length === 0 && <p className="muted">No patients here.</p>}
      <div className="mobile-list">
        {rows.map((r) => {
          const done = PREOP_ITEMS.filter((i) => i.ok(r as never)).length;
          return (
            <div key={r.id} className="mcard stack" style={{ gap: 6 }}>
              <Link href={`/booking/?id=${r.id}`} style={{ color: 'inherit' }}>
                <div className="spread"><b>{r.full_name}</b><span className="muted small">{ageSex(r.age_years, r.sex)} · UHID {r.uhid}</span></div>
                <div className="small"><b>{serviceLabel(r.list_type)}</b> · {r.planned_procedure}{r.diagnosis ? <span className="muted"> · {r.diagnosis}</span> : null}</div>
                <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                  {r.priority !== 'routine' && <span className="badge bad">{PRIORITY[r.priority]}</span>}
                  <span className="badge">{BOOKING_STATUS[r.status]}{r.planned_date ? ` · ${fmtDate(r.planned_date)}` : ''}</span>
                  {r.is_admitted ? <span className="badge teal">Admitted{r.bed ? ` · ${r.bed}` : ''}</span> : <span className="badge">OPD</span>}
                  <span className={`badge ${r.preop_ready ? 'ok' : 'warn'}`}>{r.preop_ready ? 'Pre-op ready' : `Pre-op ${done}/${PREOP_ITEMS.length}`}</span>
                  <span className={`badge ${r.contact_status === 'willing' ? 'ok' : ['not_willing', 'not_reachable'].includes(r.contact_status) ? 'warn' : ''}`}>
                    {CONTACT[r.contact_status]}{r.contact_attempts ? ` · ${r.contact_attempts} call${r.contact_attempts > 1 ? 's' : ''}` : ''}</span>
                </div>
                {r.status_reason && <div className="small muted">Reason: {r.status_reason}</div>}
                {r.last_contacted_at && <div className="small muted">Last call {fmtDateTime(r.last_contacted_at)}</div>}
              </Link>
              {view !== 'closed' && (
                <div className="row" style={{ gap: 6 }}>
                  {r.phone && <a className="btn ghost" href={telHref(r.phone)} style={{ padding: '6px 10px' }}>Call {r.phone}</a>}
                  {r.phone_2 && <a className="btn ghost" href={telHref(r.phone_2)} style={{ padding: '6px 10px' }}>Call {r.phone_2}</a>}
                  {s.can('ot.prepare') && <>
                    <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => call(r.id, 'willing')}>Willing</button>
                    <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => call(r.id, 'not_reachable')}>Not reachable</button>
                    <button className="ghost" style={{ padding: '6px 10px' }} onClick={() => call(r.id, 'not_willing')}>Not willing</button>
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
