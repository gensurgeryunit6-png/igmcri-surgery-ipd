'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Inpatient, type Ward } from '@/lib/data';
import { todayLabel, fmtDate, ageSex, fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/ui';

/** Lists behind each count on the home screen. ?k= picks the list; no key = all inpatients. */
const LISTS: Record<string, { title: string; test: (p: Inpatient, today: string) => boolean }> = {
  all: { title: 'All inpatients', test: () => true },
  male: { title: 'Male Surgical Ward', test: (p) => p.ward_kind === 'male' },
  female: { title: 'Female Surgical Ward', test: (p) => p.ward_kind === 'female' },
  special: { title: 'Special Ward', test: (p) => p.ward_kind === 'special' },
  other: { title: 'Emergency and other beds', test: (p) => p.ward_kind === 'emergency' || p.ward_kind === 'other' },
  nobed: { title: 'Admitted without a bed', test: (p) => !p.bed_id },
  new: { title: 'Admitted today', test: (p, t) => new Date(p.admitted_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === t },
  rounds: { title: 'Rounds due today', test: (p) => !p.rounds_today },
  critical: { title: 'Critical', test: (p) => p.last_status === 'critical' },
  postop: { title: 'Post-operative', test: (p) => !!p.is_postop },
  surgery: { title: 'Awaiting surgery', test: (p) => !!p.awaiting_surgery },
  discharge: { title: 'Planned for discharge', test: (p, t) => !!p.planned_discharge_on && p.planned_discharge_on <= t },
};

export default function CensusPage() { return <Suspense><CensusList /></Suspense>; }

function CensusList() {
  const k = useSearchParams().get('k') ?? 'all';
  const list = LISTS[k] ?? LISTS.all;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const s = useSession();
  const unitId = s.unit?.id;
  const q = useLive(async () => {
    const [pts, wards] = await Promise.all([
      must(supabase.from('v_inpatients').select('*').eq('unit_id', unitId!).order('ward_sort').order('bed_sort')),
      must(supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId!).eq('active', true).order('sort_order')),
    ]);
    return { pts: pts as Inpatient[], wards: wards as Ward[] };
  }, LIVE_TABLES, [unitId]);

  const pts = (q.data?.pts ?? []).filter((p) => list.test(p, today));
  const groups = [
    ...(q.data?.wards ?? []).map((w) => ({ key: w.id, name: w.name, rows: pts.filter((p) => p.ward_id === w.id) })),
    { key: 'none', name: 'No bed allocated', rows: pts.filter((p) => !p.bed_id) },
  ].filter((g) => g.rows.length);

  return (
    <div className="stack">
      <div className="print-head">
        <b>Indira Gandhi Medical College &amp; Research Institute, Puducherry</b>
        Department of General Surgery · {s.unit?.name} · {list.title} · {todayLabel()}
      </div>
      <div className="spread no-print">
        <h2 style={{ margin: 0 }}>{list.title} · {q.data ? pts.length : '…'}</h2>
        <button className="ghost" style={{ padding: '6px 12px' }} onClick={() => window.print()}>Print</button>
      </div>
      {k !== 'all' && <Link className="small no-print" href="/census/">All inpatients ({q.data?.pts.length ?? '…'}) →</Link>}
      {q.data && pts.length === 0 && <p className="muted">No patients in this list.</p>}
      {q.error && <div className="msg err">{q.error}</div>}

      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 8 }}>
          {groups.length > 1 && <div className="spread"><h3 style={{ margin: 0 }}>{g.name}</h3><span className="badge navy">{g.rows.length}</span></div>}
          {g.rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No patients.</p> : (
            <>
            <div className="mobile-list">
              {g.rows.map((p) => (
                <Link key={p.admission_id} href={`/patient/?id=${p.patient_id}`} className="mcard">
                  <div className="spread"><span><b>{p.bed ?? '—'}</b> · {p.full_name} <span className="muted">{ageSex(p.age_years, p.sex)}</span></span>
                    {p.last_status && <StatusBadge s={p.last_status} />}</div>
                  <div className="muted small">UHID {p.uhid} · IP {p.ip_number}</div>
                  <div className="small">{p.diagnosis ?? '—'}</div>
                  <div className="row small" style={{ gap: 6, marginTop: 4 }}>
                    {p.postop_day != null && <span className="badge teal">POD {p.postop_day}</span>}
                    {p.admission_type === 'emergency' && <span className="badge warn">Emergency</span>}
                    {p.awaiting_surgery && <span className="badge teal">Awaiting surgery</span>}
                    {p.rounds_today ? <span className="badge ok">Round done</span> : <span className="badge warn">Round pending</span>}
                  </div>
                </Link>
              ))}
            </div>
            <div className="table-wrap desktop-table">
              <table className="t">
                <thead><tr><th>Bed</th><th>Patient</th><th>UHID / IP</th><th>Diagnosis</th><th>Admitted</th><th>POD</th><th>Status</th><th className="no-print">Round today</th></tr></thead>
                <tbody>
                  {g.rows.map((p) => (
                    <tr key={p.admission_id}>
                      <td><b>{p.bed ?? '—'}</b></td>
                      <td><Link href={`/patient/?id=${p.patient_id}`}>{p.full_name}</Link><div className="muted small">{ageSex(p.age_years, p.sex)}</div></td>
                      <td className="small">{p.uhid}<br />IP {p.ip_number}</td>
                      <td className="small">{p.diagnosis ?? '—'}</td>
                      <td className="small">{fmtDate(p.admitted_at)}{p.admission_type === 'emergency' && <> <span className="badge warn">Emergency</span></>}</td>
                      <td>{p.postop_day ?? '—'}</td>
                      <td>{p.last_status ? <StatusBadge s={p.last_status} /> : <span className="muted small">—</span>}
                        {p.awaiting_surgery && <div><span className="badge teal">Awaiting surgery</span></div>}
                        {p.planned_discharge_on && <div className="small muted">Discharge {fmtDate(p.planned_discharge_on)}</div>}</td>
                      <td className="no-print small">{p.rounds_today ? <span className="badge ok">{p.rounds_today} done</span> : <span className="badge warn">Pending</span>}
                        {p.last_round_at && <div className="muted">{fmtDateTime(p.last_round_at)}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      ))}
      <p className="muted small">Updates live. Clinical status is from each patient&apos;s latest ward round.</p>
    </div>
  );
}
