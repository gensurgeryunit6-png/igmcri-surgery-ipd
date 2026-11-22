import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://pnncnljakqrqzocahxhs.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_cga5rEYY_gFG3KZ2Kpvb9g_ZoHKiYJd';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Turn a Supabase/Postgres error into a sentence a clinician can act on. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.';
  if (/duplicate key.*uhid/i.test(msg)) return 'A patient with this UHID is already registered.';
  if (/duplicate key/i.test(msg)) return 'That record already exists.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection to the server. Check the network and try again.';
  return msg.replace(/^.*?ERROR:\s*/, '');
}
