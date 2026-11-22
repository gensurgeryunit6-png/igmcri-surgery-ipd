'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census, type Inpatient } from '@/lib/data';
import { todayLabel } from '@/lib/format';
import { StatusBadge } from '@/components/ui';

export default function Dashboard() {
  const s = useSession();
  const unitId = s.unit?.id;
  const census = useLive(async () =>
    must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()) as Promise<Census | null>,
    LIVE_TABLES, [unitId]);
  const watch = useLive(async () =>
    must(supabase.from('v_inpatients').select('admission_id, patient_id, full_name, uhid, ip_number, ward, bed, last_status, rounds_today, postop_day, diagnosis')
      .eq('unit_id', unitId!).order('ward_sort').order('bed_sort')) as Promise<Inpatient[]>,
    LIVE_TABLES, [unitId]);

  const c = census.data;
  const critical = (watch.data ?? []).filter((p) => p.last_status === 'critical' || p.last_status === 'worsening');
  const noRound = (watch.data ?? []).filter((p) => p.rounds_today === 0);

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Good {greeting()}, {displayName(s.staff?.full_name)}</h1>
          <div className="muted small">{todayLabel()} · {s.unit?.name}</div>
        </div>
        <div className="row">
          {s.can('patient.write') && <Link className="btn teal" href="/patients/?new=1">Register patient</Link>}
          <Link className="btn ghost" href="/census/">Full census</Link>
        </div>
      </div>

      {census.error && <div className="msg err">{census.error}</div>}
      <div className="grid g4">
        <Link className="stat lead" href="/census/"><div className="n">{c?.total_admitted ?? '–'}</div><div className="l">Patients admitted</div></Link>
        <Link className={`stat ${c?.rounds_pending ? 'alert' : ''}`} href="/wards/"><div className="n">{c?.rounds_pending ?? '–'}</div><div className="l">Rounds not yet done today</div></Link>
        <div className={`stat ${c?.critical ? 'alert' : ''}`}><div className="n">{c?.critical ?? '–'}</div><div className="l">Critical</div></div>
        <div className="stat"><div className="n">{c?.new_admissions ?? '–'}</div><div className="l">New admissions today</div></div>
      </div>
      <div className="grid g4">
        <div className="stat"><div className="n">{c?.postoperative ?? '–'}</div><div className="l">Postoperative</div></div>
        <div className="stat"><div className="n">{c?.awaiting_surgery ?? '–'}</div><div className="l">Awaiting surgery</div></div>
        <div className="stat"><div className="n">{c?.planned_discharge ?? '–'}</div><div className="l">Planned for discharge</div></div>
        <div className="stat"><div className="n">{c?.discharged_today ?? '–'}</div><div className="l">Discharged today</div></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Critical or worsening</h2>
          {critical.length === 0 ? <p className="muted small">None recorded in the latest rounds.</p> :
            <PatientList rows={critical} />}
        </div>
        <div className="card">
          <div className="spread"><h2>No round recorded today</h2><Link className="small" href="/wards/">Ward board →</Link></div>
          {noRound.length === 0 ? <p className="muted small">{watch.data?.length ? 'Every patient has a round entry today.' : 'No admitted patients.'}</p> :
            <PatientList rows={noRound.slice(0, 12)} more={noRound.length - 12} />}
        </div>
      </div>
    </div>
  );
}

function PatientList({ rows, more = 0 }: { rows: Inpatient[]; more?: number }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((p) => (
        <Link key={p.admission_id} href={`/patient/?id=${p.patient_id}`} className="spread" style={{ color: 'inherit', borderBottom: '1px solid #edf0f4', paddingBottom: 6 }}>
          <span><b>{p.bed ?? 'No bed'}</b> · {p.full_name} <span className="muted small">IP {p.ip_number}</span></span>
          <span className="row" style={{ gap: 6 }}>
            {p.postop_day != null && <span className="badge teal">POD {p.postop_day}</span>}
            {p.last_status && <StatusBadge s={p.last_status} />}
          </span>
        </Link>
      ))}
      {more > 0 && <span className="muted small">and {more} more</span>}
    </div>
  );
}

function displayName(n?: string) {
  if (!n) return '';
  const parts = n.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').trim().split(/\s+/);
  return /^dr\.?\s/i.test(n) ? `Dr. ${parts[0]}` : parts[0];
}

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
