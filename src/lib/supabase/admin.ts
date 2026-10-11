import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient as getServerAdminClient } from './server';

export function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, '') ||
    process.env.SUPABASE_URL ||
    'https://placeholder.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!key || key === 'placeholder-key' || key === 'placeholder-anon-key') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for createAdminClient but is missing or not configured.'
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const getSupabaseAdminClient = getServerAdminClient;
