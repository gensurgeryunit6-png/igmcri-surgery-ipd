'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Staff = { user_id: string; full_name: string; designation: string | null; email: string | null };
export type Unit = { id: string; code: string; name: string; department_id: string };
type Membership = { unit_id: string; role_code: string };

type Ctx = {
  loading: boolean;
  session: Session | null;
  staff: Staff | null;
  units: Unit[];
  unit: Unit | null;
  institutionId: string | null;
  roles: string[];
  perms: Set<string>;
  can: (perm: string) => boolean;
  setUnit: (id: string) => void;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rolePerms, setRolePerms] = useState<{ role_code: string; permission_code: string }[]>([]);
  const [institutionId, setInstitutionId] = useState<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setStaff(null); setMemberships([]); setUnits([]); setLoading(false);
      return;
    }
    const uid = s.user.id;
    const [st, mem, rp, inst] = await Promise.all([
      supabase.from('staff').select('user_id, full_name, designation, email').eq('user_id', uid).maybeSingle(),
      supabase.from('unit_members').select('unit_id, role_code').eq('user_id', uid).eq('active', true),
      supabase.from('role_permissions').select('role_code, permission_code'),
      supabase.from('institutions').select('id').eq('code', 'IGMCRI').maybeSingle(),
    ]);
    setStaff((st.data as Staff) ?? null);
    const m = (mem.data as Membership[]) ?? [];
    setMemberships(m);
    setRolePerms(rp.data ?? []);
    setInstitutionId(inst.data?.id ?? null);
    const ids = [...new Set(m.map((x) => x.unit_id))];
    if (ids.length) {
      const u = await supabase.from('units').select('id, code, name, department_id').in('id', ids);
      const list = (u.data as Unit[]) ?? [];
      setUnits(list);
      const saved = typeof window !== 'undefined' ? localStorage.getItem('unitos.unit') : null;
      setUnitId(list.find((x) => x.id === saved)?.id ?? list[0]?.id ?? null);
    } else {
      setUnits([]); setUnitId(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const unit = units.find((u) => u.id === unitId) ?? null;
  const roles = memberships.filter((m) => m.unit_id === unitId).map((m) => m.role_code);
  const perms = new Set(rolePerms.filter((r) => roles.includes(r.role_code)).map((r) => r.permission_code));

  const value: Ctx = {
    loading, session, staff, units, unit, institutionId, roles, perms,
    can: (p) => perms.has(p),
    setUnit: (id) => { localStorage.setItem('unitos.unit', id); setUnitId(id); },
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session); },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
