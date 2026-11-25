'use client';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useLive, must } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';

type N = { id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

export default function NotificationsPage() {
  const q = useLive(async () => must(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as Promise<N[]>, ['notifications'], []);
  const list = q.data ?? [];
  const unread = list.filter((n) => !n.read_at).map((n) => n.id);
  const markAll = async () => { if (unread.length) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread); q.reload(); } };
  const open = (n: N) => { if (!n.read_at) supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).then(); };
  return (
    <div className="stack">
      <div className="spread"><span className="muted small">{unread.length} unread</span>{unread.length > 0 && <button className="ghost" onClick={markAll}>Mark all read</button>}</div>
      {q.data && list.length === 0 && <p className="muted">No notifications yet.</p>}
      <div className="mobile-list">
        {list.map((n) => {
          const body = <><div className="spread"><b>{n.title}</b>{!n.read_at && <span className="badge warn">New</span>}</div>
            {n.body && <div className="small">{n.body}</div>}<div className="small muted">{fmtDateTime(n.created_at)}</div></>;
          return n.link
            ? <Link key={n.id} href={n.link} className="mcard" onClick={() => open(n)} style={{ opacity: n.read_at ? .7 : 1 }}>{body}</Link>
            : <button key={n.id} className="mcard ghost" style={{ textAlign: 'left', fontWeight: 400, opacity: n.read_at ? .7 : 1 }} onClick={() => { open(n); q.reload(); }}>{body}</button>;
        })}
      </div>
    </div>
  );
}
