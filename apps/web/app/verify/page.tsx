'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';
import { StatusBadge } from '@/components/ui';
import { effective, vitalsLine, type Entry, type Amendment } from '@/lib/rounds';

type Row = Entry & { admissions: { ip_number: string; patients: { full_name: string; id: string } } };

/** Faculty queue: every unverified round entry in the unit, oldest first, verify one by one or all at once. */
export default function VerifyPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: string; text: string } | null>(null);

  const q = useLive(async () => {
    const rows = await must(supabase.from('ward_round_entries')
      .select('*, author:staff!ward_round_entries_entered_by_fkey(full_name), admissions(ip_number, patients(full_name, id))')
      .eq('unit_id', unitId!).is('verified_at', null).order('round_at').limit(200)) as Row[];
    const ids = rows.map((r) => r.id);
    const am = ids.length ? await must(supabase.from('ward_round_amendments').select('*').in('entry_id', ids)) as Amendment[] : [];
    const beds = await must(supabase.from('v_inpatients').select('admission_id, bed, ward').eq('unit_id', unitId!)) as { admission_id: string; bed: string | null; ward: string | null }[];
    return { rows, am, beds: new Map(beds.map((b) => [b.admission_id, b])) };
  }, ['ward_round_entries', 'ward_round_amendments'], [unitId]);

  if (!s.can('round.verify')) return <div className="msg err">Only faculty and the Unit Chief can verify ward rounds.</div>;
  const rows = q.data?.rows ?? [];

  const verify = async (ids: string[]) => {
    setBusy(true); setMsg(null);
    let failed = 0;
    for (const id of ids) {
      const { error } = await supabase.rpc('verify_ward_round', { p_entry_id: id });
      if (error) { failed++; setMsg({ kind: 'err', text: friendlyError(error) }); }
    }
    setBusy(false);
    if (!failed) setMsg({ kind: 'ok', text: `${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} verified.` });
    q.reload();
  };

  return (
    <div className="stack">
      <div className="spread">
        <span className="muted small">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} waiting · oldest first</span>
        {rows.length > 1 && <button className="teal" disabled={busy} onClick={() => {
          if (confirm(`Verify all ${rows.length} entries? Only do this after reading them.`)) verify(rows.map((r) => r.id));
        }}>Verify all {rows.length}</button>}
      </div>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      {q.error && <div className="msg err">{q.error}</div>}
      {q.data && rows.length === 0 && <div className="msg ok">Nothing waiting. Every ward-round entry is verified.</div>}

      {rows.map((r) => {
        const v = effective(r, q.data!.am);
        const bed = q.data!.beds.get(r.admission_id);
        return (
          <div key={r.id} className="card stack" style={{ gap: 6, padding: 12 }}>
            <div className="spread">
              <span><b>{bed?.bed ?? '—'}</b> · <Link href={`/round/?a=${r.admission_id}`}>{r.admissions?.patients?.full_name}</Link>
                <span className="muted small"> · IP {r.admissions?.ip_number}</span></span>
              <StatusBadge s={v.clinical_status} />
            </div>
            <div className="muted small">{fmtDateTime(r.round_at)} · {r.round_type}{r.postop_day != null ? ` · POD ${r.postop_day}` : ''} · by {r.author?.full_name}</div>
            {vitalsLine(v.vitals) && <div className="small">{vitalsLine(v.vitals)}</div>}
            {v.complaints && <div className="small"><span className="muted">Complaints:</span> {v.complaints}</div>}
            {v.assessment && <div className="small"><span className="muted">Assessment:</span> {v.assessment}</div>}
            {v.plan && <div className="small"><span className="muted">Plan:</span> {v.plan}</div>}
            {v.amendedFields.length > 0 && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>Amended</span>}
            <div className="row">
              <button className="teal" disabled={busy} onClick={() => verify([r.id])}>Verify</button>
              <Link className="btn ghost" href={`/round/?a=${r.admission_id}`}>Open · amend</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
