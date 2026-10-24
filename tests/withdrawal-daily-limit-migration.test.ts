import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261024000003_withdrawal_daily_limit_usd_atomic.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

assert.ok(sql.startsWith('-- Patch the deployed request_withdrawal definition'), 'migration documents its in-place patch strategy');
assert.ok(sql.includes('BEGIN;') && sql.trim().endsWith('COMMIT;'), 'migration is transaction-wrapped');
assert.ok(sql.includes('ALTER TABLE public.onchain_withdrawals') && sql.includes('ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT'), 'on-chain metadata column is added safely');
assert.ok(sql.includes('ALTER TABLE public.withdrawals') && sql.includes('ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT'), 'withdrawal metadata column is added safely');
assert.ok(sql.includes('pg_get_functiondef('), 'migration starts from the deployed function definition');
assert.ok(sql.includes("to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)' )") || sql.includes("to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)')"), 'migration targets the exact deployed RPC signature');
assert.ok(sql.includes('refusing to create a replacement from a stale definition'), 'missing RPC fails closed');
assert.ok(sql.includes('v_old_declaration') && sql.includes('v_new_declaration'), 'migration guards its declaration replacement');
assert.ok(sql.includes('v_old_valuation') && sql.includes('v_new_valuation'), 'migration guards its USD valuation replacement');
assert.ok(sql.includes('USD_EQUIVALENT_REQUIRED'), 'non-USDT requests without a USD valuation are rejected');
assert.ok(sql.includes('v_old_daily_check') && sql.includes('v_new_daily_check'), 'migration guards its daily-limit replacement');
assert.ok(sql.includes('LEFT JOIN public.onchain_withdrawals AS ow ON ow.id = w.id'), 'daily limit joins on-chain metadata by withdrawal ID');
assert.ok(sql.includes("WHEN UPPER(w.asset_symbol) = ''USDT''"), 'USDT amount is used as the USD fallback');
assert.ok(sql.includes("''broadcasted''") && sql.includes("''ambiguous_broadcast''"), 'broadcasted and ambiguous withdrawals are counted');
assert.ok(sql.includes('DAILY_LIMIT_UNVERIFIABLE'), 'unverifiable historical totals block new withdrawals');
assert.ok(sql.includes("COALESCE(UPPER(w.asset_symbol), '''')"), 'missing asset symbols cannot bypass valuation checks');
assert.ok(sql.includes('::NUMERIC <= 0') && sql.includes('::NUMERIC >= 1000000000000'), 'invalid and implausibly large USD values are rejected');
assert.ok(sql.includes("!~ ''^[0-9]+("), 'metadata numeric syntax is validated before casts');
assert.ok(sql.includes('replace(v_definition, E'), 'function definition line endings are normalized before guarded replacements');
assert.ok(sql.includes('missing or have invalid USD-equivalent values'), 'unverifiable historical values require reconciliation');
assert.ok(sql.includes('IF position(v_old_daily_check IN v_definition) = 0 THEN'), 'unexpected deployed logic aborts before replacement');
assert.ok(sql.includes('EXECUTE v_definition;'), 'only the guarded patched function definition is installed');
assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;'), 'untrusted roles are revoked');
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;'), 'trusted roles retain execute access');

console.log('Withdrawal daily-limit migration source checks passed (24 assertions).');
