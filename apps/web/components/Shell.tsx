'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { Icon } from './Icon';

// Title shown in the app bar for each screen.
const TITLES: [string, string][] = [
  ['/rounds', 'Ward rounds'], ['/round', 'Ward round'], ['/verify', 'Review rounds'], ['/reports', 'Downloads'],
  ['/census', 'Inpatients'], ['/wards', 'Ward board'], ['/patients', 'Patients'], ['/patient', 'Patient'],
  ['/users', 'User management'], ['/more', 'More'], ['/notifications', 'Notifications'], ['/settings', 'Wards and beds'], ['/discharge', 'Discharge summary'], ['/saved-reports', 'Saved morning reports'], ['/account', 'My account'], ['/personnel', 'Unit personnel'], ['/opd-visit', 'OPD visit'], ['/opd', 'OPD'], ['/waiting', 'Waiting list'], ['/booking', 'Booking'], ['/ot-list', 'OT list'], ['/ot-today', 'Today’s cases'], ['/ot', 'OT lists'], ['/preop', 'Pre-op work-up'], ['/tasks', 'Tasks'], ['/clinical', 'Clinical'], ['/backup', 'Backup'], ['/duty', 'Duty report'], ['/leave', 'Leave'], ['/protocols', 'Unit protocols'], ['/help', 'Help'], ['/theatre', 'Operation theatre'],
];
const PUBLIC_PATHS = ['/login', '/reset'];

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const path = (usePathname() || '/').replace(/\/$/, '') || '/';
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const isHome = path === '/';

  useEffect(() => {
    if (!s.loading && !s.session && !isPublic) router.replace('/login/');
  }, [s.loading, s.session, isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (s.loading || !s.session) return <div className="login-wrap"><div style={{ color: '#fff' }}>Loading…</div></div>;
  if (!s.staff) return <ProfileSetup />;

  const title = TITLES.find(([p]) => path.startsWith(p))?.[1] ?? 'Surgery Unit OS';

  return (
    <div className="app">
      <header className="appbar">
        {isHome ? (
          <div className="appbar-brand">
            <b>SURGERY UNIT OS</b>
            <span>IGMCRI · General Surgery · {s.unit?.name ?? ''}</span>
          </div>
        ) : (
          <>
            <button className="icon-btn" onClick={() => router.back()} aria-label="Back"><Icon name="back" /></button>
            <h1 className="appbar-title">{title}</h1>
          </>
        )}
        <div className="appbar-actions">
          {!path.startsWith('/patients') && <Link className="icon-btn" href="/patients/" aria-label="Search patients"><Icon name="search" /></Link>}
          {isHome && <Link className="icon-btn" href="/account/" aria-label="My account"><Icon name="user" /></Link>}
        </div>
      </header>
      <main className="screen">
        {!s.unit ? <NoRole /> : children}
      </main>
      {s.unit && <Dock path={path} canAdd={s.can('patient.write')} />}
    </div>
  );
}

/** Bottom dock: Home, Clinical, Theatre, Downloads, More; floating + to register a new patient. */
function Dock({ path, canAdd }: { path: string; canAdd: boolean }) {
  const items = [
    { href: '/', label: 'Home', icon: 'homeRing', on: path === '/' },
    { href: '/clinical/', label: 'Clinical', icon: 'stetho', on: ['/clinical', '/opd', '/census', '/wards', '/round', '/verify', '/tasks', '/patient', '/discharge'].some((p) => path.startsWith(p)) },
    { href: '/theatre/', label: 'Theatre', icon: 'ot', on: ['/theatre', '/waiting', '/booking', '/preop', '/ot', '/ot-today'].some((p) => path.startsWith(p)) },
    { href: '/reports/', label: 'Downloads', icon: 'download', on: path.startsWith('/reports') || path.startsWith('/saved-reports') },
    { href: '/more/', label: 'More', icon: 'more', on: ['/more', '/duty', '/leave', '/protocols', '/backup', '/personnel', '/users', '/settings', '/account', '/notifications', '/help'].some((p) => path.startsWith(p)) },
  ];
  const showFab = canAdd && !path.startsWith('/patients') && !path.startsWith('/discharge');
  return (
    <>
      {showFab && (
        <Link href="/patients/?new=1" className="fab" aria-label="Register new patient">
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" strokeWidth="3" strokeLinecap="butt">
            <path d="M12 3v9" stroke="var(--navy)" /><path d="M12 12h9" stroke="var(--teal)" />
            <path d="M12 12v9" stroke="var(--teal)" /><path d="M3 12h9" stroke="var(--navy)" />
          </svg>
        </Link>
      )}
      <nav className="dock" aria-label="Main">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`dock-item${it.on ? ' on' : ''}`} aria-current={it.on ? 'page' : undefined} aria-label={it.label}>
            <Icon name={it.icon} size={it.on ? 30 : 27} />
            <span>{it.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

export function roleName(code: string) {
  return ({ unit_chief: 'Unit Chief', faculty: 'Consultant', senior_resident: 'Senior Resident', postgraduate: 'Postgraduate', intern: 'Intern',
    staff_nurse: 'Staff Nurse', data_entry: 'Data Entry', admin: 'Administrator' } as Record<string, string>)[code] ?? code;
}

function NoRole() {
  const s = useSession();
  return (
    <div className="card stack">
      <h2>Waiting for access</h2>
      <p>Your account ({s.session?.user.email}) is set up, but you have not been given a role in any unit yet.</p>
      <p className="muted">Ask the unit administrator to add you under <b>Users and roles</b>. Patient records stay hidden until then.</p>
      <div className="row"><button className="ghost" onClick={() => s.refresh()}>Check again</button><button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
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
