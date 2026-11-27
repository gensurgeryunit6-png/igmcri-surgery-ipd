'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { CASE_STATUS, LATERALITY, SESSIONS, serviceLabel, todayIst, caseWho, type OtCase } from '@/lib/workflow';

type Row = OtCase & { ot_lists: { id: string; session: string; ot_room: string; status: string } };

export default function OtTodayPage() { return <Suspense><OtToday /></Suspense>; }

/** Today's cases for one list type, straight from the home-screen count. */
function OtToday() {
  const service = useSearchParams().get('s') ?? 'major';
  const s = useSession();
  const today = todayIst();
  const live = useLive(async () => must(supabase.from('ot_cases')
    .select('*, patients(full_name, uhid, age_years, sex, phone, op_number), admissions(ip_number), ot_lists!inner(id, session, ot_room, status, list_date, service, unit_id)')
    .eq('ot_lists.unit_id', s.unit!.id).eq('ot_lists.list_date', today).eq('ot_lists.service', service).order('seq')), ['ot_cases', 'ot_lists'], [s.unit?.id, service]);
  const rows = ((live.data as unknown as Row[]) ?? []).filter((c) => c.status !== 'cancelled');
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>{serviceLabel(service)} today · {live.data ? rows.length : '…'}</h2>
      {live.error && <div className="msg err">{live.error}</div>}
      {live.data && rows.length === 0 && <p className="muted">No {serviceLabel(service)} cases listed for today.</p>}
      <div className="mobile-list">
        {rows.map((c) => {
          const w = caseWho(c);
          return (
            <Link key={c.id} href={`/ot-list/?id=${c.ot_lists.id}`} className="mcard">
              <div className="spread"><b>{c.seq}. {w.name}</b><span className="muted small">{w.ageSex}</span></div>
              <div className="small"><b>{c.procedure}</b>{c.laterality && c.laterality !== 'na' ? ` (${LATERALITY[c.laterality]})` : ''}{c.diagnosis ? <span className="muted"> · {c.diagnosis}</span> : null}</div>
              <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                <span className={`badge ${c.status === 'done' ? 'ok' : c.status === 'planned' ? 'teal' : 'warn'}`}>{CASE_STATUS[c.status]}</span>
                <span className="badge">{SESSIONS[c.ot_lists.session]}{c.ot_lists.ot_room ? ` · ${c.ot_lists.ot_room}` : ''}</span>
                {c.anaesthesia && <span className="badge">{c.anaesthesia}</span>}
                <span className="muted">{w.id}</span>
              </div>
            </Link>
          );
        })}
      </div>
      <Link className="small" href={`/ot/?s=${service}`}>All {serviceLabel(service)} lists →</Link>
    </div>
  );
}
