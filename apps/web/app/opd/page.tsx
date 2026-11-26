'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase, friendlyError } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { ageSex, fmtDate, fmtDateTime } from '@/lib/format';
import { DECISION, VISIT_TYPE, todayIst } from '@/lib/workflow';

type Hit = { id: string; uhid: string; full_name: string; age_years: number | null; sex: string; phone: string | null; op_number?: string | null;
  active_admission_id?: string | null; ip_number?: string | null };
type Visit = { id: string; patient_id: string; visit_at: string; visit_type: string; diagnosis: string | null; decision: string; follow_up_on: string | null;
  patients: { full_name: string; uhid: string; age_years: number | null; sex: string; phone: string | null } | null;
  consultant: { full_name: string } | null };

/** OPD: find the patient (or register once), then record the visit and the decision. */
export default function OpdPage() {
  const s = useSession();
  const unitId = s.unit?.id;
  const today = todayIst();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const t = setTimeout(async () => {
      const [a, b] = await Promise.all([
        supabase.rpc('search_patients', { p_query: term }),
        supabase.from('patients').select('id, uhid, full_name, age_years, sex, phone, op_number')
          .or(`op_number.ilike.${term.replace(/[,()]/g, '')}%,phone_2.like.${term.replace(/[,()]/g, '')}%`).neq('status', 'archived').limit(10),
      ]);
      if (a.error) { setErr(friendlyError(a.error)); return; }
      const map = new Map<string, Hit>();
      [...((a.data as Hit[]) ?? []), ...((b.data as Hit[]) ?? [])].forEach((h) => map.set(h.id, { ...map.get(h.id), ...h }));
      setErr(''); setHits([...map.values()]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const live = useLive(async () => {
    const from = new Date(`${today}T00:00:00+05:30`).toISOString();
    const sel = 'id, patient_id, visit_at, visit_type, diagnosis, decision, follow_up_on, patients(full_name, uhid, age_years, sex, phone), consultant:unit_personnel!opd_visits_consultant_person_id_fkey(full_name)';
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [v, f, d] = await Promise.all([
      must(supabase.from('opd_visits').select(sel).eq('unit_id', unitId!).gte('visit_at', from).order('visit_at', { ascending: false })),
      must(supabase.from('opd_visits').select(sel).eq('unit_id', unitId!).lte('follow_up_on', today).gte('follow_up_on', since).order('follow_up_on')),
      must(supabase.from('admissions').select('id, patient_id, follow_up_on, discharged_at, patients(full_name, uhid, age_years, sex, phone), diagnoses(description)')
        .eq('unit_id', unitId!).neq('status', 'admitted').lte('follow_up_on', today).gte('follow_up_on', since).order('follow_up_on')),
    ]);
    type D = { id: string; patient_id: string; follow_up_on: string; discharged_at: string; patients: Visit['patients']; diagnoses: { description: string }[] };
    const fromDischarge: Visit[] = (d as unknown as D[]).map((x) => ({ id: `a-${x.id}`, patient_id: x.patient_id, visit_at: x.discharged_at, visit_type: 'post_op',
      diagnosis: x.diagnoses?.[0]?.description ? `Post-discharge · ${x.diagnoses[0].description}` : 'Post-discharge review', decision: 'follow_up', follow_up_on: x.follow_up_on, patients: x.patients, consultant: null }));
    const seenSince = (pid: string, dt: string) => (v as unknown as Visit[]).some((x) => x.patient_id === pid) || (f as unknown as Visit[]).some((x) => x.patient_id === pid && x.visit_at > dt);
    const seenToday = new Set((v as unknown as Visit[]).map((x) => x.patient_id));
    const due = [...(f as unknown as Visit[]), ...fromDischarge.filter((x) => !seenSince(x.patient_id, x.visit_at))]
      .filter((x) => !seenToday.has(x.patient_id)).sort((a, b) => (a.follow_up_on ?? '').localeCompare(b.follow_up_on ?? ''));
    return { today: v as unknown as Visit[], due };
  }, ['opd_visits', 'admissions'], [unitId, today]);

  return (
    <div className="stack">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find patient: name, UHID, OP no., IP no. or mobile" />
      {err && <div className="msg err">{err}</div>}
      {hits && (
        <div className="mobile-list">
          {hits.map((h) => (
            <Link key={h.id} href={`/opd-visit/?p=${h.id}`} className="mcard">
              <div className="spread"><b>{h.full_name}</b><span className="muted small">{ageSex(h.age_years, h.sex)}</span></div>
              <div className="muted small">UHID {h.uhid}{h.op_number ? ` · OP ${h.op_number}` : ''}{h.phone ? ` · ${h.phone}` : ''}</div>
              {h.active_admission_id && <span className="badge teal">Admitted · IP {h.ip_number}</span>}
            </Link>
          ))}
          {hits.length === 0 && <p className="muted small">No patient found.</p>}
        </div>
      )}
      {s.can('patient.write') && <Link className="btn teal" href="/patients/?new=1&next=opd">+ Register new patient</Link>}

      {(live.data?.due.length ?? 0) > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Follow-ups due · {live.data!.due.length}</h3>
          {live.data!.due.map((v) => (
            <Link key={v.id} href={`/opd-visit/?p=${v.patient_id}&t=${v.visit_type === 'post_op' ? 'post_op' : 'follow_up'}`} className="spread small" style={{ color: 'inherit', borderBottom: '1px solid #edf0f4', padding: '6px 0' }}>
              <span><b>{v.patients?.full_name}</b> · {v.diagnosis ?? '—'}<div className="muted">{v.patients?.phone ?? 'no phone'}</div></span>
              <span className={`badge ${v.follow_up_on! < today ? 'warn' : 'teal'}`}>{v.follow_up_on! < today ? `Overdue ${fmtDate(v.follow_up_on)}` : 'Today'}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Seen today · {live.data?.today.length ?? 0}</h3>
        {live.data?.today.length === 0 && <p className="muted small" style={{ margin: 0 }}>No OPD visits recorded today.</p>}
        {live.data?.today.map((v) => (
          <Link key={v.id} href={`/opd-visit/?p=${v.patient_id}`} className="small" style={{ color: 'inherit', borderBottom: '1px solid #edf0f4', padding: '6px 0' }}>
            <div className="spread"><b>{v.patients?.full_name}</b><span className="muted">{fmtDateTime(v.visit_at).split(', ').pop()}</span></div>
            <div className="muted">{VISIT_TYPE[v.visit_type]} · {v.diagnosis ?? 'No diagnosis'}{v.consultant ? ` · ${v.consultant.full_name}` : ''}</div>
            <span className="badge">{DECISION[v.decision]}</span>
          </Link>
        ))}
      </div>
      {live.error && <div className="msg err">{live.error}</div>}
    </div>
  );
}
