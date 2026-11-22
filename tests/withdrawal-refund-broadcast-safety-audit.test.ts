import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql', 'utf8');
const adminReview = readFileSync('src/app/api/admin/withdrawals/review/route.ts', 'utf8');
const manualRefund = readFileSync('src/app/api/withdraw/refund/route.ts', 'utf8');
const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');
const start = migration.indexOf('CREATE FUNCTION public.process_failed_withdrawal(');
const end = start < 0 ? -1 : migration.indexOf('\n$function$;', start);
const fn = start < 0 || end < 0 ? '' : migration.slice(start, end + 12);

const checks: Array<[string, boolean]> = [
  ['forward refund function exists and is closed', fn.length > 0],
  ['distinct verified-revert and ignored legacy unbroadcast flags', /p_is_verified_revert BOOLEAN DEFAULT FALSE,\s*p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i.test(fn)],
  ['legacy unbroadcast flag is explicitly rejected', /IF COALESCE\(p_is_verified_unbroadcast, FALSE\) THEN[\s\S]*?RAISE EXCEPTION/i.test(fn)],
  ['revert requires a persisted transaction hash and checks paired hash', /persisted transaction hash[\s\S]*?paired withdrawal transaction hash mismatch/i.test(fn)],
  ['refund requires exact locked liability', /v_balance\.in_withdrawal < v_gross[\s\S]*?RAISE EXCEPTION/i.test(fn)],
  ['refund never clamps missing liability', !/GREATEST\s*\(\s*0\s*,\s*in_withdrawal\s*-\s*v_gross/i.test(fn)],
  ['deployed ledger shape and terminal idempotency evidence are used', /user_id, crypto, amount, type, reference_id, balance_after, metadata,[\s\S]*?asset, chain, status, created_at/i.test(fn) && /le\.status = 'REFUNDED'/i.test(fn)],
  ['admin rejection does not self-assert unbroadcast', !/p_is_verified_unbroadcast:\s*true/i.test(adminReview)],
  ['manual refund does not self-assert unbroadcast', !/p_is_verified_unbroadcast:\s*true/i.test(manualRefund)],
  ['worker does not self-assert unbroadcast', !/p_is_verified_unbroadcast:\s*true/i.test(worker)],
  ['TRON revert refund follows explicit failed transaction result', /if\s*\(isConfirmed\s*&&\s*success\)[\s\S]*?else if\s*\(success\s*===\s*false\)[\s\S]*?p_is_verified_revert:\s*true/i.test(worker)],
  ['EVM revert refund follows explicit receipt status zero', /if\s*\(confirmations\s*>=\s*chain\.requiredConfirmations\s*&&\s*status\s*===\s*1\)[\s\S]*?else if\s*\(status\s*===\s*0\)[\s\S]*?p_is_verified_revert:\s*true/i.test(worker)],
];

for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
const passed = checks.filter(([, ok]) => ok).length;
const failed = checks.length - passed;
console.log(`\nWithdrawal refund safety audit: ${passed}/${checks.length} passed; ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
