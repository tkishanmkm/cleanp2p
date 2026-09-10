import { getBrowserClient } from '@/lib/supabaseClient';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

export function createClient() {
  return getBrowserClient();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabaseAdmin: SupabaseClient = createSupabaseClient(
  supabaseUrl,
  supabaseKey
);
