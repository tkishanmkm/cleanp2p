import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server/worker-only service-role client. Keep this module out of Client Components.
// The runtime guard also protects non-Next worker processes and accidental imports.
let cachedClient: SupabaseClient | null = null;

export function hasSupabaseServiceConfig(): boolean {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const localDevelopmentUrl =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);

  return Boolean(
    url &&
    (url.startsWith('https://') || localDevelopmentUrl) &&
    !url.includes('placeholder') &&
    serviceKey.length >= 20 &&
    serviceKey !== 'placeholder-key' &&
    serviceKey !== 'placeholder-anon-key' &&
    (!anonKey || serviceKey !== anonKey)
  );
}

export function getSupabaseServiceClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('Supabase service-role access is server-only.');
  }

  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();

  const localDevelopmentUrl =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);

  if (!url || (!url.startsWith('https://') && !localDevelopmentUrl) || url.includes('placeholder')) {
    throw new Error('A valid Supabase HTTPS URL is required for privileged operations.');
  }

  if (
    !serviceKey ||
    serviceKey.length < 20 ||
    serviceKey === 'placeholder-key' ||
    serviceKey === 'placeholder-anon-key' ||
    (anonKey && serviceKey === anonKey)
  ) {
    throw new Error('A distinct SUPABASE_SERVICE_ROLE_KEY is required for privileged operations.');
  }

  if (!cachedClient) {
    cachedClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return cachedClient;
}

/**
 * Lazy server/worker proxy. It avoids creating a privileged client during
 * module evaluation (for example, when Next.js collects route metadata),
 * while every actual database operation still validates the service key.
 */
export const supabaseService: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabaseServiceClient();
    const value = (client as any)[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
