const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

let env = process.env;
if (fs.existsSync('.env.local')) {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  });
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || 'https://eaiwgfxoiwxepinvcykg.supabase.co';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

console.log('Connecting to Supabase at:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function run() {
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

  console.log('\n=================== TABLES & COLUMNS ===================');
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`[TABLE] ${t}: ERROR -> ${error.message} (code: ${error.code})`);
    } else {
      const sample = data && data.length > 0 ? data[0] : null;
      console.log(`[TABLE] ${t}: EXISTS. Sample keys:`, sample ? Object.keys(sample) : '(0 rows in table)');
    }
  }

  console.log('\n=================== ROW COUNTS ===================');
  for (const t of ['onchain_deposits', 'deposits', 'deposit_addresses', 'user_deposit_addresses', 'wallets', 'wallet_assets', 'ledger_entries']) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`[COUNT] ${t}:`, count, error ? `Error: ${error.message}` : '');
  }

  console.log('\n=================== RPC EXISTENCE & TEST ===================');
  const rpcs = [
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

  for (const r of rpcs) {
    const { data, error } = await supabase.rpc(r, {});
    if (error) {
      console.log(`[RPC] ${r}: ${error.message} (code: ${error.code})`);
    } else {
      console.log(`[RPC] ${r}: SUCCESS ->`, data);
    }
  }
}

run().catch(console.error);
