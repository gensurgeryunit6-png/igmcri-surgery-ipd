'use client';
import { CLINICAL, Launcher } from '@/components/Modules';

export default function ClinicalPage() {
  return <div className="stack"><p className="small muted" style={{ margin: 0 }}>OPD, admission, ward rounds and tasks.</p><Launcher tiles={CLINICAL} /></div>;
}
