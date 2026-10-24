import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261024000001_withdrawal_refund_wallet_row_fail_closed.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

const walletUpdate = sql.indexOf('UPDATE public.wallet_assets');
const walletUpdateEnd = sql.indexOf('RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;', walletUpdate);
const missingRowGuard = sql.indexOf('IF NOT FOUND THEN', walletUpdateEnd);
const missingRowRaise = sql.indexOf('RAISE EXCEPTION', missingRowGuard);
const markFailed = sql.indexOf("SET status = 'FAILED'", missingRowRaise);

assert.ok(sql.startsWith('-- Fail closed'), 'migration explains its safety purpose');
assert.ok(sql.includes('BEGIN;') && sql.trim().endsWith('COMMIT;'), 'migration is transaction-wrapped');
assert.ok(walletUpdate >= 0, 'refund updates wallet_assets');
assert.ok(walletUpdateEnd > walletUpdate, 'refund captures whether wallet row was updated');
assert.ok(missingRowGuard > walletUpdateEnd, 'missing-row guard runs after wallet update');
assert.ok(missingRowRaise > missingRowGuard, 'missing wallet row raises an exception');
assert.ok(markFailed > missingRowRaise, 'withdrawal is not marked FAILED before the guard');
assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;'), 'untrusted roles are revoked');
assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO service_role, postgres;'), 'trusted roles retain execute access');

console.log('Withdrawal refund wallet-row migration source checks passed (9 assertions).');
