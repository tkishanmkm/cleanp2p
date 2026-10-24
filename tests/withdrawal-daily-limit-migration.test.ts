import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261024000003_withdrawal_daily_limit_usd_atomic.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

const profileLock = sql.indexOf('FROM public.profiles\n    WHERE id = p_user_id\n    FOR UPDATE;');
const dailyLimit = sql.indexOf('-- RULE 2: ROLLING 24-HOUR DAILY LIMIT');
const dailySum = sql.indexOf('SUM(\n            CASE', dailyLimit);
const missingValueGuard = sql.indexOf('IF v_missing_usd_equivalent_count > 0 THEN', dailyLimit);

assert.ok(sql.startsWith('-- Correct rolling 24-hour withdrawal limits'), 'migration explains its purpose');
assert.ok(sql.includes('BEGIN;') && sql.trim().endsWith('COMMIT;'), 'migration is transaction-wrapped');
assert.ok(profileLock >= 0 && dailyLimit > profileLock, 'per-user profile lock precedes daily-limit calculation');
assert.ok(sql.includes('LEFT JOIN public.onchain_withdrawals AS ow ON ow.id = w.id'), 'daily check reads on-chain USD metadata');
assert.ok(dailySum > dailyLimit, 'daily limit sums USD-equivalent values');
assert.ok(sql.includes("WHEN UPPER(w.asset_symbol) = 'USDT'\n                    THEN w.amount"), 'USDT amount is used as the USD fallback');
assert.ok(sql.includes('USD_EQUIVALENT_REQUIRED'), 'non-USDT requests without a verified USD equivalent fail closed');
assert.ok(sql.includes("'broadcasted'") && sql.includes("'ambiguous_broadcast'"), 'broadcasted and ambiguous withdrawals count toward limits');
assert.ok(missingValueGuard > dailySum, 'missing non-USDT USD values fail closed');
assert.ok(sql.includes('DAILY_LIMIT_UNVERIFIABLE'), 'unverifiable daily totals block new withdrawals');
assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;'), 'untrusted roles are revoked');
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;'), 'trusted roles retain execute access');

console.log('Withdrawal daily-limit migration source checks passed (11 assertions).');
