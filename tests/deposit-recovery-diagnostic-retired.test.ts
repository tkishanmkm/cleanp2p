import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/verify-deposit-recovery/route.ts', 'utf8');
assert.match(source, /status:\s*410/);
assert.match(source, /DEPOSIT_RECOVERY_DIAGNOSTIC_RETIRED/);
assert.doesNotMatch(source, /getSupabaseAdminClient|runDepositIngestion|ledger_entries|wallet_assets/);
assert.doesNotMatch(source, /targetUserId|targetTxHash/);

console.log('public deposit recovery retirement source assertions passed (5 assertions)');
