const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Load env from /app/.dev.env.json
const env = JSON.parse(fs.readFileSync('/app/.dev.env.json', 'utf8'));
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function run() {
  console.log('=== DETAILED LIVE DATABASE AUDIT ===');
  
  const tables = [
    'profiles',
    'wallets',
    'wallet_assets',
    'ledger_entries',
    'withdrawals',
    'transfers',
    'deposits',
    'onchain_deposits',
    'user_deposit_addresses',
    'deposit_addresses',
    'trades',
    'p2p_ads',
    'ads',
    'feedbacks',
    'feedback',
    'trade_messages',
    'notifications',
    'disputes',
    'audit_logs',
    'platform_settings'
  ];

  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) {
      console.log(`[Table '${t}'] MISSING or ERROR: ${error.message}`);
    } else {
      const keys = data && data.length > 0 ? Object.keys(data[0]) : '(Table exists, 0 rows)';
      // Let's get row count
      const { count, error: countErr } = await supabase.from(t).select('*', { count: 'exact', head: true });
      console.log(`[Table '${t}'] EXISTS | Rows: ${count} | Columns:`, keys);
    }
  }
}

run().catch(console.error);
