import { createClient } from '@supabase/supabase-js';

// Non-mutating schema preflight only. This script does NOT apply migrations or
// execute settlement RPCs. Use a disposable staging project, never production.
const url = process.env.P2P_FEE_STAGING_SUPABASE_URL;
const key = process.env.P2P_FEE_STAGING_SERVICE_ROLE_KEY;
const explicitlyAllow = process.env.P2P_FEE_STAGING_PREFLIGHT === 'true';
const blockedProjectRef = 'eaiwgfxoiwxepinvcykg';

function fail(message: string): never {
  console.error(`[BLOCKED] ${message}`);
  process.exit(1);
}

if (!explicitlyAllow) fail('Set P2P_FEE_STAGING_PREFLIGHT=true to explicitly opt in.');
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
if (!parsed.hostname.endsWith('.supabase.co') && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
  fail('URL host is not a recognized Supabase endpoint or localhost.');
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

  // Check the fee helper's PostgREST exposure without invoking it. A missing
  // RPC can also mean schema-cache exposure is unavailable; investigate manually.
  const { error: rpcError } = await supabase.rpc('record_platform_ledger_entry', {
    p_entry_type: 'preflight_noop',
    p_asset_code: 'PREFLIGHT',
    p_amount: 1,
    p_direction: 'CREDIT',
    p_related_user_id: null,
    p_ref_table: 'preflight',
    p_ref_id: 'preflight-only',
    p_network_code: null,
    p_tx_hash: null,
    p_idempotency_key: 'preflight-must-not-run',
    p_metadata: { preflight: true },
  });

  // Never accept a successful RPC here: that would mean the probe wrote data.
  if (!rpcError) {
    failed = true;
    console.error('[FAIL] Fee helper unexpectedly executed successfully; inspect and remove any preflight ledger row immediately in staging.');
  } else if (/not found|schema cache|could not find/i.test(rpcError.message)) {
    console.warn(`[WARN] Fee helper not discoverable through PostgREST: ${rpcError.message}`);
  } else {
    console.log('[INFO] Fee helper rejected the probe; no successful RPC response was returned. Confirm the exact function signature and grants in staging SQL.');
  }

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
