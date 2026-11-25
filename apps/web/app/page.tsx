'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census } from '@/lib/data';
import { todayLabel } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { roleName } from '@/components/Shell';
import { InstallApp } from '@/components/InstallApp';

type Tile = { href: string; label: string; icon: string; perm?: string; badge?: number; external?: boolean };

// The existing OPD Minor OT Manager, kept as it is and opened from here.
const OPD_MINOR_OT_URL = 'https://gensurgeryunit6-png.github.io/minor-ot-manager/mobile2.html?v=18';
type Group = { title: string; tiles: Tile[] };

/** Home: unit, date, user, notifications and pending tasks on top; modules below in groups.
 *  A module appears only once it is finished, and only if the person's role allows it. */
export default function Home() {
  const s = useSession();
  const unitId = s.unit?.id;
  const me = s.session?.user.id;

  const live = useLive(async () => {
    const [c, pts, n] = await Promise.all([
      must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()),
      must(supabase.from('v_inpatients').select('admission_id, assigned_pg_id, rounds_today, unverified_today').eq('unit_id', unitId!)),
      must(supabase.from('notifications').select('id', { count: 'exact', head: false }).is('read_at', null).limit(50)),
    ]);
    return { c: c as Census | null, pts: pts as { assigned_pg_id: string | null; rounds_today: number; unverified_today: number }[], unread: (n as unknown[]).length };
  }, [...LIVE_TABLES, 'notifications'], [unitId]);

  const c = live.data?.c;
  const pts = live.data?.pts ?? [];
  const mine = pts.filter((p) => p.assigned_pg_id === me);
  const toVerify = pts.reduce((n, p) => n + p.unverified_today, 0);
  const dueMine = mine.filter((p) => !p.rounds_today).length;

  const tasks: { text: string; href: string; n: number }[] = [];
  if (s.can('round.verify') && toVerify) tasks.push({ n: toVerify, text: 'round notes to review', href: '/verify/' });
  if (s.can('round.write') && mine.length && dueMine) tasks.push({ n: dueMine, text: 'of your patients need today\'s round', href: '/rounds/' });
  else if (s.can('round.write') && c?.rounds_pending) tasks.push({ n: c.rounds_pending, text: 'patients need today\'s round', href: '/rounds/' });
  if (c?.critical) tasks.push({ n: c.critical, text: 'critical patients', href: '/census/' });

  const groups: Group[] = [
    { title: 'Clinical', tiles: [
      { href: '/patients/?new=1', label: 'New patient', icon: 'addUser', perm: 'patient.write' },
      { href: '/census/', label: 'Inpatient', icon: 'bed' },
      { href: '/rounds/', label: 'Ward rounds', icon: 'rounds', badge: s.can('round.write') ? c?.rounds_pending : undefined },
      { href: '/verify/', label: 'Review rounds', icon: 'rounds', perm: 'round.verify', badge: toVerify || undefined },
      { href: '/patients/', label: 'Patient search', icon: 'patients' },
    ] },
    { title: 'Operation theatre', tiles: [
      { href: OPD_MINOR_OT_URL, label: 'OPD minor OT', icon: 'minor', external: true },
    ] },
    { title: 'Administration', tiles: [
      { href: '/personnel/', label: 'Unit personnel', icon: 'team' },
      { href: '/reports/', label: 'Downloads', icon: 'reports', perm: 'report.generate' },
      { href: '/more/', label: 'More', icon: 'team' },
    ] },
  ];

  return (
    <div className="stack">
      <div className="home-top">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: '#C9D6E8' }}>{todayLabel()}</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{s.staff?.full_name}</div>
            <div style={{ fontSize: 12.5, color: '#C9D6E8' }}>{s.roles.map(roleName).join(' · ')} · {s.unit?.name}</div>
          </div>
          <Link href="/notifications/" className="bell" aria-label={`Notifications${live.data?.unread ? `, ${live.data.unread} unread` : ''}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" /></svg>
            {!!live.data?.unread && <span className="bell-n">{live.data.unread}</span>}
          </Link>
        </div>
        <div className="today" style={{ background: 'transparent', padding: '10px 0 0' }}>
          <div><b>{c?.total_admitted ?? '–'}</b><span>Inpatients</span></div>
          <div className={c?.rounds_pending ? 'alert' : ''}><b>{c?.rounds_pending ?? '–'}</b><span>Rounds due</span></div>
          <div className={c?.critical ? 'alert' : ''}><b>{c?.critical ?? '–'}</b><span>Critical</span></div>
          <div><b>{c?.new_admissions ?? '–'}</b><span>New today</span></div>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="small" style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Pending tasks</div>
        {tasks.length === 0 ? <div className="small muted">Nothing pending for you right now.</div> : (
          <div className="stack" style={{ gap: 6 }}>
            {tasks.map((t) => (
              <Link key={t.text} href={t.href} className="spread small" style={{ color: 'inherit' }}>
                <span><b style={{ color: 'var(--warn)' }}>{t.n}</b> {t.text}</span><span style={{ color: 'var(--teal)' }}>Open →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {live.error && <div className="msg err">{live.error}</div>}

      <InstallApp />

      {groups.map((g) => {
        const tiles = g.tiles.filter((t) => !t.perm || s.can(t.perm));
        if (!tiles.length) return null;
        return (
          <section key={g.title} className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>{g.title}</h3>
            <div className="launcher">
              {tiles.map((t) => t.external ? (
                <a key={t.label} href={t.href} target="_blank" rel="noopener" className="tile">
                  <span className="tile-icon"><Icon name={t.icon} size={28} /></span>
                  <span className="tile-label">{t.label}</span>
                </a>
              ) : (
                <Link key={t.label} href={t.href} className="tile">
                  {!!t.badge && <span className="tile-badge">{t.badge}</span>}
                  <span className="tile-icon"><Icon name={t.icon} size={28} /></span>
                  <span className="tile-label">{t.label}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
