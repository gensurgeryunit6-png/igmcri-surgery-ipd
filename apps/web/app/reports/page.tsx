'use client';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import type { Ward } from '@/lib/data';
import { REPORTS, WORKFLOW_REPORTS, buildReport, buildWorkflowReport, isWorkflowKind, downloadXlsx, type Report, type ReportKind, type WorkflowKind } from '@/lib/reports';
import { ReportView } from '@/components/ReportView';
import Link from 'next/link';

export default function ReportsPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [kind, setKind] = useState<ReportKind | WorkflowKind>('daily');
  const [date, setDate] = useState(today);
  const [wards, setWards] = useState<Ward[]>([]);
  const [ward, setWard] = useState('');
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('landscape');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState('');
  const meta = [...REPORTS, ...WORKFLOW_REPORTS].find((r) => r.k === kind)!;

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
      setReport(isWorkflowKind(kind) ? await buildWorkflowReport(kind, unitId!, s.unit!.name, date) : await buildReport(kind, unitId!, s.unit!.name, date, ward));
      setMade(new Date().toISOString());
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };

  return (
    <div className="stack">
      <style>{`@media print { @page { size: A4 ${orient}; margin: 10mm; } }`}</style>
      <div className="card stack no-print">
        <div className="field"><label>Report</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            <optgroup label="Unit and OT">{WORKFLOW_REPORTS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}</optgroup>
            <optgroup label="Ward rounds">{REPORTS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}</optgroup></select></div>
        <div className="grid g2">
          <div className="field"><label>Date</label><input type="date" value={date} max={kind === 'otday' ? undefined : today} onChange={(e) => { setDate(e.target.value); setReport(null); }} /></div>
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
        <Link href="/saved-reports/" className="small">Saved morning reports →</Link>
        {err && <div className="msg err">{err}</div>}
      </div>

      {report && (
        <>
          <div className="row no-print">
            <button onClick={() => { log('print'); window.print(); }}>Print or save as PDF</button>
            <button className="ghost" onClick={() => { log('xlsx'); downloadXlsx(report, `${kind}-report-${date}.xlsx`); }}>Download Excel</button>
          </div>
          <ReportView report={report} made={made} />
        </>
      )}
    </div>
  );
}
