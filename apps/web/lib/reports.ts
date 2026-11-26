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

// ---------------------------------------------------------------- workflow reports (live data only)
export const WORKFLOW_REPORTS = [
  { k: 'daily', label: 'Daily unit report', landscape: true },
  { k: 'otday', label: 'OT lists for the day', landscape: true },
  { k: 'preop', label: 'Pre-op work-up (all booked patients)', landscape: true },
  { k: 'waitlist', label: 'Waiting list (Major, Minor, Endoscopy)', landscape: true },
] as const;
export type WorkflowKind = (typeof WORKFLOW_REPORTS)[number]['k'];
export const isWorkflowKind = (k: string): k is WorkflowKind => WORKFLOW_REPORTS.some((r) => r.k === k);

const SVC: Record<string, string> = { major: 'Major OT', minor: 'Minor OT', endoscopy: 'Endoscopy' };
const yes = (ok: boolean, label: string) => `${ok ? '✓' : '✗'} ${label}`;
type WRow = { id: string; list_type: string; priority: string; planned_procedure: string; diagnosis: string | null; planned_date: string | null;
  status: string; contact_status: string; contact_attempts: number; preop_ready: boolean; pac_status: string; physician_status: string;
  consent_status: string; blood_status: string; investigations_ok: boolean; full_name: string; uhid: string; age_years: number | null; sex: string;
  phone: string | null; ip_number: string | null; is_admitted: boolean | null; bed: string | null; pg_name: string | null };
type CRow = { procedure: string; diagnosis: string | null; anaesthesia: string | null; surgeon: string | null; status: string; status_reason: string | null;
  procedure_done: string | null; manual_name: string | null; manual_age_sex: string | null; seq: number;
  patients: { full_name: string; age_years: number | null; sex: string; uhid: string } | null; admissions: { ip_number: string } | null;
  ot_lists: { service: string; session: string; ot_room: string } };

export async function buildWorkflowReport(kind: WorkflowKind, unitId: string, unitName: string, date: string): Promise<Report> {
  const subtitle = `${unitName} · ${fmtDate(`${date}T06:00:00Z`)}`;
  const label = WORKFLOW_REPORTS.find((r) => r.k === kind)!.label;
  const caseRows = async () => {
    const r = await supabase.from('ot_cases').select('procedure, diagnosis, anaesthesia, surgeon, status, status_reason, procedure_done, manual_name, manual_age_sex, seq, patients(full_name, age_years, sex, uhid), admissions(ip_number), ot_lists!inner(service, session, ot_room, list_date, unit_id)')
      .eq('ot_lists.unit_id', unitId).eq('ot_lists.list_date', date).order('seq');
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as unknown as CRow[];
  };
  const caseSection = (rows: CRow[], svc: string) => {
    const list = rows.filter((c) => c.ot_lists.service === svc);
    return { heading: `${SVC[svc]} · ${list.length}`, columns: ['No', 'Patient', 'IP/UHID', 'Diagnosis', 'Procedure', 'Anaesthesia', 'Surgeon', 'Status'],
      rows: list.map((c, i) => [String(i + 1), c.patients ? `${c.patients.full_name} (${c.patients.age_years ?? '?'}/${c.patients.sex})` : `${c.manual_name ?? ''} (${c.manual_age_sex ?? ''})`,
        c.admissions?.ip_number ? `IP ${c.admissions.ip_number}` : c.patients?.uhid ?? '', c.diagnosis ?? '', c.procedure_done ?? c.procedure, c.anaesthesia ?? '', c.surgeon ?? '',
        c.status === 'planned' ? 'Planned' : c.status === 'done' ? 'Done' : `${c.status === 'postponed' ? 'Postponed' : 'Cancelled'}: ${c.status_reason ?? ''}`]) };
  };

  if (kind === 'otday') {
    const rows = await caseRows();
    return { title: label, subtitle, sections: ['major', 'minor', 'endoscopy'].map((s) => caseSection(rows, s)) };
  }

  if (kind === 'preop' || kind === 'waitlist') {
    const r = await supabase.from('v_waiting_list').select('*').eq('unit_id', unitId).in('status', ['waiting', 'postponed', 'scheduled']).order('planned_date', { nullsFirst: false });
    if (r.error) throw new Error(r.error.message);
    const all = (r.data ?? []) as WRow[];
    if (kind === 'preop') {
      return { title: label, subtitle: `${unitName} · as of now`, sections: ['major', 'minor', 'endoscopy'].map((sv) => { const list = all.filter((w) => w.list_type === sv); return { heading: `${SVC[sv]} · ${list.length} booked · ${list.filter((w) => !w.preop_ready).length} work-up pending`,
        columns: ['Bed / OPD', 'Patient', 'Procedure', 'Planned', 'Investigations', 'PAC', 'Physician', 'Consent', 'Blood', 'Responsible PG'],
        rows: list.map((w) => [w.is_admitted ? (w.bed ?? 'Admitted') : 'OPD', `${w.full_name} (${w.age_years ?? '?'}/${w.sex})\n${w.ip_number && w.is_admitted ? `IP ${w.ip_number}` : `UHID ${w.uhid}`}`, w.planned_procedure,
          w.planned_date ? fmtDate(w.planned_date) : '—', yes(w.investigations_ok, ''), w.pac_status.replace(/_/g, ' '), w.physician_status.replace(/_/g, ' '),
          w.consent_status, w.blood_status.replace(/_/g, ' '), w.pg_name ?? '']) }; }) };
    }
    return { title: label, subtitle: `${unitName} · as of now`, sections: ['major', 'minor', 'endoscopy'].map((s) => {
      const list = all.filter((w) => w.list_type === s);
      return { heading: `${SVC[s]} · ${list.length}`, columns: ['Patient', 'UHID', 'Mobile', 'Procedure', 'Priority', 'Planned', 'Status', 'Call', 'Pre-op'],
        rows: list.map((w) => [`${w.full_name} (${w.age_years ?? '?'}/${w.sex})`, w.uhid, w.phone ?? '', w.planned_procedure, w.priority, w.planned_date ? fmtDate(w.planned_date) : '—',
          w.status, `${w.contact_status.replace(/_/g, ' ')}${w.contact_attempts ? ` (${w.contact_attempts})` : ''}`, w.preop_ready ? 'Ready' : 'Incomplete']) };
    }) };
  }

  // daily unit report
  const from = new Date(`${date}T00:00:00+05:30`).toISOString();
  const to = new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 864e5).toISOString();
  const [d, cases, adm, dis, tasks] = await Promise.all([
    fetchReportData(unitId, date),
    caseRows(),
    supabase.from('admissions').select('ip_number, admitted_at, admission_type, patients(full_name, age_years, sex)').eq('unit_id', unitId).gte('admitted_at', from).lt('admitted_at', to).order('admitted_at'),
    supabase.from('admissions').select('ip_number, discharged_at, status, patients(full_name, age_years, sex)').eq('unit_id', unitId).gte('discharged_at', from).lt('discharged_at', to).order('discharged_at'),
    supabase.from('care_tasks').select('description, status, due_on, admission_id').eq('unit_id', unitId).in('status', ['open', 'in_progress']).order('created_at'),
  ]);
  const c = d.census;
  const pts = d.pts;
  const map = new Map(pts.map((p) => [p.admission_id, p]));
  const fig: [string, number | undefined][] = [['Total inpatients', c?.total_admitted], ['New admissions', c?.new_admissions], ['Discharges', c?.discharged_today],
    ['Male Surgical Ward', c?.male_ward], ['Female Surgical Ward', c?.female_ward], ['Special Ward', c?.special_ward], ['Emergency / other beds', c?.other_beds],
    ['Awaiting surgery (pre-op)', c?.awaiting_surgery], ['Post-operative', c?.postoperative], ['Critical', c?.critical], ['Planned discharge', c?.planned_discharge]];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const crit = buildFromData('critical', d, unitName, date);
  type A = { ip_number: string; admitted_at?: string; discharged_at?: string; admission_type?: string; status?: string; patients: { full_name: string; age_years: number | null; sex: string } };
  return { title: label, subtitle, sections: [
    { heading: 'Census', columns: ['Measure', 'Count'], rows: fig.map(([k, v]) => [k, String(v ?? '—')]),
      note: date !== today ? 'Census figures are as of now, not the selected date.' : undefined },
    { heading: `New admissions · ${(adm.data ?? []).length}`, columns: ['IP', 'Patient', 'Type', 'Time'],
      rows: ((adm.data ?? []) as unknown as A[]).map((a) => [a.ip_number, `${a.patients.full_name} (${a.patients.age_years ?? '?'}/${a.patients.sex})`, a.admission_type ?? '', fmtDateTime(a.admitted_at)]) },
    { heading: `Discharges · ${(dis.data ?? []).length}`, columns: ['IP', 'Patient', 'Outcome', 'Time'],
      rows: ((dis.data ?? []) as unknown as A[]).map((a) => [a.ip_number, `${a.patients.full_name} (${a.patients.age_years ?? '?'}/${a.patients.sex})`, (a.status ?? '').replace(/_/g, ' '), fmtDateTime(a.discharged_at)]) },
    caseSection(cases, 'major'), caseSection(cases, 'minor'), caseSection(cases, 'endoscopy'),
    { heading: `Post-operative patients · ${pts.filter((p) => p.is_postop).length}`, columns: ['Bed', 'Patient', 'Diagnosis', 'POD', 'Status'],
      rows: pts.filter((p) => p.is_postop).map((p) => [bedLabel(p), who(p), p.diagnosis ?? '—', p.postop_day != null ? String(p.postop_day) : 'date not verified', p.last_status ? statusLabel(p.last_status) : '—']) },
    { heading: `Pending reports · ${d.investigations.length}`, columns: ['Bed', 'Patient', 'Investigation', 'Ordered'],
      rows: d.investigations.filter((i) => map.has(i.admission_id)).map((i) => { const p = map.get(i.admission_id)!; return [bedLabel(p), who(p), i.name, fmtDate(i.ordered_at)]; }) },
    { heading: `Pending tasks · ${(tasks.data ?? []).length}`, columns: ['Task', 'Patient', 'Status', 'Due'],
      rows: ((tasks.data ?? []) as { description: string; status: string; due_on: string | null; admission_id: string | null }[]).map((t) => [t.description,
        t.admission_id && map.has(t.admission_id) ? `${bedLabel(map.get(t.admission_id)!)} ${map.get(t.admission_id)!.full_name}` : '—', t.status === 'in_progress' ? 'In progress' : 'Pending', t.due_on ? fmtDate(t.due_on) : '']) },
    { ...crit.sections[0], heading: `Important clinical updates · ${crit.sections[0].rows.length} critical, worsening or under close monitoring` },
  ] };
}
