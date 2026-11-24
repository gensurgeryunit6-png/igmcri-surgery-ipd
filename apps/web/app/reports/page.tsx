'use client';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import type { Ward } from '@/lib/data';
import { REPORTS, buildReport, downloadXlsx, type Report, type ReportKind } from '@/lib/reports';
import { fmtDateTime } from '@/lib/format';

export default function ReportsPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [kind, setKind] = useState<ReportKind>('unit');
  const [date, setDate] = useState(today);
  const [wards, setWards] = useState<Ward[]>([]);
  const [ward, setWard] = useState('');
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('landscape');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState('');
  const meta = REPORTS.find((r) => r.k === kind)!;

  useEffect(() => {
    if (!unitId) return;
    supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId).eq('active', true).order('sort_order')
      .then(({ data }) => { setWards((data as Ward[]) ?? []); setWard((data as Ward[])?.[0]?.id ?? ''); });
  }, [unitId]);
  useEffect(() => { setOrient('landscape' in meta && meta.landscape ? 'landscape' : 'portrait'); setReport(null); }, [kind, meta]);

  if (!s.can('report.generate')) return <div className="msg err">Your role cannot generate reports.</div>;

  const log = (format: 'print' | 'xlsx') =>
    supabase.from('report_log').insert({ unit_id: unitId, kind, format, parameters: { date, ward: meta.k === 'ward' ? ward : null } });

  const generate = async () => {
    setBusy(true); setErr('');
    try {
      setReport(await buildReport(kind, unitId!, s.unit!.name, date, ward));
      setMade(new Date().toISOString());
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };

  return (
    <div className="stack">
      <style>{`@media print { @page { size: A4 ${orient}; margin: 10mm; } }`}</style>
      <div className="card stack no-print">
        <div className="field"><label>Report</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>{REPORTS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}</select></div>
        <div className="grid g2">
          <div className="field"><label>Date</label><input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); setReport(null); }} /></div>
          {meta.k === 'ward' ? (
            <div className="field"><label>Ward</label>
              <select value={ward} onChange={(e) => { setWard(e.target.value); setReport(null); }}>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}<option value="none">No bed allocated</option></select></div>
          ) : (
            <div className="field"><label>Page</label>
              <select value={orient} onChange={(e) => setOrient(e.target.value as 'portrait')}><option value="portrait">A4 portrait</option><option value="landscape">A4 landscape</option></select></div>
          )}
        </div>
        <button className="teal" disabled={busy} onClick={generate}>{busy ? 'Preparing…' : 'Show report'}</button>
        {err && <div className="msg err">{err}</div>}
      </div>

      {report && (
        <>
          <div className="row no-print">
            <button onClick={() => { log('print'); window.print(); }}>Print or save as PDF</button>
            <button className="ghost" onClick={() => { log('xlsx'); downloadXlsx(report, `${kind}-report-${date}.xlsx`); }}>Download Excel</button>
          </div>
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
            <div className="report-foot">Generated {fmtDateTime(made)} by {s.staff?.full_name} · Surgery Unit OS · Confidential patient information — for authorised unit staff only.</div>
          </div>
        </>
      )}
    </div>
  );
}
