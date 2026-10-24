import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261024000003_withdrawal_daily_limit_usd_atomic.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

assert.ok(sql.startsWith('-- Patch the deployed request_withdrawal definition'), 'migration explains that it patches the deployed function');
assert.ok(sql.includes('BEGIN;') && sql.trim().endsWith('COMMIT;'), 'migration is transaction-wrapped');
assert.ok(sql.includes('ALTER TABLE public.onchain_withdrawals') && sql.includes('ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT'), 'migration restores the metadata column required by the deployed reservation RPC and daily-limit calculation');
assert.ok(sql.includes('pg_get_functiondef('), 'migration starts from the actual deployed function definition');
assert.ok(sql.includes("to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)' )") || sql.includes("to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)')"), 'migration targets the exact existing RPC signature');
assert.ok(sql.includes('refusing to create a replacement from a stale definition'), 'missing deployed RPC fails safely');
assert.ok(sql.includes("replace(v_definition, E'\\r\\n', E'\\n')"), 'migration normalizes line endings before guarded edits');
assert.ok(sql.includes('v_old_declaration') && sql.includes('v_new_declaration'), 'migration adds the missing-value guard variable');
assert.ok(sql.includes('v_old_valuation') && sql.includes('v_new_valuation'), 'migration replaces valuation logic without replacing other function logic');
assert.ok(sql.includes('USD_EQUIVALENT_REQUIRED'), 'non-USDT requests without verified USD valuation fail closed');
assert.ok(sql.includes('v_old_daily_check') && sql.includes('v_new_daily_check'), 'migration guards the exact existing daily-limit logic before replacing it');
assert.ok(sql.includes('LEFT JOIN public.onchain_withdrawals AS ow ON ow.id = w.id'), 'daily check reads on-chain USD metadata');
assert.ok(sql.includes("WHEN UPPER(w.asset_symbol) = ''USDT''"), 'USDT amount is used as the USD fallback');
assert.ok(sql.includes("''broadcasted''") && sql.includes("''ambiguous_broadcast''"), 'broadcasted and ambiguous withdrawals count toward limits');
assert.ok(sql.includes('DAILY_LIMIT_UNVERIFIABLE'), 'unverifiable daily totals block new withdrawals');
assert.ok(sql.includes("COALESCE(UPPER(w.asset_symbol), '''')"), 'missing asset symbols cannot evade USD valuation validation');
assert.ok(sql.includes("::NUMERIC <= 0") && sql.includes("::NUMERIC >= 1000000000000"), 'non-positive and implausibly large USD values fail closed');
assert.ok(sql.includes('IF position(v_old_daily_check IN v_definition) = 0 THEN'), 'unexpected deployed logic aborts before function replacement');
assert.ok(sql.includes('EXECUTE v_definition;'), 'only the verified patched deployed function is installed');
assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;'), 'untrusted roles are revoked');
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;'), 'trusted roles retain execute access');

console.log('Withdrawal daily-limit migration source checks passed (21 assertions).');
