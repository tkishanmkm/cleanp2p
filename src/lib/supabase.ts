import { getBrowserClient } from '@/lib/supabaseClient';
import { type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin as authoritativeAdmin } from '@/lib/supabaseAdmin';

export function createClient() {
  return getBrowserClient();
}

/**
 * Re-exports authoritative supabaseAdmin client with service_role privileges.
 * Strictly throws if SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export const supabaseAdmin: SupabaseClient = authoritativeAdmin;
