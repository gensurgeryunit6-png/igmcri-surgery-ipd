'use client';
import { supabase } from './supabase';

export const SERVICES = [
  { v: 'major', label: 'Major OT' }, { v: 'minor', label: 'Minor OT' }, { v: 'endoscopy', label: 'Endoscopy' }, { v: 'usg', label: 'USG' },
] as const;
export const serviceLabel = (v: string) => SERVICES.find((s) => s.v === v)?.label ?? v;

export const PRIORITY: Record<string, string> = { routine: 'Routine', urgent: 'Urgent', emergency: 'Emergency' };
export const LATERALITY: Record<string, string> = { left: 'Left', right: 'Right', bilateral: 'Bilateral', na: 'Not applicable' };
export const VISIT_TYPE: Record<string, string> = { new: 'New', follow_up: 'Follow-up', post_op: 'Post-op', referral: 'Referral' };
export const DECISION: Record<string, string> = {
  follow_up: 'Follow-up in OPD', admit: 'Admit', book: 'Book procedure', discharge: 'Discharged from OPD', none: 'No plan yet',
};
export const BOOKING_STATUS: Record<string, string> = {
  waiting: 'Waiting', scheduled: 'On OT list', postponed: 'Postponed', completed: 'Done', cancelled: 'Cancelled',
};
export const CONTACT: Record<string, string> = {
  not_contacted: 'Not called yet', called: 'Called', willing: 'Willing', not_willing: 'Not willing',
  not_reachable: 'Not reachable', not_required: 'Not required',
};
export const CALL_OUTCOMES = ['willing', 'not_reachable', 'not_willing', 'called', 'not_required'] as const;
export const SESSIONS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', emergency: 'Emergency' };
export const CASE_STATUS: Record<string, string> = { planned: 'Planned', done: 'Done', postponed: 'Postponed', cancelled: 'Cancelled' };

export const TASK_STATUS: Record<string, string> = {
  open: 'Pending', in_progress: 'In progress', done: 'Completed', verified: 'Verified', cancelled: 'Cancelled',
};
export const TASK_KIND: Record<string, string> = {
  task: 'Clinical task', investigation: 'Collect report', dressing: 'Supervised dressing', preop: 'Pre-op work-up',
  ot_list: 'Update OT list', opd: 'Assist in OPD', records: 'Update records', admin: 'Administrative',
};

/** Pre-op checklist items, each with how to read "done". */
export const PREOP_ITEMS = [
  { k: 'investigations_ok', label: 'Investigations complete', ok: (b: Booking) => b.investigations_ok },
  { k: 'pac_status', label: 'Anaesthesia fitness (PAC)', ok: (b: Booking) => b.pac_status === 'fit' || b.pac_status === 'fit_high_risk' },
  { k: 'physician_status', label: 'Physician fitness', ok: (b: Booking) => b.physician_status !== 'pending' },
  { k: 'consent_status', label: 'Consent', ok: (b: Booking) => b.consent_status === 'taken' },
  { k: 'blood_status', label: 'Blood', ok: (b: Booking) => b.blood_status !== 'pending' },
] as const;

export type Booking = {
  id: string; unit_id: string; patient_id: string; admission_id: string | null; list_type: string; priority: string;
  diagnosis: string | null; planned_procedure: string; laterality: string | null; planned_date: string | null;
  status: string; status_reason: string | null; contact_status: string; contact_attempts: number; last_contacted_at: string | null;
  responsible_pg_person_id: string | null; indication: string | null; investigations_ok: boolean; imaging: string | null;
  serology: string | null; pac_status: string; physician_status: string; consent_status: string; blood_status: string;
  anaesthesia_plan: string | null; position: string | null; preparation: string | null; special_instructions: string | null;
  preop_ready: boolean; notes: string | null; opd_visit_id: string | null; created_at: string;
};

export type WaitRow = {
  id: string; unit_id: string; patient_id: string; admission_id: string | null; list_type: string; priority: string;
  diagnosis: string | null; planned_procedure: string; laterality: string | null; planned_date: string | null; status: string;
  status_reason: string | null; contact_status: string; contact_attempts: number; last_contacted_at: string | null; created_at: string;
  preop_ready: boolean; pac_status: string; physician_status: string; consent_status: string; blood_status: string; investigations_ok: boolean;
  pg_name: string | null; full_name: string; uhid: string; age_years: number | null; sex: string; phone: string | null; phone_2: string | null;
  op_number: string | null; ip_number: string | null; is_admitted: boolean | null; bed: string | null; ward: string | null; on_list_id: string | null;
};

export type OtList = {
  id: string; unit_id: string; service: string; list_date: string; ot_room: string; session: string;
  consultant_person_id: string | null; anaesthetist: string | null; notes: string | null; status: string; finalised_at: string | null;
};

export type OtCase = {
  id: string; list_id: string; booking_id: string | null; patient_id: string | null; admission_id: string | null; seq: number;
  manual_name: string | null; manual_age_sex: string | null; manual_ip_op: string | null; diagnosis: string | null; procedure: string;
  laterality: string | null; anaesthesia: string | null; surgeon: string | null; assistants: string | null; position: string | null;
  serology: string | null; special_requirements: string | null; status: string; status_reason: string | null;
  procedure_done: string | null; findings: string | null; postop_diagnosis: string | null; complications: string | null; done_at: string | null;
  patients?: { full_name: string; uhid: string; age_years: number | null; sex: string; phone: string | null; op_number: string | null } | null;
  admissions?: { ip_number: string } | null;
};

export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** tel: link for a phone number (digits and + only). */
export const telHref = (p?: string | null) => (p ? `tel:${p.replace(/[^\d+]/g, '')}` : undefined);

/** Endoscopy and USG are reported (findings, impression), not operated. */
export const isReportService = (s: string) => s === 'endoscopy' || s === 'usg';

export const WORKFLOW_TABLES = ['surgery_waitlist', 'ot_lists', 'ot_cases', 'booking_calls', 'opd_visits', 'care_tasks', 'investigations'];

/** Case name/age/IP for display, whether from a patient record or typed by hand. */
export function caseWho(c: OtCase) {
  if (c.patients) return { name: c.patients.full_name, ageSex: `${c.patients.age_years ?? '?'}/${c.patients.sex}`, id: c.admissions?.ip_number ? `IP ${c.admissions.ip_number}` : `UHID ${c.patients.uhid}` };
  return { name: c.manual_name ?? '', ageSex: c.manual_age_sex ?? '', id: c.manual_ip_op ?? '' };
}

export async function loadOtList(id: string) {
  const [l, c] = await Promise.all([
    supabase.from('ot_lists').select('*').eq('id', id).single(),
    supabase.from('ot_cases').select('*, patients(full_name, uhid, age_years, sex, phone, op_number), admissions(ip_number)').eq('list_id', id).order('seq'),
  ]);
  if (l.error) throw new Error(l.error.message);
  if (c.error) throw new Error(c.error.message);
  return { list: l.data as OtList, cases: (c.data as OtCase[]) ?? [] };
}
