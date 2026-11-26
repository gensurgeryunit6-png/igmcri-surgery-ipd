'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { SERVICES, SESSIONS, todayIst, type OtList } from '@/lib/workflow';
import { OtGenerator } from '@/components/OtGenerator';

type Row = OtList & { ot_cases: { status: string }[] };

/** OT lists by date for Major OT, Minor OT (ward) and Endoscopy. Previous lists stay here. */
export default function OtListsPage() { return <Suspense><OtLists /></Suspense>; }

function OtLists() {
  const s = useSession();
  const router = useRouter();
  const unitId = s.unit?.id;
  const today = todayIst();
  const [service, setService] = useState(useSearchParams().get('s') ?? 'major');
  const [past, setPast] = useState(false);
  const [nl, setNl] = useState<{ date: string; room: string; session: string } | null>(null);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState('');

  const live = useLive(async () => {
    let q = supabase.from('ot_lists').select('*, ot_cases(status)').eq('unit_id', unitId!).eq('service', service);
    q = past ? q.lt('list_date', today).order('list_date', { ascending: false }).limit(60) : q.gte('list_date', today).order('list_date');
    return must(q);
  }, ['ot_lists', 'ot_cases'], [unitId, service, past]);
  const rows = (live.data as Row[]) ?? [];

  const create = async () => {
    if (!nl) return;
    setErr('');
    const { data, error } = await supabase.from('ot_lists').insert({ unit_id: unitId, service, list_date: nl.date, ot_room: nl.room.trim(), session: nl.session }).select('id').single();
    if (error) setErr(friendlyError(error)); else router.push(`/ot-list/?id=${data.id}`);
  };

  return (
    <div className="stack">
      <div className="tabs">{SERVICES.map((sv) => <button key={sv.v} className={service === sv.v ? 'on' : ''} onClick={() => setService(sv.v)}>{sv.label}</button>)}</div>
      <div className="row">
        <button className={past ? 'ghost' : 'teal'} onClick={() => setPast(false)}>Today and coming</button>
        <button className={past ? 'teal' : 'ghost'} onClick={() => setPast(true)}>Previous lists</button>
      </div>
      {s.can('ot.prepare') && !nl && !gen && (
        <div className="row">
          <button className="teal" onClick={() => setGen(true)}>Generate OT list</button>
          <button className="ghost" onClick={() => setNl({ date: today, room: '', session: 'morning' })}>+ Empty list</button>
        </div>
      )}
      {gen && <OtGenerator initialService={service} onDone={(id) => router.push(`/ot-list/?id=${id}`)} onCancel={() => setGen(false)} />}
      {nl && (
        <div className="card stack">
          <div className="grid g3">
            <div className="field"><label>Date</label><input type="date" value={nl.date} onChange={(e) => setNl({ ...nl, date: e.target.value })} /></div>
            <div className="field"><label>OT room</label><input value={nl.room} onChange={(e) => setNl({ ...nl, room: e.target.value })} placeholder="OT 3" /></div>
            <div className="field"><label>Session</label><select value={nl.session} onChange={(e) => setNl({ ...nl, session: e.target.value })}>{Object.entries(SESSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          {err && <div className="msg err">{err}</div>}
          <div className="row"><button className="teal" onClick={create}>Create list</button><button className="ghost" onClick={() => setNl(null)}>Cancel</button></div>
        </div>
      )}
      {live.error && <div className="msg err">{live.error}</div>}
      {live.data && rows.length === 0 && <p className="muted">{past ? 'No previous lists.' : 'No lists yet for today or later.'}</p>}
      <div className="mobile-list">
        {rows.map((l) => {
          const planned = l.ot_cases.filter((c) => c.status === 'planned').length;
          const done = l.ot_cases.filter((c) => c.status === 'done').length;
          return (
            <Link key={l.id} href={`/ot-list/?id=${l.id}`} className="mcard">
              <div className="spread"><b>{fmtDate(l.list_date)}{l.list_date === today ? ' · Today' : ''}</b>
                <span className={`badge ${l.status === 'final' ? 'navy' : 'warn'}`}>{l.status === 'final' ? 'Final' : 'Draft'}</span></div>
              <div className="small muted">{SESSIONS[l.session]}{l.ot_room ? ` · ${l.ot_room}` : ''}</div>
              <div className="small">{l.ot_cases.length} case{l.ot_cases.length === 1 ? '' : 's'}{planned ? ` · ${planned} planned` : ''}{done ? ` · ${done} done` : ''}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
