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

  const google = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${basePath}/`, queryParams: { prompt: 'select_account' } },
    });
    if (error) {
      setBusy(false);
      setMsg({ kind: 'err', text: /not enabled|Unsupported provider/i.test(error.message)
        ? 'Google sign-in is not switched on yet. Use email and password for now.' : friendlyError(error) });
    }
  };

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
        {mode === 'in' && (
          <>
            <button type="button" className="ghost google" onClick={google} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
              Sign in with Google
            </button>
            <div className="or"><span>or use email</span></div>
          </>
        )}
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
