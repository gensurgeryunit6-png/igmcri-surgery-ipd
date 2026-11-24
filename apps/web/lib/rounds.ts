// Shared ward-round helpers: field definitions, amendment overlay, formatting.

export const STATUSES = [
  { v: 'stable', label: 'Stable' },
  { v: 'improving', label: 'Improving' },
  { v: 'worsening', label: 'Worsening' },
  { v: 'critical', label: 'Critical' },
  { v: 'close_monitoring', label: 'Close monitoring' },
] as const;

export const ROUND_TYPES = [
  { v: 'morning', label: 'Morning' },
  { v: 'evening', label: 'Evening' },
  { v: 'consultant', label: 'Consultant' },
  { v: 'night', label: 'Night' },
  { v: 'other', label: 'Other' },
] as const;

/** Text fields of an entry, in the order they are written and printed. `main` ones show by default. */
export const TEXT_FIELDS = [
  { k: 'complaints', label: 'Current complaints', main: true },
  { k: 'general_exam', label: 'General examination', main: false },
  { k: 'systemic_exam', label: 'Systemic examination', main: false },
  { k: 'investigation_summary', label: 'Relevant investigation results', main: false },
  { k: 'current_treatment', label: 'Current treatment', main: false },
  { k: 'assessment', label: 'Clinical assessment', main: false },
  { k: 'plan', label: 'Plan for the day', main: true },
  { k: 'consultant_instructions', label: 'Consultant instructions', main: false },
  { k: 'discharge_plan', label: 'Discharge plan', main: false },
] as const;
export type TextField = (typeof TEXT_FIELDS)[number]['k'];

export const VITALS = [
  { k: 'pulse', label: 'Pulse', mode: 'numeric' },
  { k: 'bp', label: 'BP', mode: 'text' },
  { k: 'temp', label: 'Temp °F', mode: 'decimal' },
  { k: 'spo2', label: 'SpO₂ %', mode: 'numeric' },
  { k: 'rr', label: 'RR', mode: 'numeric' },
  { k: 'urine', label: 'Urine ml', mode: 'numeric' },
  { k: 'drain', label: 'Drain ml', mode: 'numeric' },
] as const;

export type Entry = {
  id: string; admission_id: string; unit_id: string; round_at: string; round_type: string; postop_day: number | null;
  clinical_status: string; vitals: Record<string, string>; entered_by: string; verified_by: string | null; verified_at: string | null;
  author?: { full_name: string } | null; verifier?: { full_name: string } | null;
} & Record<TextField, string | null>;

export type Amendment = { id: string; entry_id: string; field: string; old_value: string | null; new_value: string | null;
  reason: string; amended_at: string; amended_by: string; author?: { full_name: string } | null };

/** The entry as it currently reads: latest amendment per field wins. Originals are never changed. */
export function effective(e: Entry, amendments: Amendment[]): Entry & { amendedFields: string[] } {
  const mine = amendments.filter((a) => a.entry_id === e.id).sort((a, b) => a.amended_at.localeCompare(b.amended_at));
  const out: any = { ...e, vitals: { ...(e.vitals ?? {}) }, amendedFields: [] as string[] };
  for (const a of mine) {
    if (a.field === 'vitals') { try { out.vitals = JSON.parse(a.new_value ?? '{}'); } catch { /* keep */ } }
    else out[a.field] = a.new_value;
    if (!out.amendedFields.includes(a.field)) out.amendedFields.push(a.field);
  }
  return out;
}

export function vitalsLine(v: Record<string, string> | null | undefined) {
  if (!v) return '';
  return VITALS.filter((x) => v[x.k] !== undefined && v[x.k] !== '').map((x) => `${x.label.replace(/ .*/, '')} ${v[x.k]}`).join(' · ');
}

export const statusLabel = (s: string) => STATUSES.find((x) => x.v === s)?.label ?? s;
