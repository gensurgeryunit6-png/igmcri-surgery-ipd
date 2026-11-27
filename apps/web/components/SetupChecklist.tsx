'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type Item = { key: string; done: boolean; text: string; detail: string; href: string };
const KEY = 'unitos.setup.';
const get = (k: string) => { try { return localStorage.getItem(KEY + k) === '1'; } catch { return false; } };
const put = (k: string) => { try { localStorage.setItem(KEY + k, '1'); } catch { /* ignore */ } };

/** For the unit administrator: what still has to be set up before the whole unit uses the app. */
export function SetupChecklist() {
  const s = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!s.unit || !s.can('users.manage')) return;
    (async () => {
      const u = s.unit!.id;
      const [pp, mem, prot] = await Promise.all([
        supabase.from('unit_personnel').select('category, user_id').eq('unit_id', u).eq('active', true),
        supabase.from('unit_members').select('user_id').eq('unit_id', u).eq('active', true),
        supabase.from('protocols').select('id').eq('unit_id', u).limit(1),
      ]);
      const people = (pp.data ?? []) as { category: string; user_id: string | null }[];
      const n = (c: string[]) => people.filter((p) => c.includes(p.category)).length;
      const linked = people.filter((p) => p.user_id).length;
      const members = (mem.data ?? []).length;
      setItems([
        { key: 'faculty', done: n(['unit_chief', 'consultant', 'assistant_professor']) > 0, text: 'Add consultants and assistant professors', detail: `${n(['unit_chief', 'consultant', 'assistant_professor'])} added`, href: '/personnel/' },
        { key: 'pgs', done: n(['pg', 'senior_resident']) > 0, text: 'Add PGs and senior residents', detail: `${n(['pg', 'senior_resident'])} added`, href: '/personnel/' },
        { key: 'interns', done: n(['intern']) > 0 || get('interns'), text: 'Add interns', detail: `${n(['intern'])} added`, href: '/personnel/' },
        { key: 'access', done: members > 2 && get('access'), text: 'Give colleagues access to the app', detail: `${members} people have access`, href: '/users/' },
        { key: 'linked', done: people.length > 0 && linked >= Math.min(members, people.length), text: 'Link each person’s login in Unit personnel', detail: `${linked} of ${people.length} linked — needed for “my tasks” and alerts`, href: '/personnel/' },
        { key: 'wards', done: get('wards'), text: 'Check wards and bed numbers match the unit', detail: 'Wards and beds in More', href: '/settings/' },
        { key: 'protocols', done: (prot.data ?? []).length > 0, text: 'Add the unit’s protocols', detail: 'Antibiotic prophylaxis, post-op care, emergencies', href: '/protocols/' },
        { key: 'install', done: get('install'), text: 'Install the app on your phone', detail: 'See Help', href: '/help/#install' },
      ]);
    })();
  }, [s.unit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items) return null;
  const left = items.filter((i) => !i.done);
  if (!left.length || get('hidden')) return null;
  const manual = ['interns', 'access', 'wards', 'install'];
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="spread"><b style={{ color: 'var(--navy)' }}>Get the unit ready · {items.length - left.length} of {items.length} done</b>
        <button className="ghost" style={{ padding: '3px 8px' }} onClick={() => { put('hidden'); bump((x) => x + 1); }}>Hide</button></div>
      {items.map((i) => (
        <div key={i.key} className="spread small" style={{ flexWrap: 'nowrap', gap: 8, opacity: i.done ? 0.55 : 1 }}>
          <Link href={i.href} style={{ color: 'inherit', flex: 1 }}>
            <span style={{ color: i.done ? 'var(--ok)' : 'var(--muted)', marginRight: 6 }}>{i.done ? '✓' : '○'}</span>
            <b style={{ fontWeight: i.done ? 400 : 600 }}>{i.text}</b><div className="muted" style={{ marginLeft: 20 }}>{i.detail}</div>
          </Link>
          {!i.done && manual.includes(i.key) && <button className="ghost" style={{ padding: '3px 8px', whiteSpace: 'nowrap' }} onClick={() => { put(i.key); setItems(items.map((x) => x.key === i.key ? { ...x, done: true } : x)); }}>
            {i.key === 'interns' ? 'None now' : 'Done'}</button>}
        </div>
      ))}
    </div>
  );
}
