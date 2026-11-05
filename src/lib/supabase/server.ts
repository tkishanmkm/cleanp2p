import 'server-only';
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let serverAdminClient: SupabaseClient | null = null;

function requireSupabaseUrl(): string {
  const value = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const isProductionUrl = value.startsWith('https://');
  const isLocalDevelopmentUrl =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);

  if (!value || (!isProductionUrl && !isLocalDevelopmentUrl) || value.includes('placeholder')) {
    throw new Error('Supabase URL is not configured with a valid HTTPS endpoint.');
  }
  return value;
}

function requireSupabaseAnonKey(): string {
  const value = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!value || value.length < 20 || value.includes('placeholder')) {
    throw new Error('Supabase publishable/anon key is not configured.');
  }
  return value;
}

export async function createClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  const supabaseUrl = requireSupabaseUrl();
  const supabaseAnonKey = requireSupabaseAnonKey();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookieOptions: {
        sameSite: "none",
        secure: true,
        path: "/",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                sameSite: "none",
                secure: true,
              })
            );
          } catch {
            // Set from a Server Component; safe to ignore if middleware handles session updates.
          }
        },
      },
    }
  );
}

/**
 * Creates or returns a server-side Supabase admin client with service role credentials.
 * Strictly requires SUPABASE_SERVICE_ROLE_KEY and never falls back to the public anon key.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publicAnonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (
    !serviceKey ||
    serviceKey.length < 20 ||
    serviceKey === 'placeholder-key' ||
    serviceKey === 'placeholder-anon-key' ||
    (publicAnonKey && serviceKey === publicAnonKey)
  ) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for privileged admin operations but is missing or not configured.'
    );
  }

  if (!serverAdminClient) {
    const supabaseUrl = requireSupabaseUrl();
    serverAdminClient = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serverAdminClient;
}

/** Compatibility alias for routes that use the createAdminClient name. */
export function createAdminClient(): SupabaseClient {
  return getSupabaseAdminClient();
}
