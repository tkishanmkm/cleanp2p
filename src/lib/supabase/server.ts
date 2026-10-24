import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let serverAdminClient: SupabaseClient | null = null;

export async function createClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required to create the server Supabase client.');
  }

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
  if (!serviceKey || serviceKey === 'placeholder-key' || serviceKey === 'placeholder-anon-key') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for privileged admin operations but is missing or not configured.'
    );
  }

  if (!serverAdminClient) {
    const supabaseUrl =
      process.env.SUPABASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for privileged admin operations.');
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
