import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/dashboard/wallet/page.tsx', 'utf8');

test('wallet dashboard reads balances from the authenticated authoritative endpoint', () => {
  assert.match(page, /fetch\('\/api\/wallet\/balance', \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(page, /api\/wallet\/balances\?address=/);
});

test('wallet dashboard submits a complete canonical ETH withdrawal intent', () => {
  assert.match(page, /asset: 'ETH'/);
  assert.match(page, /network: 'ETH'/);
  assert.match(page, /destinationAddress,/);
  assert.match(page, /amount,/);
  assert.match(page, /'x-idempotency-key': idempotencyKey/);
  assert.match(page, /getOrCreatePendingWithdrawalKey\(userId, fingerprint\)/);
  assert.match(page, /totpCode: totpCode\.trim\(\)/);
  assert.match(page, /autoComplete="one-time-code"/);
});

test('wallet dashboard reports queued status rather than pretending a transaction was already broadcast', () => {
  assert.match(page, /Withdrawal queued:/);
  assert.match(page, /Check withdrawal history for updates/);
  assert.doesNotMatch(page, /Success! Tx Hash:/);
});
