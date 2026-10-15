import { createClient } from '@supabase/supabase-js';

// Non-mutating schema preflight only. This script does NOT apply migrations or
// execute settlement RPCs. Use a disposable staging project, never production.
const url = process.env.P2P_FEE_STAGING_SUPABASE_URL;
const key = process.env.P2P_FEE_STAGING_SERVICE_ROLE_KEY;
const explicitlyAllow = process.env.P2P_FEE_STAGING_PREFLIGHT === 'true';
const expectedProjectRef = process.env.P2P_FEE_STAGING_EXPECTED_PROJECT_REF;
const confirmDisposable = process.env.P2P_FEE_STAGING_CONFIRM_DISPOSABLE === 'true';
const blockedProjectRef = 'eaiwgfxoiwxepinvcykg';

function fail(message: string): never {
  console.error(`[BLOCKED] ${message}`);
  process.exit(1);
}

if (!explicitlyAllow) fail('Set P2P_FEE_STAGING_PREFLIGHT=true to explicitly opt in.');
if (!confirmDisposable) fail('Set P2P_FEE_STAGING_CONFIRM_DISPOSABLE=true only after confirming this is a disposable staging project.');
if (!expectedProjectRef || !/^[a-z0-9]{20}$/.test(expectedProjectRef)) fail('Set P2P_FEE_STAGING_EXPECTED_PROJECT_REF to the exact 20-character staging project ref.');
if (!url || !key) fail('P2P_FEE_STAGING_SUPABASE_URL and P2P_FEE_STAGING_SERVICE_ROLE_KEY are required.');
let parsed: URL;
try {
  parsed = new URL(url);
} catch {
  fail('Invalid staging Supabase URL.');
}
if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
  fail('Use HTTPS for remote staging projects.');
}
if (parsed.hostname === `${blockedProjectRef}.supabase.co`) {
  fail('The known production Supabase project is blocked.');
}
if (parsed.hostname !== `${expectedProjectRef}.supabase.co` && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
  fail('URL hostname does not exactly match P2P_FEE_STAGING_EXPECTED_PROJECT_REF.');
}
if (expectedProjectRef === blockedProjectRef) {
  fail('The known production project cannot be designated as staging.');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Check = { table: string; columns: string[] };
const checks: Check[] = [
  {
    table: 'trades',
    columns: ['id', 'buyer_id', 'seller_id', 'crypto', 'crypto_amount', 'escrow_fee', 'status', 'escrow_status'],
  },
  {
    table: 'wallet_assets',
    columns: ['user_id', 'asset_symbol', 'balance', 'in_escrow', 'in_withdrawal'],
  },
  {
    table: 'ledger_entries',
    columns: ['user_id', 'crypto', 'asset', 'amount', 'type', 'reference_id', 'balance_after', 'metadata', 'status'],
  },
  {
    table: 'platform_ledger_entries',
    columns: ['entry_type', 'asset_code', 'amount', 'direction', 'related_user_id', 'ref_table', 'ref_id', 'idempotency_key'],
  },
];

async function main() {
  console.log('Trade fee migration — read-only staging schema preflight');
  console.log(`Target host: ${parsed.hostname}`);
  let failed = false;

  for (const check of checks) {
    const columns = check.columns.join(',');
    const { error } = await supabase.from(check.table).select(columns).limit(0);
    if (error) {
      failed = true;
      console.error(`[FAIL] ${check.table}: ${error.message}`);
    } else {
      console.log(`[PASS] ${check.table}: expected columns are queryable`);
    }
  }

  console.log('[INFO] This preflight deliberately does not invoke RPCs or mutate data.');

  if (failed) {
    console.error('Preflight failed. Do not run settlement tests or apply the migration.');
    process.exit(1);
  }
  console.log('Column preflight passed. This is not proof the migration compiles or settlement behavior is correct.');
}

main().catch((error) => {
  console.error('Preflight failed unexpectedly:', error);
  process.exit(1);
});
