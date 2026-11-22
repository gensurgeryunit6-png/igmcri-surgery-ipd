'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { roleName } from '@/components/Shell';

export default function AccountPage() {
  const s = useSession();
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>My account</h1>
      <div className="card stack">
        <div><label>Name</label>{s.staff?.full_name}</div>
        <div><label>Designation</label>{s.staff?.designation ?? '—'}</div>
        <div><label>Email</label>{s.session?.user.email}</div>
        <div><label>Unit</label>
          {s.units.length > 1
            ? <select value={s.unit?.id} onChange={(e) => s.setUnit(e.target.value)}>{s.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            : s.unit?.name ?? '—'}
        </div>
        <div><label>Roles</label>{s.roles.map(roleName).join(', ') || 'None yet'}</div>
      </div>
      {s.can('users.manage') && <Link className="btn ghost" href="/users/">Users and roles</Link>}
      <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}
