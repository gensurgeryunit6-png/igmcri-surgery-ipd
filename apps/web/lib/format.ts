const TZ = 'Asia/Kolkata';

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-IN', {
    timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function todayLabel() {
  return new Date().toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Value for <input type="datetime-local"> in IST. */
export function nowLocalInput() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO timestamp → datetime-local value in IST. */
export function isoToIstInput(iso: string) {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Convert a datetime-local value entered in IST to an ISO string. */
export function istInputToIso(v: string) {
  return new Date(`${v}:00+05:30`).toISOString();
}

export function ageSex(age?: number | null, sex?: string | null) {
  return `${age ?? '?'}${sex ? ' / ' + sex : ''}`;
}

export const STATUS_LABEL: Record<string, string> = {
  stable: 'Stable', improving: 'Improving', worsening: 'Worsening', critical: 'Critical',
  close_monitoring: 'Close monitoring',
};
