'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Colleague = { user_id: string; full_name: string; designation: string | null; roles: string[] };

/** Active staff of a unit with their roles, for consultant / PG pickers. */
export function useColleagues(unitId?: string) {
  const [list, setList] = useState<Colleague[]>([]);
  useEffect(() => {
    if (!unitId) return;
    supabase.from('unit_members').select('role_code, staff(user_id, full_name, designation)')
      .eq('unit_id', unitId).eq('active', true)
      .then(({ data }) => {
        const map = new Map<string, Colleague>();
        (data ?? []).forEach((r: any) => {
          if (!r.staff) return;
          const c = map.get(r.staff.user_id) ?? { ...r.staff, roles: [] };
          c.roles.push(r.role_code);
          map.set(r.staff.user_id, c);
        });
        setList([...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      });
  }, [unitId]);
  return list;
}

export const isFaculty = (c: Colleague) => c.roles.some((r) => ['unit_chief', 'faculty'].includes(r));
export const isPG = (c: Colleague) => c.roles.some((r) => ['postgraduate', 'senior_resident'].includes(r));
