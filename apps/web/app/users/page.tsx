'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { roleName } from '@/components/Shell';

type Member = { id: string; user_id: string; role_code: string; active: boolean };
type StaffRow = { user_id: string; full_name: string; designation: string | null; email: string | null; active: boolean };
const ROLES = ['unit_chief', 'faculty', 'senior_resident', 'postgraduate', 'staff_nurse', 'data_entry', 'admin'];

export default function UsersPage() {
  const s = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('postgraduate');
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const m = await supabase.from('unit_members').select('id, user_id, role_code, active').eq('unit_id', s.unit!.id);
    setMembers((m.data as Member[]) ?? []);
    const ids = [...new Set((m.data ?? []).map((x: Member) => x.user_id))];
    const st = ids.length ? await supabase.from('staff').select('user_id, full_name, designation, email, active').in('user_id', ids) : { data: [] };
    setStaff(((st.data as StaffRow[]) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }, [s.unit]);
  useEffect(() => { if (s.unit) load(); }, [s.unit, load]);

  if (!s.can('users.manage')) return <div className="msg err">Only administrators can manage users.</div>;

  const run = async (p: PromiseLike<{ error: any }>, ok: string) => {
    const { error } = await p;
    setMsg(error ? { kind: 'err', text: friendlyError(error) } : { kind: 'ok', text: ok });
    load();
  };

  const add = async () => {
    setMsg(null);
    const { data, error } = await supabase.rpc('find_staff_by_email', { p_email: email.trim() });
    if (error) return setMsg({ kind: 'err', text: friendlyError(error) });
    const u = (data as { user_id: string; full_name: string }[])?.[0];
    if (!u) return setMsg({ kind: 'err', text: 'No staff profile with that email. Ask them to open the app, create an account and complete their profile first.' });
    await run(supabase.from('unit_members').insert({ unit_id: s.unit!.id, user_id: u.user_id, role_code: role }), `${u.full_name} added as ${roleName(role)}.`);
    setEmail('');
  };

  return (
    <div className="stack">
      <div className="muted small">{s.unit?.name}</div>
      <div className="card stack">
        <h2>Give someone access</h2>
        <p className="muted small" style={{ margin: 0 }}>They first create an account in the app and fill in their profile. Then add their email here with a role.</p>
        <div className="grid g3">
          <input type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}</select>
          <button onClick={add} disabled={!email.includes('@')}>Add to unit</button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Name</th><th className="hide-mobile">Email</th><th>Roles</th><th></th></tr></thead>
          <tbody>
            {staff.map((p) => {
              const mine = members.filter((m) => m.user_id === p.user_id && m.active);
              const self = p.user_id === s.session?.user.id;
              return (
                <tr key={p.user_id}>
                  <td><b>{p.full_name}</b><div className="muted small">{p.designation}</div></td>
                  <td className="hide-mobile small">{p.email}</td>
                  <td>{mine.map((m) => (
                    <span key={m.id} className="badge teal" style={{ marginRight: 4 }}>{roleName(m.role_code)}
                      {!(self && m.role_code === 'admin') && <a href="#" style={{ marginLeft: 6 }} title="Remove role"
                        onClick={(e) => { e.preventDefault(); run(supabase.from('unit_members').delete().eq('id', m.id), 'Role removed.'); }}>×</a>}
                    </span>))}</td>
                  <td>
                    <select value="" onChange={(e) => e.target.value && run(supabase.from('unit_members').insert({ unit_id: s.unit!.id, user_id: p.user_id, role_code: e.target.value }), 'Role added.')} style={{ width: 'auto', padding: '4px 8px' }}>
                      <option value="">Add role…</option>
                      {ROLES.filter((r) => !mine.some((m) => m.role_code === r)).map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Every change here is recorded in the audit log. Admins cannot remove their own admin role, so a unit is never left without one.</p>
    </div>
  );
}
