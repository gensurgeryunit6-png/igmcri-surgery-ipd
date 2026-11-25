'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Person = { id: string; unit_id: string; full_name: string; designation: string | null; category: string;
  pg_year: number | null; phone: string | null; responsibilities: string | null; user_id: string | null; active: boolean; sort_order: number };

export const CATEGORIES: { v: string; label: string }[] = [
  { v: 'unit_chief', label: 'Unit Chief' }, { v: 'consultant', label: 'Consultant' },
  { v: 'assistant_professor', label: 'Assistant Professor' }, { v: 'senior_resident', label: 'Senior Resident' },
  { v: 'pg', label: 'Postgraduate (PG)' }, { v: 'intern', label: 'Intern' }, { v: 'other', label: 'Other' },
];
export const categoryLabel = (v: string) => CATEGORIES.find((c) => c.v === v)?.label ?? v;

/** People of the unit (active only unless all=true), ordered by category then sort order. */
export function usePersonnel(unitId?: string, all = false) {
  const [list, setList] = useState<Person[]>([]);
  const load = useCallback(async () => {
    if (!unitId) return;
    let q = supabase.from('unit_personnel').select('*').eq('unit_id', unitId);
    if (!all) q = q.eq('active', true);
    const { data } = await q.order('sort_order').order('full_name');
    const rank = (c: string) => CATEGORIES.findIndex((x) => x.v === c);
    setList(((data as Person[]) ?? []).sort((a, b) => rank(a.category) - rank(b.category) || (a.pg_year ?? 0) - (b.pg_year ?? 0) || a.sort_order - b.sort_order));
  }, [unitId, all]);
  useEffect(() => { load(); }, [load]);
  return Object.assign(list, { reload: load }) as Person[] & { reload: () => Promise<void> };
}

/** Last value chosen on this device, so admission forms start with the previous entry. */
export const lastPick = (k: string) => { try { return localStorage.getItem(`unitos.last.${k}`) ?? ''; } catch { return ''; } };
export const savePick = (k: string, v: string) => { try { if (v) localStorage.setItem(`unitos.last.${k}`, v); } catch { /* ignore */ } };
