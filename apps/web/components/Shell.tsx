'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';

const NAV = [
  { href: '/', label: 'Dashboard', short: 'Home' },
  { href: '/census/', label: "Today's census", short: 'Census' },
  { href: '/wards/', label: 'Ward board', short: 'Wards' },
  { href: '/patients/', label: 'Patient registry', short: 'Patients' },
  { href: '/users/', label: 'Users and roles', short: 'Users', perm: 'users.manage' },
  { href: '/account/', label: 'My account', short: 'Me' },
];

const PUBLIC_PATHS = ['/login/', '/reset/'];

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const path = usePathname() || '/';
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p.slice(0, -1)));

  useEffect(() => {
    if (!s.loading && !s.session && !isPublic) router.replace('/login/');
  }, [s.loading, s.session, isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (s.loading || !s.session) return <div className="login-wrap"><div style={{ color: '#fff' }}>Loading…</div></div>;
  if (!s.staff) return <ProfileSetup />;

  const items = NAV.filter((n) => !n.perm || s.can(n.perm));
  const on = (href: string) => (href === '/' ? path === '/' : path.startsWith(href.slice(0, -1)));

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <b>SURGERY UNIT OS</b>
          <span>IGMCRI · General Surgery · {s.unit?.name ?? 'No unit'}</span>
        </div>
        <nav className="nav">
          {items.map((n) => <Link key={n.href} href={n.href} className={on(n.href) ? 'on' : ''}>{n.label}</Link>)}
        </nav>
        <div className="side-foot">
          <div>{s.staff.full_name}</div>
          <div style={{ opacity: .7 }}>{s.roles.map(roleName).join(', ') || 'No role yet'}</div>
          {s.units.length > 1 && (
            <select value={s.unit?.id} onChange={(e) => s.setUnit(e.target.value)} style={{ marginTop: 8, fontSize: 12, padding: 4 }}>
              {s.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <TopSearch />
        <main className="content">
          {!s.unit ? <NoRole /> : children}
        </main>
      </div>
      <nav className="bottom-nav">
        {items.filter((n) => !n.perm && n.href !== '/account/').map((n) => <Link key={n.href} href={n.href} className={on(n.href) ? 'on' : ''}>{n.short}</Link>)}
        <Link href="/account/" className={on('/account/') ? 'on' : ''}>Me</Link>
      </nav>
    </div>
  );
}

function TopSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (e: FormEvent) => { e.preventDefault(); if (q.trim()) router.push(`/patients/?q=${encodeURIComponent(q.trim())}`); };
  return (
    <div className="topbar">
      <b className="hide-mobile" style={{ color: 'var(--navy)', fontSize: 14 }}>Search</b>
      <form onSubmit={go}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, UHID, IP number or phone" aria-label="Search patients" />
      </form>
    </div>
  );
}

export function roleName(code: string) {
  return ({ unit_chief: 'Unit Chief', faculty: 'Faculty', senior_resident: 'Senior Resident', postgraduate: 'Postgraduate',
    staff_nurse: 'Staff Nurse', data_entry: 'Data Entry', admin: 'Administrator' } as Record<string, string>)[code] ?? code;
}

function NoRole() {
  const s = useSession();
  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <h1>Waiting for access</h1>
      <p>Your account ({s.session?.user.email}) is set up, but you have not been given a role in any unit yet.</p>
      <p className="muted">Ask the unit administrator to add you under <b>Users and roles</b>. Patient records stay hidden until then.</p>
      <div><button className="ghost" onClick={() => s.refresh()}>Check again</button> <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
    </div>
  );
}

function ProfileSetup() {
  const s = useSession();
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.from('staff').insert({
      user_id: s.session!.user.id, full_name: name.trim(), designation: designation.trim() || null,
      phone: phone.trim() || null, email: s.session!.user.email,
    });
    setBusy(false);
    if (error) setErr(friendlyError(error)); else s.refresh();
  };
  return (
    <div className="login-wrap">
      <form className="login stack" onSubmit={save}>
        <div className="inst">Surgery Unit OS</div>
        <h1>Your staff profile</h1>
        <p className="muted small">This name appears on clinical entries you make.</p>
        <div className="field"><label className="req">Full name</label><input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. A. Kumar" /></div>
        <div className="field"><label>Designation</label><input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Assistant Professor / PG Year 2 / Staff Nurse" /></div>
        <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></div>
        {err && <div className="msg err">{err}</div>}
        <button disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
      </form>
    </div>
  );
}
