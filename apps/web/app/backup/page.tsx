'use client';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { todayIst } from '@/lib/workflow';

// Every unit table, exported whole. Row security limits each export to what this administrator can see.
const TABLES: { t: string; sheet: string; order: string }[] = [
  { t: 'patients', sheet: 'Patients', order: 'created_at' },
  { t: 'admissions', sheet: 'Admissions', order: 'admitted_at' },
  { t: 'bed_assignments', sheet: 'Bed moves', order: 'from_at' },
  { t: 'diagnoses', sheet: 'Diagnoses', order: 'created_at' },
  { t: 'ward_round_entries', sheet: 'Ward rounds', order: 'round_at' },
  { t: 'ward_round_amendments', sheet: 'Round amendments', order: 'amended_at' },
  { t: 'investigations', sheet: 'Investigations', order: 'ordered_at' },
  { t: 'investigation_results', sheet: 'Results', order: 'resulted_at' },
  { t: 'medication_records', sheet: 'Medicines', order: 'created_at' },
  { t: 'dressing_records', sheet: 'Dressings', order: 'done_at' },
  { t: 'opd_visits', sheet: 'OPD visits', order: 'visit_at' },
  { t: 'surgery_waitlist', sheet: 'Bookings', order: 'created_at' },
  { t: 'booking_calls', sheet: 'Calls', order: 'called_at' },
  { t: 'ot_lists', sheet: 'OT lists', order: 'list_date' },
  { t: 'ot_cases', sheet: 'OT cases', order: 'created_at' },
  { t: 'surgeries', sheet: 'Operations', order: 'surgery_date' },
  { t: 'discharge_summaries', sheet: 'Discharge summaries', order: 'created_at' },
  { t: 'care_tasks', sheet: 'Tasks', order: 'created_at' },
  { t: 'unit_personnel', sheet: 'Personnel', order: 'created_at' },
  { t: 'wards', sheet: 'Wards', order: 'sort_order' },
  { t: 'ward_beds', sheet: 'Beds', order: 'sort_order' },
  { t: 'documents', sheet: 'Files (list)', order: 'created_at' },
];

async function fetchAll(table: string, order: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** Free backup: one Excel workbook with every record of the unit. */
export default function BackupPage() {
  const s = useSession();
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<{ sheet: string; n: number }[] | null>(null);
  const [err, setErr] = useState('');

  if (!s.can('users.manage')) return <div className="card muted">Only the unit administrator can download a backup.</div>;

  const run = async () => {
    setErr(''); setDone(null);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Surgery Unit OS backup';
      const counts: { sheet: string; n: number }[] = [];
      for (const { t, sheet, order } of TABLES) {
        setBusy(`Reading ${sheet}…`);
        const rows = await fetchAll(t, order);
        const ws = wb.addWorksheet(sheet.slice(0, 31));
        const cols = rows.length ? Object.keys(rows[0]) : ['(no records)'];
        const head = ws.addRow(cols);
        head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12305A' } }; });
        rows.forEach((r) => ws.addRow(cols.map((c) => { const v = r[c]; return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v; })));
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        counts.push({ sheet, n: rows.length });
      }
      setBusy('Writing file…');
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = `surgery-unit-backup-${todayIst()}.xlsx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await supabase.from('report_log').insert({ unit_id: s.unit!.id, kind: 'backup', format: 'xlsx', parameters: { date: todayIst(), counts } });
      setDone(counts);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(''); }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Backup of all unit records</h2>
        <p className="small" style={{ margin: 0 }}>The free database plan keeps no backups of its own, so download one each week. The app reminds administrators every Monday.</p>
        <div className="msg info small">The file holds identifiable patient records. Keep it on a password-protected hospital computer or drive; do not share it over chat or email.</div>
        <button className="teal" disabled={!!busy} onClick={run}>{busy || 'Download backup (Excel)'}</button>
        <p className="small muted" style={{ margin: 0 }}>Photos and scanned files are listed but not included; they stay in the app’s private storage.</p>
      </div>
      {err && <div className="msg err">{err}</div>}
      {done && (
        <div className="card small">
          <div className="msg ok" style={{ marginBottom: 8 }}>Backup downloaded.</div>
          {done.map((d) => <div key={d.sheet} className="spread"><span>{d.sheet}</span><b>{d.n}</b></div>)}
        </div>
      )}
    </div>
  );
}
