'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Icon } from '@/components/Icon';

/** Everything that is not a daily module: administration, history, help. */
export default function MorePage() {
  const s = useSession();
  const items = [
    { href: '/notifications/', label: 'Notifications', icon: 'reports', note: 'Messages and alerts for you' },
    { href: '/users/', label: 'User management', icon: 'team', perm: 'users.manage', note: 'Give or remove access, set roles' },
    { href: '/settings/', label: 'Wards and beds', icon: 'bed', perm: 'settings.manage', note: 'Ward names, beds, morning report time' },
    { href: '/saved-reports/', label: 'Saved morning reports', icon: 'reports', perm: 'report.generate', note: 'Ward reports saved each morning' },
    { href: '/account/', label: 'My account', icon: 'user', note: 'Your profile, role and sign out' },
  ].filter((i) => !i.perm || s.can(i.perm));
  return (
    <div className="stack">
      <div className="mobile-list">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="mcard row" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <span className="tile-icon" style={{ width: 44, height: 44, flexShrink: 0 }}><Icon name={i.icon} size={22} /></span>
            <span><b>{i.label}</b><div className="small muted">{i.note}</div></span>
          </Link>
        ))}
      </div>
      <div className="card stack small">
        <h3>Help</h3>
        <div><b>Forgot your password?</b> Sign out, then use &quot;Forgot password?&quot; on the sign-in page.</div>
        <div><b>A new colleague?</b> They create an account in the app; a Unit Chief or Consultant then adds their email under User management.</div>
        <div><b>Made a mistake in a ward-round note?</b> Open the note and tap Amend. The original stays visible with your correction and reason.</div>
        <div><b>Something not working?</b> Tell the unit administrator, with a screenshot.</div>
      </div>
      <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  );
}
