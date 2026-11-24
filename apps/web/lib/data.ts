'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export type Census = {
  unit_id: string; total_admitted: number; male_ward: number; female_ward: number; special_ward: number;
  other_beds: number; no_bed: number; new_admissions: number; postoperative: number; critical: number;
  awaiting_surgery: number; planned_discharge: number; discharged_today: number; rounds_pending: number;
};

export type Inpatient = {
  admission_id: string; unit_id: string; ip_number: string; admitted_at: string; admission_type: string;
  planned_discharge_on: string | null; assigned_pg_id: string | null; consultant_id: string | null; patient_id: string; uhid: string; full_name: string; age_years: number | null;
  sex: string; allergies: string | null; bed_id: string | null; bed: string | null; ward_id: string | null; ward: string | null;
  ward_kind: string | null; ward_sort: number | null; bed_sort: number | null; diagnosis: string | null;
  last_status: string | null; last_round_at: string | null; rounds_today: number; unverified_today: number;
  open_tasks: number; postop_day: number | null; is_postop: boolean; awaiting_surgery: boolean;
};

export type Ward = { id: string; code: string; name: string; kind: string; sort_order: number };
export type Bed = { id: string; ward_id: string; label: string; sort_order: number; active: boolean };

/** Re-run `fetcher` whenever any of `tables` changes (Supabase Realtime), plus on demand. */
export function useLive<T>(fetcher: () => Promise<T>, tables: string[], deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fetcher);
  ref.current = fetcher;

  const reload = useCallback(async () => {
    try { setData(await ref.current()); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    reload();
    const ch = supabase.channel(`live-${tables.join('-')}-${Math.random().toString(36).slice(2)}`);
    tables.forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => reload()));
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}

export async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const LIVE_TABLES = ['admissions', 'bed_assignments', 'ward_round_entries', 'diagnoses', 'surgeries', 'surgery_waitlist'];
