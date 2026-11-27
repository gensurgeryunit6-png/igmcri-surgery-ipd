'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useLive, must, LIVE_TABLES, type Census } from '@/lib/data';
import { todayLabel } from '@/lib/format';
import { todayIst } from '@/lib/workflow';
import { SetupChecklist } from '@/components/SetupChecklist';
import { Icon } from '@/components/Icon';
import { roleName } from '@/components/Shell';
import { InstallApp } from '@/components/InstallApp';


// The existing OPD Minor OT Manager, kept as it is and opened from here.

/** Home: unit, date, user, notifications and pending tasks on top; modules below in groups.
 *  A module appears only once it is finished, and only if the person's role allows it. */
export default function Home() {
  const s = useSession();
  const unitId = s.unit?.id;
  const me = s.session?.user.id;

  const live = useLive(async () => {
    const today = todayIst();
    const [c, pts, n, lists, wait, inv, tasks, mePeople] = await Promise.all([
      must(supabase.from('v_census_today').select('*').eq('unit_id', unitId!).maybeSingle()),
      must(supabase.from('v_inpatients').select('admission_id, assigned_pg_id, rounds_today, unverified_today, awaiting_surgery, preop_ready').eq('unit_id', unitId!)),
      must(supabase.from('notifications').select('id', { count: 'exact', head: false }).is('read_at', null).limit(50)),
      must(supabase.from('ot_lists').select('service, ot_cases(status)').eq('unit_id', unitId!).eq('list_date', today)),
      must(supabase.from('surgery_waitlist').select('id, contact_status, status, preop_ready').eq('unit_id', unitId!).in('status', ['waiting', 'postponed', 'scheduled'])),
      must(supabase.from('investigations').select('id').eq('unit_id', unitId!).eq('status', 'pending')),
      must(supabase.from('care_tasks').select('id, status, assigned_person_id').eq('unit_id', unitId!).in('status', ['open', 'in_progress', 'done'])),
      must(supabase.from('unit_personnel').select('id').eq('unit_id', unitId!).eq('user_id', me!)),
    ]);
    const [duty, leave] = await Promise.all([
      s.can('duty.review') ? must(supabase.from('duty_reports').select('id').eq('unit_id', unitId!).eq('status', 'submitted').neq('submitted_by', me!)) : Promise.resolve([]),
      s.can('leave.approve') ? must(supabase.from('leave_requests').select('id').eq('unit_id', unitId!).eq('status', 'pending').neq('user_id', me!)) : Promise.resolve([]),
    ]);
    const mine = new Set((mePeople as { id: string }[]).map((x) => x.id));
    const otToday = (sv: string) => (lists as { service: string; ot_cases: { status: string }[] }[]).filter((l) => l.service === sv)
      .reduce((k, l) => k + l.ot_cases.filter((x) => x.status !== 'postponed' && x.status !== 'cancelled').length, 0);
    const t = tasks as { status: string; assigned_person_id: string | null }[];
    return {
      c: c as Census | null, unread: (n as unknown[]).length,
      pts: pts as { assigned_pg_id: string | null; rounds_today: number; unverified_today: number; awaiting_surgery: boolean; preop_ready: boolean | null }[],
      major: otToday('major'), minor: otToday('minor'), endo: otToday('endoscopy'),
      waiting: (wait as { status: string }[]).filter((w) => w.status !== 'scheduled').length,
      toCall: (wait as { contact_status: string; status: string }[]).filter((w) => w.status !== 'scheduled' && w.contact_status === 'not_contacted').length,
      preopPending: (wait as { preop_ready: boolean }[]).filter((w) => !w.preop_ready).length,
      booked: (wait as unknown[]).length,
      pendingTests: (inv as unknown[]).length,
      myTasks: t.filter((x) => x.status !== 'done' && mine.has(x.assigned_person_id ?? '')).length,
      toVerifyTasks: t.filter((x) => x.status === 'done').length,
      dutyToReview: (duty as unknown[]).length, leaveToApprove: (leave as unknown[]).length,
    };
  }, [...LIVE_TABLES, 'notifications', 'ot_lists', 'ot_cases', 'care_tasks', 'investigations', 'duty_reports', 'leave_requests'], [unitId]);

  const c = live.data?.c;
  const pts = live.data?.pts ?? [];
  const mine = pts.filter((p) => p.assigned_pg_id === me);
  const toVerify = pts.reduce((n, p) => n + p.unverified_today, 0);
  const dueMine = mine.filter((p) => !p.rounds_today).length;

  const tasks: { text: string; href: string; n: number }[] = [];
  if (s.can('round.verify') && toVerify) tasks.push({ n: toVerify, text: 'round notes to review', href: '/verify/' });
  if (s.can('round.write') && mine.length && dueMine) tasks.push({ n: dueMine, text: 'of your patients need today\'s round', href: '/rounds/' });
  else if (s.can('round.write') && c?.rounds_pending) tasks.push({ n: c.rounds_pending, text: 'patients need today\'s round', href: '/rounds/' });
  if (c?.critical) tasks.push({ n: c.critical, text: 'critical patients', href: '/census/?k=critical' });
  const d = live.data;
  if (d?.myTasks) tasks.push({ n: d.myTasks, text: 'tasks assigned to you', href: '/tasks/' });
  if (d?.dutyToReview) tasks.push({ n: d.dutyToReview, text: 'duty reports to review', href: '/duty/' });
  if (d?.leaveToApprove) tasks.push({ n: d.leaveToApprove, text: 'leave requests to approve', href: '/leave/' });
  if (s.can('task.verify') && d?.toVerifyTasks) tasks.push({ n: d.toVerifyTasks, text: 'completed tasks to verify', href: '/tasks/' });
  if (s.can('ot.prepare') && d?.preopPending) tasks.push({ n: d.preopPending, text: 'booked patients with pre-op work-up pending', href: '/preop/' });
  if (s.can('ot.prepare') && d?.toCall) tasks.push({ n: d.toCall, text: 'waiting-list patients not called yet', href: '/waiting/' });

  return (
    <div className="stack">
      <div className="home-top">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: '#C9D6E8' }}>{todayLabel()}</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{s.staff?.full_name}</div>
            <div style={{ fontSize: 12.5, color: '#C9D6E8' }}>{s.roles.map(roleName).join(' · ')} · {s.unit?.name}</div>
          </div>
          <Link href="/notifications/" className="bell" aria-label={`Notifications${live.data?.unread ? `, ${live.data.unread} unread` : ''}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" /></svg>
            {!!live.data?.unread && <span className="bell-n">{live.data.unread}</span>}
          </Link>
        </div>
        <div className="today" style={{ background: 'transparent', padding: '10px 0 0' }}>
          <Link href="/census/" style={{ color: 'inherit' }}><b>{c?.total_admitted ?? '–'}</b><span>Inpatients</span></Link>
          <Link href="/census/?k=rounds" style={{ color: 'inherit' }} className={c?.rounds_pending ? 'alert' : ''}><b>{c?.rounds_pending ?? '–'}</b><span>Rounds due</span></Link>
          <Link href="/census/?k=critical" style={{ color: 'inherit' }} className={c?.critical ? 'alert' : ''}><b>{c?.critical ?? '–'}</b><span>Critical</span></Link>
          <Link href="/census/?k=new" style={{ color: 'inherit' }}><b>{c?.new_admissions ?? '–'}</b><span>New today</span></Link>
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="small" style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Today in the unit</div>
        <div className="countgrid">
          {[
            { n: c?.male_ward, l: 'Male ward', h: '/census/?k=male' }, { n: c?.female_ward, l: 'Female ward', h: '/census/?k=female' },
            { n: c?.special_ward, l: 'Special ward', h: '/census/?k=special' }, { n: d?.preopPending, l: 'Pre-op pending', h: '/preop/' },
            { n: d?.major, l: 'Major OT today', h: '/ot-today/?s=major' }, { n: d?.minor, l: 'Minor OT today', h: '/ot-today/?s=minor' },
            { n: d?.endo, l: 'Endoscopy today', h: '/ot-today/?s=endoscopy' }, { n: c?.postoperative, l: 'Post-op', h: '/census/?k=postop' },
            { n: d?.pendingTests, l: 'Reports pending', h: '/tasks/?v=tests' }, { n: d?.waiting, l: 'Waiting list', h: '/waiting/' },
            { n: c?.planned_discharge, l: 'Planned discharge', h: '/census/?k=discharge' }, { n: d?.myTasks, l: 'My tasks', h: '/tasks/' },
          ].map((x) => <Link key={x.l} href={x.h} className="count"><b>{x.n ?? '–'}</b><span>{x.l}</span></Link>)}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="small" style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Pending tasks</div>
        {tasks.length === 0 ? <div className="small muted">Nothing pending for you right now.</div> : (
          <div className="stack" style={{ gap: 6 }}>
            {tasks.map((t) => (
              <Link key={t.text} href={t.href} className="spread small" style={{ color: 'inherit' }}>
                <span><b style={{ color: 'var(--warn)' }}>{t.n}</b> {t.text}</span><span style={{ color: 'var(--teal)' }}>Open →</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {live.error && <div className="msg err">{live.error}</div>}

      <InstallApp />

      <SetupChecklist />
      <div className="bigbtns">
        <Link href="/clinical/" className="bigbtn">
          <span className="tile-icon"><Icon name="stetho" size={30} /></span>
          <span><b>Clinical</b><small>OPD · Inpatients · Ward rounds · Tasks</small></span>
          {!!((s.can('round.write') ? c?.rounds_pending ?? 0 : 0) + (d?.myTasks ?? 0) + toVerify) && <span className="tile-badge">{(s.can('round.write') ? c?.rounds_pending ?? 0 : 0) + (d?.myTasks ?? 0) + toVerify}</span>}
        </Link>
        <Link href="/theatre/" className="bigbtn">
          <span className="tile-icon"><Icon name="ot" size={30} /></span>
          <span><b>Operation theatre</b><small>Waiting list · Pre-op · OT lists · Endoscopy</small></span>
          {!!d?.preopPending && <span className="tile-badge">{d.preopPending}</span>}
        </Link>
      </div>
    </div>
  );
}
