import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const checks: Array<[string, string, RegExp]> = [
  [
    'deposit credit RPCs are not executable by browser roles',
    'supabase/migrations/20261016000000_restrict_deposit_credit_rpc.sql',
    /REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM PUBLIC;[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_confirmed_deposit\(uuid\) TO service_role;/i,
  ],
  [
    'legacy parameter-based deposit credit RPC is disabled',
    'supabase/migrations/20261016000002_disable_legacy_direct_deposit_credit.sql',
    /RAISE EXCEPTION[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid, numeric, text, text, text\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_confirmed_deposit\(uuid, numeric, text, text, text\) TO service_role;/i,
  ],
  [
    'legacy process_user_deposit RPC is disabled and server-only',
    'supabase/migrations/20261016000003_disable_legacy_process_user_deposit.sql',
    /RAISE EXCEPTION[\s\S]*REVOKE ALL ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) TO service_role;/i,
  ],
  [
    'confirmed-deposit RPC checks state and confirmation threshold',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /v_deposit\.status <> 'CONFIRMED'[\s\S]*v_deposit\.confirmations < v_deposit\.required_confirmations/i,
  ],
  [
    'deposit ledger conflict aborts credit transaction',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /GET DIAGNOSTICS v_ledger_rows = ROW_COUNT;[\s\S]*IF v_ledger_rows <> 1 THEN[\s\S]*RAISE EXCEPTION/i,
  ],
  [
    'withdrawal claim batch is bounded and browser roles remain revoked',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /p_limit IS NULL OR p_limit < 1 OR p_limit > 100/i,
  ],
  [
    'withdrawal claimant is restricted to service role',
    'supabase/migrations/20261016000005_restrict_withdrawal_claim_rpc.sql',
    /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM PUBLIC;[\s\S]*REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) TO service_role;/i,
  ],
  [
    'canonical deposit RPC is restricted to server roles',
    'supabase/migrations/20261016000004_lock_canonical_deposit_rpc_to_server_roles.sql',
    /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([\s\S]*?FROM anon;[\s\S]*?REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([\s\S]*?FROM authenticated;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.process_deposit_atomic\([\s\S]*?TO service_role, postgres;/i,
  ],
  [
    'TRON receipt block hash is bound to the verified log',
    'src/jobs/depositIngestion.ts',
    /receipt\.blockHash\.toLowerCase\(\) !== log\.blockHash\.toLowerCase\(\)/i,
  ],
  [
    'deposit ingestion requires the service-role secret and has no anon-key fallback',
    'src/jobs/depositIngestion.ts',
    /const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY;[\s\S]{0,500}Missing SUPABASE_URL\/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/i,
  ],
  [
    'confirmed-deposit RPC refuses unconfigured or disabled assets',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /FROM public\.assets[\s\S]{0,120}code = v_asset_code[\s\S]{0,100}is_enabled IS TRUE[\s\S]{0,180}Deposit asset % is not configured and enabled/i,
  ],
  [
    'legacy caller-parameter deposit RPC cannot perform a credit',
    'supabase/migrations/20261016000003_disable_legacy_process_user_deposit.sql',
    /CREATE OR REPLACE FUNCTION public\.process_user_deposit[\s\S]{0,700}RAISE EXCEPTION/i,
  ],
];

let failed = 0;
for (const [name, path, pattern] of checks) {
  try {
    assert.match(read(path), pattern);
    console.log('PASS', name);
  } catch (error) {
    failed += 1;
    console.error('FAIL', name, error instanceof Error ? error.message : error);
  }
}

console.log(`Deposit SQL/source regression checks: ${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exitCode = 1;
