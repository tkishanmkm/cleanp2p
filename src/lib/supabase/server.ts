import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let serverAdminClient: SupabaseClient | null = null;

export async function createClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eaiwgfxoiwxepinvcykg.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (
    !serviceKey ||
    serviceKey === 'placeholder-key' ||
    serviceKey === 'placeholder-anon-key' ||
    (anonKey && serviceKey === anonKey)
  ) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for privileged admin operations and must not equal the public anon key.'
    );
  }

  if (!serverAdminClient) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      process.env.SUPABASE_URL?.trim() ||
      'https://eaiwgfxoiwxepinvcykg.supabase.co';

    serverAdminClient = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serverAdminClient;
}

/** Backwards-compatible name for server-only privileged operations. */
export function createAdminClient(): SupabaseClient {
  return getSupabaseAdminClient();
}
