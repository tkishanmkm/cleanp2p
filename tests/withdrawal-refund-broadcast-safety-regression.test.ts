import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql', 'utf8');
const adminReview = readFileSync('src/app/api/admin/withdrawals/review/route.ts', 'utf8');
const manualRefund = readFileSync('src/app/api/withdraw/refund/route.ts', 'utf8');
const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');

assert.match(manualRefund, /typeof withdrawalId !== 'string' \|\| !withdrawalId\.trim\(\)/);
assert.match(manualRefund, /Refund processing failed; reconciliation may be required/);
assert.doesNotMatch(manualRefund, /error:\s*`Refund processing failed:\s*\$\{rpcError\.message\}`/);
assert.match(manualRefund, /Unexpected refund request failure:[\s\S]*?Internal server error/);

const start = migration.indexOf('CREATE FUNCTION public.process_failed_withdrawal(');
assert.notEqual(start, -1, 'forward refund RPC definition must exist');
const end = migration.indexOf('\n$function$;', start);
assert.notEqual(end, -1, 'forward refund RPC body must be closed');
const fn = migration.slice(start, end + 12);

assert.match(fn, /p_is_verified_revert BOOLEAN DEFAULT FALSE,\s*p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i);
assert.match(fn, /IF COALESCE\(p_is_verified_unbroadcast, FALSE\) THEN[\s\S]*?RAISE EXCEPTION/i);
assert.match(fn, /IF COALESCE\(p_is_verified_revert, FALSE\) THEN[\s\S]*?persisted transaction hash[\s\S]*?paired withdrawal transaction hash mismatch/i);
assert.match(fn, /v_balance\.in_withdrawal < v_gross[\s\S]*?RAISE EXCEPTION/i);
assert.doesNotMatch(fn, /GREATEST\s*\(\s*0\s*,\s*in_withdrawal\s*-\s*v_gross/i);
assert.match(fn, /le\.reference_id = p_withdrawal_id::TEXT[\s\S]*?le\.status = 'REFUNDED'/i);
assert.match(fn, /INSERT INTO public\.ledger_entries \([\s\S]*?user_id, crypto, amount, type, reference_id, balance_after, metadata,[\s\S]*?asset, chain, status, created_at/i);
assert.doesNotMatch(fn, /wallet_id,\s*user_id,\s*asset_code,\s*delta_available/i);
assert.doesNotMatch(adminReview, /p_is_verified_unbroadcast:\s*true/);
assert.doesNotMatch(manualRefund, /p_is_verified_unbroadcast:\s*true/);
assert.match(worker, /if\s*\(isConfirmed\s*&&\s*success\)[\s\S]*?else if\s*\(success\s*===\s*false\)[\s\S]*?p_is_verified_revert:\s*true/i);
assert.match(worker, /if\s*\(confirmations\s*>=\s*chain\.requiredConfirmations\s*&&\s*status\s*===\s*1\)[\s\S]*?else if\s*\(status\s*===\s*0\)[\s\S]*?p_is_verified_revert:\s*true/i);

console.log('Withdrawal refund broadcast-safety regression contract checks passed.');
