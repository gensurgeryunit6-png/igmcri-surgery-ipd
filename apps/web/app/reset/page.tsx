'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError } from '@/lib/supabase';

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setErr(friendlyError(error)); else router.replace('/');
  };
  return (
    <div className="login-wrap">
      <form className="login stack" onSubmit={save}>
        <h1>Set a new password</h1>
        <div className="field"><label>New password (at least 8 characters)</label>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <div className="msg err">{err}</div>}
        <button disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  );
}
