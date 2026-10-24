import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

// Global browser client singleton declaration to prevent multiple GoTrueClient instances in the same context
declare global {
  var __supabase_browser_client_instance__: SupabaseClient | undefined;
}

export function getBrowserClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured before creating the browser Supabase client.');
  }

  if (typeof window === 'undefined') {
    return createBrowserClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: {
        sameSite: 'none',
        secure: true,
        path: '/',
      },
    });
  }
  if (!globalThis.__supabase_browser_client_instance__) {
    globalThis.__supabase_browser_client_instance__ = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      cookieOptions: {
        sameSite: 'none',
        secure: true,
        path: '/',
      },
    });
  }
  return globalThis.__supabase_browser_client_instance__;
}

export const supabase = getBrowserClient();
export default supabase;
