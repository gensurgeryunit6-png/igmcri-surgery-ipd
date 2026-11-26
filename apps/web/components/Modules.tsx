'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { Icon } from './Icon';

export const OPD_MINOR_OT_URL = 'https://gensurgeryunit6-png.github.io/minor-ot-manager/mobile2.html?v=18';
export type Tile = { href: string; label: string; icon: string; perm?: string; external?: boolean; badge?: number };

export const CLINICAL: Tile[] = [
  { href: '/opd/', label: 'OPD', icon: 'opd' },
  { href: '/patients/?new=1', label: 'New patient', icon: 'addUser', perm: 'patient.write' },
  { href: '/census/', label: 'Inpatient', icon: 'bed' },
  { href: '/rounds/', label: 'Ward rounds', icon: 'rounds' },
  { href: '/verify/', label: 'Review rounds', icon: 'rounds', perm: 'round.verify' },
  { href: '/tasks/', label: 'Tasks', icon: 'census' },
  { href: '/patients/', label: 'Patient search', icon: 'patients' },
];
export const THEATRE: Tile[] = [
  { href: '/waiting/', label: 'Waiting list', icon: 'patients' },
  { href: '/preop/', label: 'Pre-op work-up', icon: 'census' },
  { href: '/ot/', label: 'OT list generator', icon: 'ot' },
  { href: '/ot/?s=minor', label: 'Minor OT (ward)', icon: 'minor' },
  { href: '/ot/?s=endoscopy', label: 'Endoscopy', icon: 'scope' },
  { href: '/ot/?s=usg', label: 'USG', icon: 'usg' },
  { href: OPD_MINOR_OT_URL, label: 'OPD minor OT', icon: 'minor', external: true },
];

/** Grid of module tiles, filtered by the user's permissions. */
export function Launcher({ tiles }: { tiles: Tile[] }) {
  const s = useSession();
  return (
    <div className="launcher">
      {tiles.filter((t) => !t.perm || s.can(t.perm)).map((t) => t.external ? (
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
  );
}
