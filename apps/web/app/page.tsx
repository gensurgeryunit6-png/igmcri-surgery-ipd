'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census } from '@/lib/data';
import { todayLabel } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { roleName } from '@/components/Shell';
import { levelOf, type Level } from '@/lib/roles';

type Tile = { href: string; label: string; icon: string; perm?: string; soon?: string; levels?: Level[] };

// Order matters: each role sees its most-used modules first.
const CLINICAL_FIRST: Tile[] = [
  { href: '#', label: 'Ward rounds', icon: 'rounds', perm: 'round.write', soon: 'Phase 4', levels: ['resident', 'intern'] },
  { href: '/wards/', label: 'Ward board', icon: 'bed' },
  { href: '/patients/', label: 'Patients', icon: 'patients' },
  { href: '/patients/?new=1', label: 'Register patient', icon: 'addUser', perm: 'patient.write' },
  { href: '/census/', label: "Today's census", icon: 'census' },
];
const SUPERVISOR_FIRST: Tile[] = [
  { href: '#', label: 'Verify rounds', icon: 'rounds', perm: 'round.verify', soon: 'Phase 4' },
  { href: '#', label: 'Approve OT list', icon: 'ot', perm: 'ot.approve', soon: 'Phase 5' },
  { href: '/census/', label: "Today's census", icon: 'census' },
  { href: '/wards/', label: 'Ward board', icon: 'bed' },
  { href: '/patients/', label: 'Patients', icon: 'patients' },
];
const COMMON: Tile[] = [
  { href: '#', label: 'Major OT', icon: 'ot', perm: 'ot.prepare', soon: 'Phase 5', levels: ['resident'] },
  { href: '#', label: 'Minor OT', icon: 'minor', soon: 'Phase 5' },
  { href: '#', label: 'Endoscopy', icon: 'scope', soon: 'Phase 6' },
  { href: '#', label: 'OPD', icon: 'opd', soon: 'Phase 7' },
  { href: '#', label: 'PG logbook', icon: 'reports', soon: 'Phase 8', levels: ['resident', 'intern'] },
  { href: '#', label: 'Reports', icon: 'reports', perm: 'report.generate', soon: 'Phase 8' },
  { href: '#', label: 'Audit log', icon: 'reports', perm: 'audit.read', soon: 'Phase 8', levels: ['chief', 'admin'] },
  { href: '/users/', label: 'Users and roles', icon: 'team', perm: 'users.manage' },
  { href: '/account/', label: 'My account', icon: 'user' },
];

export default function Home() {
  const s = useSession();
  const unitId = s.unit?.id;
  const me = s.session?.user.id;
  const level = levelOf(s.roles);
  const supervisor = level === 'chief' || level === 'faculty';

  const live = useLive(async () => {
    const [c, pts] = await Promise.all([
      must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()),
      must(supabase.from('v_inpatients').select('admission_id, assigned_pg_id, rounds_today, unverified_today').eq('unit_id', unitId!)),
    ]);
    return { c: c as Census | null, pts: pts as { assigned_pg_id: string | null; rounds_today: number; unverified_today: number }[] };
  }, LIVE_TABLES, [unitId]);
  const c = live.data?.c;
  const pts = live.data?.pts ?? [];
  const mine = pts.filter((p) => p.assigned_pg_id === me);
  const toVerify = pts.reduce((n, p) => n + p.unverified_today, 0);

  const seen = new Set<string>();
  const tiles = [...(supervisor ? SUPERVISOR_FIRST : CLINICAL_FIRST), ...COMMON]
    .filter((t) => (!t.perm || s.can(t.perm)) && (!t.levels || t.levels.includes(level)))
    .filter((t) => (seen.has(t.label) ? false : (seen.add(t.label), true)));

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Good {greeting()}, {displayName(s.staff?.full_name)}</h2>
        <div className="row small" style={{ gap: 8 }}>
          <span className="muted">{todayLabel()}</span>
          <span className="badge navy">{s.roles.map(roleName).join(' · ')}</span>
        </div>
      </div>

      <Link href="/census/" className="today">
        <div><b>{c?.total_admitted ?? '–'}</b><span>Admitted</span></div>
        <div className={c?.rounds_pending ? 'alert' : ''}><b>{c?.rounds_pending ?? '–'}</b><span>Rounds pending</span></div>
        <div className={c?.critical ? 'alert' : ''}><b>{c?.critical ?? '–'}</b><span>Critical</span></div>
        <div><b>{c?.awaiting_surgery ?? '–'}</b><span>Awaiting surgery</span></div>
      </Link>
      {live.error && <div className="msg err">{live.error}</div>}

      {supervisor && s.can('round.verify') && (
        <Link href="/wards/" className="card spread" style={{ color: 'inherit' }}>
          <span><b>{toVerify}</b> round {toVerify === 1 ? 'entry' : 'entries'} today waiting for your verification</span>
          <span className={`badge ${toVerify ? 'warn' : 'ok'}`}>{toVerify ? 'Review' : 'All clear'}</span>
        </Link>
      )}
      {(level === 'resident' || level === 'intern') && (
        <Link href="/wards/" className="card spread" style={{ color: 'inherit' }}>
          {mine.length ? (
            <span><b>{mine.filter((p) => !p.rounds_today).length}</b> of your {mine.length} patients still need today&apos;s round</span>
          ) : (
            <span><b>{c?.rounds_pending ?? 0}</b> patients in the unit still need today&apos;s round</span>
          )}
          <span className="badge teal">Ward board</span>
        </Link>
      )}

      <div className="launcher">
        {tiles.map((t) => t.soon ? (
          <div key={t.label} className="tile soon" title={`Coming in ${t.soon}`}>
            <span className="tile-icon"><Icon name={t.icon} size={28} /></span>
            <span className="tile-label">{t.label}</span>
            <span className="tile-soon">{t.soon}</span>
          </div>
        ) : (
          <Link key={t.label} href={t.href} className="tile">
            <span className="tile-icon"><Icon name={t.icon} size={28} /></span>
            <span className="tile-label">{t.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function displayName(n?: string) {
  if (!n) return '';
  const parts = n.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').trim().split(/\s+/);
  return /^dr\.?\s/i.test(n) ? `Dr. ${parts[0]}` : parts[0];
}

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
