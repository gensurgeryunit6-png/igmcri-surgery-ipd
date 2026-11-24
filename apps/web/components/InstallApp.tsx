'use client';
import { useEffect, useState } from 'react';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let saved: PromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); saved = e as PromptEvent; });
}

/** "Install app" card: puts Unit VI on the phone's home screen so it opens directly, without the browser. */
export function InstallApp() {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setInstalled(!!standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    try { setHidden(localStorage.getItem('unitos.install.hidden') === '1'); } catch { /* ignore */ }
    const t = setInterval(() => { if (saved) { setReady(true); clearInterval(t); } }, 500);
    const done = () => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => { clearInterval(t); window.removeEventListener('appinstalled', done); };
  }, []);

  if (installed || hidden || (!ready && !ios)) return null;
  return (
    <div className="card spread" style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal)' }}>
      <span className="small" style={{ flex: '1 1 200px' }}>
        <b>Open Unit VI like an app.</b>{' '}
        {ios ? <>Tap the Share button, then <b>Add to Home Screen</b>.</> : 'Install it once; it then opens straight to this screen.'}
      </span>
      <span className="row" style={{ gap: 6 }}>
        {!ios && <button className="teal" onClick={async () => { await saved?.prompt(); const r = await saved?.userChoice; if (r?.outcome === 'accepted') setInstalled(true); }}>Install app</button>}
        <button className="ghost" onClick={() => { setHidden(true); try { localStorage.setItem('unitos.install.hidden', '1'); } catch { /* ignore */ } }}>Not now</button>
      </span>
    </div>
  );
}
