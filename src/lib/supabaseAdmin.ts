import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _cachedClient: SupabaseClient | null = null;

/**
 * Returns a server-side Supabase client with authoritative service_role privileges.
 * Strictly throws if SUPABASE_SERVICE_ROLE_KEY is missing or configured with a placeholder.
 * Never falls back to the public anonymous key.
 */
export function getAuthoritativeAdminClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey || serviceKey === 'placeholder-key' || serviceKey === 'placeholder-anon-key') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for supabaseAdmin but is missing or not configured.'
    );
  }

  if (!_cachedClient) {
    const supabaseUrl =
      process.env.SUPABASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for privileged database operations.');
    }

    _cachedClient = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return _cachedClient;
}

/**
 * Lazy proxy around the authoritative admin client to prevent build-time module evaluation
 * failures while ensuring that runtime operations fail closed without falling back to anon key.
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getAuthoritativeAdminClient();
    const val = (client as any)[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});
