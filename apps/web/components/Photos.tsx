'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';

type Doc = { id: string; storage_path: string; caption: string | null; kind: string; created_at: string; author?: { full_name: string } | null; url?: string };

/** Shrink a phone photo to at most 1600 px on the long side, as JPEG, before upload. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85));
}

/** Clinical photographs: private storage, viewable only by unit staff through short-lived links. */
export function Photos({ patientId, admissionId }: { patientId: string; admissionId?: string }) {
  const s = useSession();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [big, setBig] = useState<Doc | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*, author:staff!documents_created_by_fkey(full_name)').eq('patient_id', patientId).order('created_at', { ascending: false });
    const list = (data as Doc[]) ?? [];
    if (list.length) {
      const signed = await supabase.storage.from('clinical-files').createSignedUrls(list.map((d) => d.storage_path), 3600);
      (signed.data ?? []).forEach((x, i) => { list[i].url = x.signedUrl ?? undefined; });
    }
    setDocs(list);
  }, [patientId]);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file || !s.unit) return;
    setBusy(true); setErr('');
    try {
      const blob = await shrink(file);
      const path = `${s.unit.id}/${patientId}/${crypto.randomUUID()}.${blob.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
      const up = await supabase.storage.from('clinical-files').upload(path, blob, { contentType: blob.type || 'image/jpeg' });
      if (up.error) throw up.error;
      const ins = await supabase.from('documents').insert({ patient_id: patientId, admission_id: admissionId ?? null, unit_id: s.unit.id,
        kind: blob.type === 'application/pdf' ? 'document' : 'photo', storage_path: path, caption: caption.trim() || null });
      if (ins.error) throw ins.error;
      setFile(null); setCaption(''); load();
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };

  return (
    <div className="card stack">
      <h3>Photos and documents</h3>
      {s.can('ipd.write') && (
        <div className="stack" style={{ gap: 8 }}>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption, e.g. Wound on POD 3" />
          <button disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button>
          <p className="muted small" style={{ margin: 0 }}>Stored privately. Only unit staff can open them. Do not include the face unless clinically needed.</p>
        </div>
      )}
      {err && <div className="msg err">{err}</div>}
      {docs.length === 0 ? <p className="muted small">No photos yet.</p> : (
        <div className="grid g3">
          {docs.map((d) => (
            <button key={d.id} className="ghost" style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 400, textAlign: 'left' }} onClick={() => setBig(d)}>
              {d.kind === 'photo' && d.url ? <img src={d.url} alt={d.caption ?? 'Clinical photo'} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6 }} />
                : <span style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef1f5', borderRadius: 6 }}>PDF</span>}
              <span className="small" style={{ lineHeight: 1.3 }}>{d.caption ?? '—'}<br /><span className="muted">{fmtDateTime(d.created_at)}</span></span>
            </button>
          ))}
        </div>
      )}
      {big && (
        <div onClick={() => setBig(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,35,.92)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 }}>
          {big.kind === 'photo' ? <img src={big.url} alt={big.caption ?? ''} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8 }} />
            : <a href={big.url} target="_blank" rel="noreferrer" className="btn">Open PDF</a>}
          <div style={{ color: '#fff', textAlign: 'center' }}>{big.caption}<br /><span style={{ opacity: .7, fontSize: 13 }}>{fmtDateTime(big.created_at)} · {big.author?.full_name}</span></div>
          <button className="ghost" onClick={() => setBig(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
