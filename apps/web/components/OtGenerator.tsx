'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { usePersonnel } from '@/lib/personnel';
import { fmtDate } from '@/lib/format';
import { SERVICES, SESSIONS, PRIORITY, serviceLabel, todayIst, type WaitRow } from '@/lib/workflow';

/** OT list generator: choose a date and list; patients booked for that day (and ready ones) are picked
 *  automatically, in priority order. Creates the list (or adds to an existing draft) in one step. */
export function OtGenerator({ initialService, onDone, onCancel }: { initialService: string; onDone: (listId: string) => void; onCancel: () => void }) {
  const s = useSession();
  const consultants = usePersonnel(s.unit?.id).filter((p) => ['unit_chief', 'consultant', 'assistant_professor'].includes(p.category));
  const [f, setF] = useState({ service: initialService, date: todayIst(), room: '', session: 'morning', consultant: '', anaesthetist: '' });
  const [rows, setRows] = useState<WaitRow[]>([]);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [onlyDue, setOnlyDue] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    supabase.from('v_waiting_list').select('*').eq('unit_id', s.unit!.id).eq('list_type', f.service).in('status', ['waiting', 'postponed'])
      .then(({ data, error }) => { if (error) setErr(friendlyError(error)); setRows((data as WaitRow[]) ?? []); });
  }, [s.unit, f.service]);

  const rank = { emergency: 0, urgent: 1, routine: 2 } as Record<string, number>;
  const sorted = useMemo(() => [...rows].sort((a, b) => rank[a.priority] - rank[b.priority]
    || Number(b.preop_ready) - Number(a.preop_ready) || (a.planned_date ?? '9999').localeCompare(b.planned_date ?? '9999')), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const due = (r: WaitRow) => !!r.planned_date && r.planned_date <= f.date;
  const shown = sorted.filter((r) => !onlyDue || due(r) || r.priority !== 'routine');

  // Default ticks: booked for this date (or earlier) and work-up complete; Minor OT and Endoscopy need no PAC to be ticked.
  useEffect(() => {
    setPick(Object.fromEntries(sorted.map((r) => [r.id, due(r) && (r.preop_ready || f.service !== 'major') && r.contact_status !== 'not_willing'])));
  }, [sorted, f.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = sorted.filter((r) => pick[r.id]);
  const generate = async () => {
    setErr(''); setBusy(true);
    try {
      const ex = await supabase.from('ot_lists').select('id, status').eq('unit_id', s.unit!.id).eq('service', f.service).eq('list_date', f.date)
        .eq('ot_room', f.room.trim()).eq('session', f.session).maybeSingle();
      if (ex.data?.status === 'final') throw new Error('That list is already final. Reopen it first, or choose another room or session.');
      let lid = ex.data?.id as string | undefined;
      if (!lid) {
        const r = await supabase.from('ot_lists').insert({ unit_id: s.unit!.id, service: f.service, list_date: f.date, ot_room: f.room.trim(), session: f.session,
          consultant_person_id: f.consultant || null, anaesthetist: f.anaesthetist.trim() || null }).select('id').single();
        if (r.error) throw r.error;
        lid = r.data.id;
      }
      for (const r of chosen) {
        const { error } = await supabase.rpc('add_booking_to_list', { p_list: lid, p_booking: r.id });
        if (error) throw new Error(`${r.full_name}: ${friendlyError(error)}`);
      }
      onDone(lid!);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Generate OT list</h3>
      <div className="row" style={{ gap: 6 }}>{SERVICES.map((sv) => <button key={sv.v} type="button" className={f.service === sv.v ? 'teal' : 'ghost'} onClick={() => setF({ ...f, service: sv.v })}>{sv.label}</button>)}</div>
      <div className="grid g3">
        <div className="field"><label>Date</label><input type="date" value={f.date} onChange={set('date')} /></div>
        <div className="field"><label>OT room</label><input value={f.room} onChange={set('room')} placeholder="OT 3" /></div>
        <div className="field"><label>Session</label><select value={f.session} onChange={set('session')}>{Object.entries(SESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="grid g2">
        <div className="field"><label>Consultant</label><select value={f.consultant} onChange={set('consultant')}><option value="">—</option>{consultants.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
        <div className="field"><label>Anaesthetist</label><input value={f.anaesthetist} onChange={set('anaesthetist')} /></div>
      </div>
      <div className="spread small">
        <b>{serviceLabel(f.service)} patients · {chosen.length} selected</b>
        <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Only those due by {fmtDate(f.date)}</label>
      </div>
      {shown.length === 0 && <p className="muted small" style={{ margin: 0 }}>{onlyDue ? 'Nobody is booked for this date. Untick "Only those due" to see everyone waiting.' : 'Nobody is waiting.'}</p>}
      {shown.map((r) => (
        <label key={r.id} className="row small" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start', borderBottom: '1px solid #edf0f4', padding: '6px 0', margin: 0, fontWeight: 400, color: 'var(--ink)' }}>
          <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!pick[r.id]} onChange={(e) => setPick({ ...pick, [r.id]: e.target.checked })} />
          <span style={{ flex: 1 }}><b>{r.full_name}</b> · {r.planned_procedure}
            <span className="row" style={{ gap: 4, marginTop: 2 }}>
              <span className={`badge ${r.preop_ready ? 'ok' : 'warn'}`}>{r.preop_ready ? 'Pre-op ready' : 'Pre-op pending'}</span>
              {r.priority !== 'routine' && <span className="badge bad">{PRIORITY[r.priority]}</span>}
              <span className="badge">{r.planned_date ? fmtDate(r.planned_date) : 'No date'}</span>
              {r.is_admitted ? <span className="badge teal">Admitted</span> : <span className="badge">OPD</span>}
              {r.contact_status === 'not_willing' && <span className="badge bad">Not willing</span>}
            </span></span>
        </label>
      ))}
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button className="teal" disabled={busy} onClick={generate}>{busy ? 'Generating…' : `Generate list${chosen.length ? ` with ${chosen.length}` : ''}`}</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
