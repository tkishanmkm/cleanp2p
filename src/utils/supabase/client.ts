import { getBrowserClient, supabase } from '@/lib/supabaseClient';

export function createClient() {
  return getBrowserClient();
}

export const createClientComponentClient = createClient;

export { supabase };
