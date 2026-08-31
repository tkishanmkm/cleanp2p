import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serverClient: SupabaseClient | null = null;

/**
 * Creates or returns a server-side Supabase client.
 * Uses SUPABASE_SERVICE_ROLE_KEY if available for administrative / service actions,
 * or falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *
 * NOTE: This file is intended for server-side environments (API routes, Server Actions, Server Components) only.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!serverClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Missing Supabase server credentials. Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are set.'
      );
    }

    serverClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serverClient;
}
