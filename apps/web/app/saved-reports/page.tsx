'use client';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { REPORTS, buildFromData, downloadXlsx, type ReportData, type ReportKind, type Report } from '@/lib/reports';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { ReportView } from '@/components/ReportView';

type Snap = { id: string; for_date: string; taken_at: string };

/** Ward data saved automatically each morning, so the morning picture is kept even after the day moves on. */
export default function SavedReportsPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [kind, setKind] = useState<ReportKind>('unit');
  const [ward, setWard] = useState('');
  const [open, setOpen] = useState<{ snap: Snap; data: ReportData } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [made, setMade] = useState('');
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);
  const q = useLive(async () => {
    const [list, set] = await Promise.all([
      must(supabase.from('daily_report_snapshots').select('id, for_date, taken_at').eq('unit_id', unitId!).order('for_date', { ascending: false }).limit(60)),
      must(supabase.from('unit_settings').select('morning_report_hour, morning_report_enabled').eq('unit_id', unitId!).maybeSingle()),
    ]);
    return { list: list as Snap[], set: set as { morning_report_hour: number; morning_report_enabled: boolean } | null };
  }, [], [unitId]);

  if (!s.can('report.generate')) return <div className="msg err">Your role cannot open reports.</div>;

  const openSnap = async (snap: Snap) => {
    setReport(null); setMsg(null);
    const { data, error } = await supabase.from('daily_report_snapshots').select('data').eq('id', snap.id).single();
    if (error) return setMsg({ kind: 'err', text: friendlyError(error) });
    const d = data.data as ReportData;
    setOpen({ snap, data: d }); setWard(d.wards[0]?.id ?? '');
  };
  const show = () => { if (!open) return; setReport(buildFromData(kind, open.data, s.unit!.name, open.snap.for_date, ward)); setMade(new Date().toISOString()); };
  const saveNow = async () => {
    const { error } = await supabase.rpc('save_ward_snapshot_now', { p_unit: unitId });
    setMsg(error ? { kind: 'err', text: friendlyError(error) } : { kind: 'ok', text: "Today's ward data saved." });
    q.reload();
  };
  const set = q.data?.set;

  return (
    <div className="stack">
      <div className="card stack no-print">
        <p className="small" style={{ margin: 0 }}>
          {set?.morning_report_enabled
            ? <>The unit&apos;s ward data is saved automatically every day at <b>{String(set.morning_report_hour).padStart(2, '0')}:00</b>. The saved copy does not change when notes are added later.</>
            : <>Automatic saving is switched off. An administrator can switch it on under Wards and beds.</>}
        </p>
        <button className="ghost" onClick={saveNow}>Save today&apos;s ward data now</button>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      {!open && (
        <div className="mobile-list no-print">
          {(q.data?.list ?? []).map((x) => (
            <button key={x.id} className="mcard ghost" style={{ textAlign: 'left', fontWeight: 400 }} onClick={() => openSnap(x)}>
              <b>{fmtDate(`${x.for_date}T06:00:00Z`)}</b><div className="muted small">Saved {fmtDateTime(x.taken_at)}</div>
            </button>
          ))}
          {q.data && q.data.list.length === 0 && <p className="muted">No saved reports yet. The first one is saved at the scheduled time today.</p>}
        </div>
      )}

      {open && (
        <div className="card stack no-print">
          <div className="spread"><b>{fmtDate(`${open.snap.for_date}T06:00:00Z`)} · saved {fmtDateTime(open.snap.taken_at)}</b>
            <button className="ghost" onClick={() => { setOpen(null); setReport(null); }}>Other dates</button></div>
          <select value={kind} onChange={(e) => { setKind(e.target.value as ReportKind); setReport(null); }}>{REPORTS.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}</select>
          {kind === 'ward' && <select value={ward} onChange={(e) => { setWard(e.target.value); setReport(null); }}>{open.data.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
          <button className="teal" onClick={show}>Show report</button>
        </div>
      )}
      {report && open && (
        <>
          <style>{`@media print { @page { size: A4 ${kind === 'ward' || kind === 'unit' ? 'landscape' : 'portrait'}; margin: 10mm; } }`}</style>
          <div className="row no-print">
            <button onClick={() => { supabase.from('report_log').insert({ unit_id: unitId, kind, format: 'print', parameters: { snapshot: open.snap.id } }).then(); window.print(); }}>Print or save as PDF</button>
            <button className="ghost" onClick={() => { supabase.from('report_log').insert({ unit_id: unitId, kind, format: 'xlsx', parameters: { snapshot: open.snap.id } }).then(); downloadXlsx(report, `${kind}-report-${open.snap.for_date}.xlsx`); }}>Download Excel</button>
          </div>
          <ReportView report={report} made={made} savedAt={open.snap.taken_at} />
        </>
      )}
    </div>
  );
}
