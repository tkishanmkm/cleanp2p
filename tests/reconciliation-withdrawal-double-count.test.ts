import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerPath = resolve(process.cwd(), 'src/jobs/reconciliationWorker.ts');
const viewMigrationPath = resolve(process.cwd(), 'supabase/migrations/20260903000005_reconciliation_and_user_wallets.sql');
const withdrawalRpcPath = resolve(process.cwd(), 'supabase/migrations/20260903000002_withdrawal_rpcs.sql');

test('reconciliation does not add pending withdrawal liabilities twice', () => {
  const worker = readFileSync(workerPath, 'utf8');
  const viewMigration = readFileSync(viewMigrationPath, 'utf8');
  const withdrawalRpc = readFileSync(withdrawalRpcPath, 'utf8');

  assert.match(viewMigration, /wa\.available\s+AS\s+main_balance/i);
  assert.match(viewMigration, /\(wa\.locked_escrow\s*\+\s*wa\.locked_withdrawal\)\s+AS\s+locked_balance/i);
  assert.match(withdrawalRpc, /locked_withdrawal\s*=\s*locked_withdrawal\s*\+\s*v_total_deduct/i);
  assert.match(worker, /\.in\('status', \['PENDING', 'PENDING_APPROVAL', 'PROCESSING', 'NEEDS_APPROVAL'\]\)/);
  assert.match(worker, /const totalDbLiability = totalDbUserBalance;/);
  assert.doesNotMatch(worker, /const totalDbLiability = totalDbUserBalance\s*\+\s*totalPendingWithdrawals;/);
});
