import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let serverAdminClient: SupabaseClient | null = null;

export async function createClient() {
  const cookieHeader = cookies();
  const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
    throw new Error('Supabase URL and anon key must be configured for authenticated server access.');
  }

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
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
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}

export const createRouteHandlerClient = (_options?: any) => createClient();

export function getSupabaseAdminClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey || serviceKey === 'placeholder-key' || serviceKey === 'placeholder-anon-key') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for privileged admin operations but is missing or not configured.'
    );
  }

  if (!serverAdminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();

    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      throw new Error('Supabase URL must be configured for privileged admin operations.');
    }

    serverAdminClient = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serverAdminClient;
}
