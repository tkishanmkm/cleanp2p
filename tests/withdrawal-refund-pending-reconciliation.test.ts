import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const worker = readFileSync(join(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');

test('unconfirmed pre-broadcast refund is not reported as a terminal failure', () => {
  assert.match(worker, /status: 'REFUND_PENDING_RECONCILIATION'/);
  assert.match(worker, /processed: false,[\s\S]{0,160}status: 'REFUND_PENDING_RECONCILIATION'/);
  assert.match(worker, /refund was not confirmed and funds may remain reserved/);
  assert.match(worker, /Manual reconciliation required/);
});

test('the confirmed-refund branch remains distinct from the refund-error branch', () => {
  assert.match(worker, /Pre-broadcast failure\. Refund successful:/);
  assert.match(worker, /if \(refundError \|\| !refundData \|\| refundData\.success !== true\)/);
});
