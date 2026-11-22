'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, friendlyError, basePath } from '@/lib/supabase';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const s = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!s.loading && s.session) router.replace('/'); }, [s.loading, s.session, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: `${location.origin}${basePath}/` },
        });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: 'Check your email and open the confirmation link, then sign in.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}${basePath}/reset/` });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'If that email has an account, a reset link has been sent.' });
      }
    } catch (err) {
      const m = friendlyError(err);
      setMsg({ kind: 'err', text: /Invalid login/i.test(m) ? 'Email or password is incorrect.' : m });
    } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login stack" onSubmit={submit}>
        <div>
          <div className="inst">Indira Gandhi Medical College &amp; Research Institute</div>
          <h1 style={{ marginTop: 6 }}>Surgery Unit OS</h1>
          <div className="muted small">Department of General Surgery · Unit VI</div>
        </div>
        <div className="field"><label>Email</label><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {mode !== 'forgot' && (
          <div className="field"><label>Password</label>
            <input type="password" required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <button disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        <div className="spread small">
          {mode !== 'in' ? <a href="#" onClick={(e) => { e.preventDefault(); setMode('in'); setMsg(null); }}>Back to sign in</a>
            : <a href="#" onClick={(e) => { e.preventDefault(); setMode('up'); setMsg(null); }}>Create an account</a>}
          {mode === 'in' && <a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); setMsg(null); }}>Forgot password?</a>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Authorised unit staff only. A new account sees no patient data until an administrator assigns a role.</p>
      </form>
    </div>
  );
}
