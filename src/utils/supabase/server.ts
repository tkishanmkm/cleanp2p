import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabaseServiceClient } from '@/lib/supabase/service-role';

function requireSupabaseUrl(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const localDevelopmentUrl =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);

  if (!url || (!url.startsWith('https://') && !localDevelopmentUrl) || url.includes('placeholder')) {
    throw new Error('A valid Supabase HTTPS URL is required.');
  }
  return url;
}

function requireSupabaseAnonKey(): string {
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!key || key.length < 20 || key.includes('placeholder')) {
    throw new Error('Supabase public authentication key is not configured.');
  }
  return key;
}

/** Request-scoped user client: publishable/anon key plus verified SSR cookies only. */
export function createBearerClient(accessToken: string) {
  if (!accessToken || accessToken.length > 8192) {
    throw new Error('A valid bearer access token is required.');
  }
  return createSupabaseClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = requireSupabaseUrl();
  const supabaseAnonKey = requireSupabaseAnonKey();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as CookieOptions)
          );
        } catch {
          // Server Components cannot write cookies; middleware refreshes sessions.
        }
      },
    },
  });
}

export const createRouteHandlerClient = (_options?: any) => createClient();

/** Privileged service-role access never falls back to the public anon key. */
export function getSupabaseAdminClient() {
  return getSupabaseServiceClient();
}
