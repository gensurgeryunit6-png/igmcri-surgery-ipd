'use client';
import { THEATRE, Launcher } from '@/components/Modules';

export default function TheatrePage() {
  return <div className="stack"><p className="small muted" style={{ margin: 0 }}>Waiting list, pre-op work-up, OT lists and endoscopy.</p><Launcher tiles={THEATRE} /></div>;
}
