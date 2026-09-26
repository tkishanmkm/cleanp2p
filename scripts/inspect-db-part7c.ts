import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eaiwgfxoiwxepinvcykg.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function inspect() {
  console.log('--- DB INSPECTION START ---');

  // 1. Inspect table columns via postgres metadata if accessible or REST select
  const tables = [
    'onchain_deposits',
    'deposits',
    'deposit_addresses',
    'user_deposit_addresses',
    'wallets',
    'wallet_assets',
    'ledger_entries',
    'assets',
  ];

  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`Table '${t}': Error/Missing (${error.message})`);
    } else {
      const keys = data && data.length > 0 ? Object.keys(data[0]) : 'Table exists (0 rows sample)';
      console.log(`Table '${t}' keys:`, keys);
    }
  }

  // Row counts
  for (const t of ['onchain_deposits', 'deposits', 'deposit_addresses', 'wallets', 'wallet_assets', 'ledger_entries']) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`Table '${t}' row count:`, count, error ? `Error: ${error.message}` : '');
  }

  // Query information_schema columns via Postgres function or query if available
  // Let's test calling RPC or inspecting function definitions
  const rpcsToTest = [
    'process_deposit_atomic',
    'ingest_and_credit_deposit',
    'process_user_deposit',
    'credit_user_deposit',
    'credit_onchain_deposit',
    'credit_confirmed_deposit',
    'process_incoming_deposit',
    'credit_user_balance',
    'provision_user_wallets_atomic',
  ];

  console.log('\n--- RPC Existence Check ---');
  for (const rpcName of rpcsToTest) {
    const { data, error } = await supabase.rpc(rpcName as any, {});
    if (error) {
      console.log(`RPC '${rpcName}': ${error.message} (Code: ${error.code})`);
    } else {
      console.log(`RPC '${rpcName}': Exists and returned without params`, data);
    }
  }
}

inspect().catch(console.error);
