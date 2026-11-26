// Simple line icons (24×24, stroke), drawn here so the app needs no icon library.
const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  census: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  bed: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01',
  patients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7M19 14.5a7 7 0 0 1 3 6.5',
  addUser: 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21a7 7 0 0 1 12-5M19 14v6M16 17h6',
  rounds: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  ot: 'M4 20l9-9M13 11l3-7 4 4-7 3M6 14l4 4',
  minor: 'M12 3v18M3 12h18M7 7l10 10',
  scope: 'M12 3a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zM12 14v4a3 3 0 0 0 6 0v-2',
  opd: 'M4 7h16v13H4zM9 7V4h6v3M12 11v5M9.5 13.5h5',
  reports: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  team: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 20a7 7 0 0 1 14 0M5 10a2 2 0 1 0 0-.01M19 10a2 2 0 1 0 0-.01',
  back: 'M15 5l-7 7 7 7',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  stetho: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 12a2 2 0 1 0 0-.01',
  homeRing: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0-4-4',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  more: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
};

export function Icon({ name, size = 24, color = 'currentColor' }: { name: keyof typeof P | string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.home} />
    </svg>
  );
}
