'use client';
import { supabase } from './supabase';
import type { Census, Inpatient, Ward } from './data';
import { effective, vitalsLine, statusLabel, type Entry, type Amendment } from './rounds';
import { fmtDate, fmtDateTime } from './format';

export const REPORTS = [
  { k: 'ward', label: 'Ward-wise ward-round report', needsWard: true, landscape: true },
  { k: 'unit', label: 'Complete unit ward-round report', landscape: true },
  { k: 'summary', label: 'Daily inpatient summary' },
  { k: 'critical', label: 'Critical patient report' },
  { k: 'pending', label: 'Pending investigations report' },
  { k: 'discharge', label: 'Planned discharge report' },
  { k: 'instructions', label: 'Consultant instruction summary' },
] as const;
export type ReportKind = (typeof REPORTS)[number]['k'];

export type Section = { heading: string; columns: string[]; rows: string[][]; note?: string };
export type Report = { title: string; subtitle: string; sections: Section[] };

const bedLabel = (p: Inpatient) => p.bed ?? 'No bed';
const who = (p: Inpatient) => `${p.full_name} (${p.age_years ?? '?'}/${p.sex})\nIP ${p.ip_number}`;

export type ReportData = {
  pts: Inpatient[]; wards: Ward[]; entries: Entry[]; amendments: Amendment[];
  investigations: { id: string; admission_id: string; name: string; ordered_at: string }[];
  tasks: { id: string; admission_id: string; kind: string; description: string; created_at: string }[];
  census: Census | null;
};

/** Live data for a unit and IST date (yyyy-mm-dd). Saved snapshots have the same shape. */
export async function fetchReportData(unitId: string, date: string): Promise<ReportData> {
  const from = new Date(`${date}T00:00:00+05:30`).toISOString();
  const to = new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 864e5).toISOString();
  const [ptsR, wardsR, entR, invR, taskR, cenR] = await Promise.all([
    supabase.from('v_inpatients').select('*').eq('unit_id', unitId).order('ward_sort').order('bed_sort'),
    supabase.from('wards').select('id, code, name, kind, sort_order').eq('unit_id', unitId).eq('active', true).order('sort_order'),
    supabase.from('ward_round_entries').select('*, author:staff!ward_round_entries_entered_by_fkey(full_name), verifier:staff!ward_round_entries_verified_by_fkey(full_name)')
      .eq('unit_id', unitId).gte('round_at', from).lt('round_at', to).order('round_at'),
    supabase.from('investigations').select('id, admission_id, name, ordered_at').eq('unit_id', unitId).eq('status', 'pending'),
    supabase.from('care_tasks').select('id, admission_id, kind, description, created_at').eq('unit_id', unitId).eq('status', 'open'),
    supabase.from('v_census_today').select('*').eq('unit_id', unitId).maybeSingle(),
  ]);
  for (const r of [ptsR, wardsR, entR, invR, taskR]) if (r.error) throw new Error(r.error.message);
  const entries = (entR.data ?? []) as Entry[];
  const ids = entries.map((e) => e.id);
  const amR = ids.length ? await supabase.from('ward_round_amendments').select('*').in('entry_id', ids) : { data: [] };
  return { pts: (ptsR.data ?? []) as Inpatient[], wards: (wardsR.data ?? []) as Ward[], entries, amendments: (amR.data ?? []) as Amendment[],
    investigations: (invR.data ?? []) as ReportData['investigations'], tasks: (taskR.data ?? []) as ReportData['tasks'], census: (cenR.data as Census) ?? null };
}

export async function buildReport(kind: ReportKind, unitId: string, unitName: string, date: string, wardId?: string): Promise<Report> {
  return buildFromData(kind, await fetchReportData(unitId, date), unitName, date, wardId, true);
}

/** Turn report data (live or saved) into printable sections. */
export function buildFromData(kind: ReportKind, d: ReportData, unitName: string, date: string, wardId?: string, censusIsLiveToday = false): Report {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const invR = { data: d.investigations }, taskR = { data: d.tasks }, cenR = { data: d.census };
  const pts = d.pts;
  const wards = d.wards;
  const eff = d.entries.map((e) => effective(e, d.amendments));
  const latestFor = (a: string) => eff.filter((e) => e.admission_id === a).at(-1);
  const countFor = (a: string) => eff.filter((e) => e.admission_id === a).length;
  const pendingFor = (a: string) => [
    ...((invR.data ?? []) as { admission_id: string; name: string }[]).filter((i) => i.admission_id === a).map((i) => i.name),
    ...((taskR.data ?? []) as { admission_id: string; description: string; kind: string }[]).filter((t) => t.admission_id === a).map((t) => t.description),
  ];

  const roundRows = (list: Inpatient[]) => list.map((p) => {
    const e = latestFor(p.admission_id);
    const n = countFor(p.admission_id);
    const findings = e ? [e.complaints && `C/o ${e.complaints}`, e.general_exam && `GE: ${e.general_exam}`, e.systemic_exam && `SE: ${e.systemic_exam}`,
      e.investigation_summary && `Ix: ${e.investigation_summary}`, e.assessment && `Assessment: ${e.assessment}`].filter(Boolean).join('\n') : '';
    const plan = e ? [e.plan, e.consultant_instructions && `Consultant: ${e.consultant_instructions}`, e.discharge_plan && `Discharge: ${e.discharge_plan}`].filter(Boolean).join('\n') : '';
    return [
      bedLabel(p), who(p),
      `${p.diagnosis ?? '—'}${p.postop_day != null ? `\nPOD ${p.postop_day}` : ''}`,
      e ? statusLabel(e.clinical_status) + (e.amendedFields.length ? ' (amended)' : '') : 'NO ROUND RECORDED',
      e ? vitalsLine(e.vitals) : '',
      findings, plan,
      pendingFor(p.admission_id).join('\n'),
      e ? `${e.author?.full_name ?? ''} ${fmtDateTime(e.round_at).split(', ')[1] ?? ''}${n > 1 ? ` (${n} rounds)` : ''}\n${e.verified_at ? `Verified: ${e.verifier?.full_name ?? ''}` : 'Not verified'}` : '',
    ];
  });
  const ROUND_COLS = ['Bed', 'Patient', 'Diagnosis', 'Status', 'Vitals', 'Complaints & findings', 'Plan & instructions', 'Pending', 'Entered / verified'];
  const byWard = (list: Inpatient[]) => [
    ...wards.map((w) => ({ w: w.name, rows: list.filter((p) => p.ward_id === w.id) })),
    { w: 'No bed allocated', rows: list.filter((p) => !p.ward_id) },
  ].filter((g) => g.rows.length);

  const subtitle = `${unitName} · ${fmtDate(`${date}T06:00:00Z`)}`;
  const label = REPORTS.find((r) => r.k === kind)!.label;

  switch (kind) {
    case 'ward': {
      const w = wards.find((x) => x.id === wardId);
      const list = pts.filter((p) => (wardId === 'none' ? !p.ward_id : p.ward_id === wardId));
      const missing = list.filter((p) => !latestFor(p.admission_id)).length;
      return { title: `${label} — ${w?.name ?? 'No bed allocated'}`, subtitle, sections: [{ heading: `${w?.name ?? 'No bed allocated'} · ${list.length} patients`, columns: ROUND_COLS, rows: roundRows(list),
        note: missing ? `${missing} patient(s) without a round entry on this date.` : 'Every patient has a round entry on this date.' }] };
    }
    case 'unit':
      return { title: label, subtitle, sections: byWard(pts).map((g) => ({ heading: `${g.w} · ${g.rows.length} patients`, columns: ROUND_COLS, rows: roundRows(g.rows) })) };
    case 'summary': {
      const c = cenR.data as Census | null;
      const fig: [string, number | undefined][] = [['Total admitted', c?.total_admitted], ['Male Surgical Ward', c?.male_ward], ['Female Surgical Ward', c?.female_ward],
        ['Special Ward', c?.special_ward], ['Emergency / other beds', c?.other_beds], ['New admissions', c?.new_admissions], ['Postoperative', c?.postoperative],
        ['Critical', c?.critical], ['Awaiting surgery', c?.awaiting_surgery], ['Planned for discharge', c?.planned_discharge], ['Discharges completed', c?.discharged_today]];
      return { title: label, subtitle, sections: [
        { heading: 'Census', columns: ['Measure', 'Count'], rows: fig.map(([k, v]) => [k, String(v ?? '—')]),
          note: censusIsLiveToday && date !== today ? 'Census figures are for today, not the selected date.' : undefined },
        { heading: 'Inpatients', columns: ['Bed', 'Patient', 'Diagnosis', 'Admitted', 'POD', 'Latest status'],
          rows: pts.map((p) => [bedLabel(p), who(p), p.diagnosis ?? '—', fmtDate(p.admitted_at), p.postop_day != null ? String(p.postop_day) : '—', p.last_status ? statusLabel(p.last_status) : '—']) },
      ] };
    }
    case 'critical': {
      const list = pts.filter((p) => ['critical', 'worsening', 'close_monitoring'].includes(p.last_status ?? ''));
      return { title: label, subtitle, sections: [{ heading: `${list.length} patients critical, worsening or under close monitoring`,
        columns: ['Bed', 'Patient', 'Diagnosis', 'Status', 'Latest plan', 'Consultant instructions', 'Last round'],
        rows: list.map((p) => { const e = latestFor(p.admission_id); return [bedLabel(p), who(p), p.diagnosis ?? '—', statusLabel(p.last_status!), e?.plan ?? '', e?.consultant_instructions ?? '', fmtDateTime(p.last_round_at)]; }) }] };
    }
    case 'pending': {
      const map = new Map(pts.map((p) => [p.admission_id, p]));
      const inv = ((invR.data ?? []) as { admission_id: string; name: string; ordered_at: string }[]).map((i) => ({ a: i.admission_id, what: i.name, kind: 'Ordered investigation', since: i.ordered_at }));
      const tk = ((taskR.data ?? []) as { admission_id: string; description: string; kind: string; created_at: string }[]).map((t) => ({ a: t.admission_id, what: t.description, kind: t.kind === 'investigation' ? 'Investigation (from round)' : 'Task (from round)', since: t.created_at }));
      const rows = [...inv, ...tk].filter((x) => map.has(x.a)).sort((x, y) => (map.get(x.a)!.ward_sort ?? 9) - (map.get(y.a)!.ward_sort ?? 9) || (map.get(x.a)!.bed_sort ?? 0) - (map.get(y.a)!.bed_sort ?? 0));
      return { title: label, subtitle: `${unitName} · as of now`, sections: [{ heading: `${rows.length} pending items`, columns: ['Bed', 'Patient', 'Pending', 'Type', 'Since'],
        rows: rows.map((x) => { const p = map.get(x.a)!; return [bedLabel(p), who(p), x.what, x.kind, fmtDate(x.since)]; }) }] };
    }
    case 'discharge': {
      const list = pts.filter((p) => (p.planned_discharge_on && p.planned_discharge_on <= date) || latestFor(p.admission_id)?.discharge_plan);
      return { title: label, subtitle, sections: [{ heading: `${list.length} patients`, columns: ['Bed', 'Patient', 'Diagnosis', 'Planned date', 'Discharge plan'],
        rows: list.map((p) => [bedLabel(p), who(p), p.diagnosis ?? '—', p.planned_discharge_on ? fmtDate(p.planned_discharge_on) : '—', latestFor(p.admission_id)?.discharge_plan ?? '']) }] };
    }
    case 'instructions': {
      const map = new Map(pts.map((p) => [p.admission_id, p]));
      const list = eff.filter((e) => e.consultant_instructions && map.has(e.admission_id));
      return { title: label, subtitle, sections: [{ heading: `${list.length} instructions`, columns: ['Bed', 'Patient', 'Time', 'Instruction', 'Recorded by'],
        rows: list.map((e) => { const p = map.get(e.admission_id)!; return [bedLabel(p), who(p), fmtDateTime(e.round_at), e.consultant_instructions!, e.author?.full_name ?? '']; }) }] };
    }
  }
}

/** Download the report as a real .xlsx workbook, one sheet per section. */
export async function downloadXlsx(r: Report, fileName: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Surgery Unit OS';
  r.sections.forEach((s, i) => {
    const ws = wb.addWorksheet((s.heading.split(' · ')[0] || `Sheet ${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet ${i + 1}`);
    ws.addRow([r.title]).font = { bold: true, size: 13 };
    ws.addRow([`IGMCRI · Department of General Surgery · ${r.subtitle}`]);
    ws.addRow([s.heading]).font = { bold: true };
    const head = ws.addRow(s.columns);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12305A' } }; });
    s.rows.forEach((row) => { const x = ws.addRow(row); x.alignment = { wrapText: true, vertical: 'top' }; });
    if (s.note) ws.addRow([s.note]).font = { italic: true };
    ws.columns.forEach((c, j) => { c.width = Math.min(48, Math.max(10, ...[s.columns[j] ?? '', ...s.rows.map((row) => (row[j] ?? '').split('\n')[0])].map((t) => t.length + 2))); });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
