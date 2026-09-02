import { supabase } from '@/lib/supabaseClient';

export function createClient() {
  return supabase;
}

export { supabase };
