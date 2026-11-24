'use client';
import { useSession } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';
import type { Report } from '@/lib/reports';

/** Letterhead + tables; prints on A4 via the browser's print/PDF. */
export function ReportView({ report, made, savedAt }: { report: Report; made: string; savedAt?: string }) {
  const s = useSession();
  return (
    <div className="report">
            <div className="letterhead">
              <b>INDIRA GANDHI MEDICAL COLLEGE &amp; RESEARCH INSTITUTE, PUDUCHERRY</b>
              <span>Department of General Surgery · {s.unit?.name}</span>
              <h2>{report.title}</h2>
              <span>{report.subtitle}</span>
            </div>
            {report.sections.map((sec, i) => (
              <section key={i} className="report-section">
                <h3>{sec.heading}</h3>
                {sec.rows.length === 0 ? <p className="muted small">None.</p> : (
                  <div className="table-wrap">
                    <table className="t report-table">
                      <thead><tr>{sec.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                      <tbody>{sec.rows.map((row, j) => (
                        <tr key={j}>{row.map((cell, k) => <td key={k} className={cell === 'NO ROUND RECORDED' ? 'missing' : ''}>{cell}</td>)}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {sec.note && <p className="small muted">{sec.note}</p>}
              </section>
            ))}
            <div className="report-foot">{savedAt ? `Saved automatically ${fmtDateTime(savedAt)} · printed ${fmtDateTime(made)} by ${s.staff?.full_name}` : `Generated ${fmtDateTime(made)} by ${s.staff?.full_name}`} · Surgery Unit OS · Confidential patient information — for authorised unit staff only.</div>
          </div>
  );
}
