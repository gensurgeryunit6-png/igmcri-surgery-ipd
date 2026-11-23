'use client';
import { STATUS_LABEL } from '@/lib/format';

export function StatusBadge({ s }: { s: string }) {
  const cls = s === 'critical' || s === 'worsening' ? 'bad' : s === 'close_monitoring' ? 'warn' : 'ok';
  return <span className={`badge ${cls}`}>{STATUS_LABEL[s] ?? s}</span>;
}
