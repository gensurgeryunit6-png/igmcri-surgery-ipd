'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';

const sec = (id: string, title: string, body: React.ReactNode) => (
  <div id={id} className="card stack" style={{ gap: 6 }}><h3 style={{ margin: 0 }}>{title}</h3><div className="small stack" style={{ gap: 6 }}>{body}</div></div>
);

/** How to use the app, by role. */
export default function HelpPage() {
  const s = useSession();
  return (
    <div className="stack">
      <div className="small muted">Bottom bar: Home · Clinical · Theatre · Downloads · More. The round + button registers a new patient.</div>

      {sec('install', 'Install on your phone', <>
        <div><b>Android (Chrome):</b> open the app link, tap ⋮ → <i>Install app</i> (or <i>Add to Home screen</i>). It opens like any app, without the address bar.</div>
        <div><b>iPhone (Safari):</b> tap Share → <i>Add to Home Screen</i>.</div>
        <div>Sign in once; you stay signed in. Never share your login.</div>
      </>)}

      {sec('journey', 'A patient’s journey', <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>OPD</b> (Clinical → OPD): find the patient by name, UHID, OP no. or mobile, or register once. Record the visit and decide: follow-up, book a procedure, or admit.</li>
        <li><b>Waiting list</b> (Theatre): every booking for Major OT, Minor OT, Endoscopy or USG. Call the patient from here and record the outcome.</li>
        <li><b>Pre-op work-up</b> (Theatre): complete the checklist on each booking — investigations, PAC, physician, consent, blood.</li>
        <li><b>Admission</b> (patient → 1. Registration): any date; the next free bed is given automatically.</li>
        <li><b>Ward rounds</b> (2): daily notes, tests, medicines, dressings.</li>
        <li><b>Surgery</b> (3): the OT list generator builds the list; mark each case Done with the intra-operative note.</li>
        <li><b>Discharge</b> (4): write the summary, faculty approves, set the follow-up date.</li>
        <li><b>Follow-up</b> (5): the patient appears on OPD’s follow-up list on that date.</li>
      </ol>)}

      {sec('intern', 'Interns', <>
        <div>Home shows <b>My tasks</b>. Open Tasks → start → mark <i>Completed</i>; faculty verify.</div>
        <div>Mark investigation reports <b>collected</b> (Tasks → Investigations) and record <b>dressings</b> in the patient’s Ward rounds step.</div>
        <div>You can read every inpatient record; writing notes is for PGs and faculty.</div>
        <div>Apply for leave under More → Leave.</div>
      </>)}

      {sec('pg', 'Postgraduates', <>
        <div><b>Morning:</b> Clinical → Ward rounds — write today’s round for each patient (use the post-op template on operated patients).</div>
        <div><b>Bookings:</b> book from OPD or the patient’s Surgery step; keep the pre-op checklist up to date; log calls on the waiting list.</div>
        <div><b>OT:</b> Theatre → OT list generator → pick date and room → Generate; reorder, add surgeons; after surgery tap <i>Done</i> and write the intra-op note.</div>
        <div><b>End of duty:</b> More → Duty report. It fills census, admissions and sick patients; you write the handover.</div>
        <div>Assign tasks to interns (Tasks → New task); enter results; write discharge summaries.</div>
      </>)}

      {sec('faculty', 'Consultants and Unit Chief', <>
        <div><b>Review rounds</b> (Clinical) and verify surgery dates (patient → Surgery).</div>
        <div><b>Finalise OT lists</b>; a final list can be reopened if needed.</div>
        <div><b>Approve</b> discharge summaries, leave requests and duty reports; <b>verify</b> completed tasks. Home lists everything waiting for you.</div>
        <div>Downloads: daily unit report, OT lists, pre-op, weekly and monthly statistics — print or Excel.</div>
      </>)}

      {s.can('users.manage') && sec('admin', 'Unit administrator', <>
        <div><b>Access:</b> More → User management — give each colleague a role (Unit Chief, Consultant, PG, Intern).</div>
        <div><b>Unit personnel:</b> add everyone by name and link their login, so tasks, alerts and “my patients” work.</div>
        <div><b>Wards and beds</b> (More) must match the real wards; beds are given automatically from this list.</div>
        <div><b>Backup</b> (More): download every Monday and keep the file on a password-protected hospital computer.</div>
        <div><b>Google sign-in</b> is in testing mode: add each colleague’s Google address as a test user in Google Cloud, or ask me to publish it.</div>
      </>)}

      {sec('rules', 'Good practice', <>
        <div>Records are never deleted: a wrong patient record is archived with a reason; ward rounds are corrected by amendment.</div>
        <div>Every change is logged with who made it and when.</div>
        <div>Do not screenshot patient details to chat groups; share the app link instead.</div>
      </>)}

      <Link className="btn ghost" href="/more/">Back to More</Link>
    </div>
  );
}
