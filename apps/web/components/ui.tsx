'use client';
import { STATUS_LABEL } from '@/lib/format';

export function StatusBadge({ s }: { s: string }) {
  const cls = s === 'critical' || s === 'worsening' ? 'bad' : s === 'close_monitoring' ? 'warn' : 'ok';
  return <span className={`badge ${cls}`}>{STATUS_LABEL[s] ?? s}</span>;
}

/** Allergies: Yes / No, with details when Yes. */
export function AllergyField({ status, text, onStatus, onText }: {
  status: string; text: string; onStatus: (v: string) => void; onText: (v: string) => void;
}) {
  return (
    <div className="field"><label className="req">Allergies</label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={status === 'no' ? 'teal' : 'ghost'} onClick={() => onStatus('no')}>No</button>
        <button type="button" className={status === 'yes' ? 'danger' : 'ghost'} onClick={() => onStatus('yes')}>Yes</button>
      </div>
      {status === 'yes' && <input style={{ marginTop: 8 }} required value={text} onChange={(e) => onText(e.target.value)} placeholder="Allergic to what? e.g. Penicillin — rash" />}
    </div>
  );
}
