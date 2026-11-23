'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census } from '@/lib/data';
import { todayLabel } from '@/lib/format';
import { Icon } from '@/components/Icon';

type Tile = { href: string; label: string; icon: string; perm?: string; soon?: string };

const TILES: Tile[] = [
  { href: '/census/', label: "Today's census", icon: 'census' },
  { href: '/wards/', label: 'Ward board', icon: 'bed' },
  { href: '/patients/', label: 'Patients', icon: 'patients' },
  { href: '/patients/?new=1', label: 'Register patient', icon: 'addUser', perm: 'patient.write' },
  { href: '#', label: 'Ward rounds', icon: 'rounds', soon: 'Phase 4' },
  { href: '#', label: 'Major OT', icon: 'ot', soon: 'Phase 5' },
  { href: '#', label: 'Minor OT', icon: 'minor', soon: 'Phase 5' },
  { href: '#', label: 'Endoscopy', icon: 'scope', soon: 'Phase 6' },
  { href: '#', label: 'OPD', icon: 'opd', soon: 'Phase 7' },
  { href: '#', label: 'Reports', icon: 'reports', soon: 'Phase 8' },
  { href: '/users/', label: 'Users and roles', icon: 'team', perm: 'users.manage' },
  { href: '/account/', label: 'My account', icon: 'user' },
];

export default function Home() {
  const s = useSession();
  const unitId = s.unit?.id;
  const census = useLive(async () =>
    must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()) as Promise<Census | null>,
    LIVE_TABLES, [unitId]);
  const c = census.data;

  return (
    <div className="stack">
      <div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Good {greeting()}, {displayName(s.staff?.full_name)}</h2>
        <div className="muted small">{todayLabel()}</div>
      </div>

      <Link href="/census/" className="today">
        <div><b>{c?.total_admitted ?? '–'}</b><span>Admitted</span></div>
        <div className={c?.rounds_pending ? 'alert' : ''}><b>{c?.rounds_pending ?? '–'}</b><span>Rounds pending</span></div>
        <div className={c?.critical ? 'alert' : ''}><b>{c?.critical ?? '–'}</b><span>Critical</span></div>
        <div><b>{c?.awaiting_surgery ?? '–'}</b><span>Awaiting surgery</span></div>
      </Link>
      {census.error && <div className="msg err">{census.error}</div>}

      <div className="launcher">
        {TILES.filter((t) => !t.perm || s.can(t.perm)).map((t) => t.soon ? (
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
