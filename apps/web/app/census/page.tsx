'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census, type Inpatient, type Ward } from '@/lib/data';
import { todayLabel, fmtDate, ageSex, fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/ui';

export default function CensusPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const q = useLive(async () => {
    const [c, pts, wards] = await Promise.all([
      must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()),
      must(supabase.from('v_inpatients').select('*').eq('unit_id', unitId!).order('ward_sort').order('bed_sort')),
      must(supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId!).eq('active', true).order('sort_order')),
    ]);
    return { c: c as Census | null, pts: pts as Inpatient[], wards: wards as Ward[] };
  }, LIVE_TABLES, [unitId]);

  const c = q.data?.c;
  const pts = q.data?.pts ?? [];
  const groups = [
    ...(q.data?.wards ?? []).map((w) => ({ key: w.id, name: w.name, rows: pts.filter((p) => p.ward_id === w.id) })),
    { key: 'none', name: 'No bed allocated', rows: pts.filter((p) => !p.bed_id) },
  ].filter((g) => g.rows.length || g.key !== 'none');

  const measures: [string, number | undefined, boolean?][] = [
    ['Total admitted', c?.total_admitted],
    ['Male Surgical Ward', c?.male_ward],
    ['Female Surgical Ward', c?.female_ward],
    ['Special Ward', c?.special_ward],
    ['Emergency / other beds', c?.other_beds],
    ['New admissions', c?.new_admissions],
    ['Postoperative', c?.postoperative],
    ['Critical', c?.critical, true],
    ['Awaiting surgery', c?.awaiting_surgery],
    ['Planned for discharge', c?.planned_discharge],
    ['Discharges completed', c?.discharged_today],
  ];

  return (
    <div className="stack">
      <div className="print-head">
        <b>Indira Gandhi Medical College &amp; Research Institute, Puducherry</b>
        Department of General Surgery · {s.unit?.name} · Today&apos;s Inpatient Census · {todayLabel()}
      </div>
      <div className="spread no-print">
        <div>
          <h1>Today&apos;s inpatient census</h1>
          <div className="muted small">{todayLabel()} · {s.unit?.name} · updates live</div>
        </div>
        <button className="ghost" onClick={() => window.print()}>Print (A4)</button>
      </div>
      {q.error && <div className="msg err">{q.error}</div>}

      <div className="grid g4">
        {measures.map(([label, n, alert]) => (
          <div key={label} className={`stat ${label === 'Total admitted' ? 'lead' : ''} ${alert && n ? 'alert' : ''}`}>
            <div className="n">{n ?? '–'}</div><div className="l">{label}</div>
          </div>
        ))}
        {!!c?.no_bed && <div className="stat alert"><div className="n">{c.no_bed}</div><div className="l">Admitted without a bed</div></div>}
      </div>

      {groups.map((g) => (
        <div key={g.key} className="stack" style={{ gap: 8 }}>
          <div className="spread"><h2 style={{ margin: 0 }}>{g.name}</h2><span className="badge navy">{g.rows.length}</span></div>
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
      <p className="muted small">All figures are counted live from the database. Clinical status is from each patient&apos;s latest ward-round entry.</p>
    </div>
  );
}
