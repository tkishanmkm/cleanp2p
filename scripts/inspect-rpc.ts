import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

async function inspectRpc() {
  const { data, error } = await adminSupabase.rpc('get_function_def', { func_name: 'initiate_trade_with_escrow' });
  console.log('get_function_def:', data, error);
}

inspectRpc();
