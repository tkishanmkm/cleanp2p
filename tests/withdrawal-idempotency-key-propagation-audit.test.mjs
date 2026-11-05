import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const context = readFileSync('src/context/wallet-context.tsx', 'utf8');
const mainDialog = readFileSync('src/components/wallets/withdraw-dialog.tsx', 'utf8');
const alternateDialog = readFileSync('src/components/wallet/WithdrawalDialog.tsx', 'utf8');
const walletHelper = readFileSync('src/lib/wallet.ts', 'utf8');
const canonicalRoute = readFileSync('src/app/api/withdraw/route.ts', 'utf8');
const service = readFileSync('src/lib/services/withdrawalService.ts', 'utf8');

test('primary wallet context forwards its persistent intent key to the canonical endpoint', () => {
  assert.match(context, /getOrCreatePendingWithdrawalKeyDetails\(userId, withdrawalFingerprint\)/);
  assert.match(context, /'x-idempotency-key': idempotencyKey/);
  assert.match(context, /clearPendingWithdrawalKey\(userId, withdrawalFingerprint, idempotencyKey\)/);
  assert.match(context, /balances\[asset\]\.available < totalDeduction && !retry\.reused/);
  assert.match(context, /if \(!retry\.reused\) \{[\s\S]*?setRawBalances/);
  assert.doesNotMatch(context, /pendingWithdrawalKeys/);
});

test('primary withdrawal dialog routes through wallet context', () => {
  assert.match(mainDialog, /const \{ requestWithdrawal, refreshBalances, balances \} = useWallet\(\)/);
  assert.match(mainDialog, /await requestWithdrawal\(/);
});

test('canonical withdrawal API route forwards header or body key to service', () => {
  assert.match(canonicalRoute, /const idempotencyKey = request\.headers\.get\('x-idempotency-key'\)/);
  assert.match(canonicalRoute, /idempotencyKey: idempotencyKey \|\| body\.idempotencyKey/);
  assert.match(service, /rpc\('request_withdrawal_idempotent'/);
});

test('alternate dialog also uses wallet context rather than generating a new key itself', () => {
  assert.match(alternateDialog, /const \{ requestWithdrawal, refreshBalances \} = useWallet\(\)/);
  assert.match(alternateDialog, /await requestWithdrawal\(/);
});

test('legacy helper uses persistent retry keys and clears them only after a verified success', () => {
  assert.match(walletHelper, /getOrCreatePendingWithdrawalKey\(user\.id, withdrawalFingerprint\)/);
  assert.match(walletHelper, /'x-idempotency-key': safeKey/);
  assert.match(walletHelper, /resData\?\.success !== true/);
  assert.match(walletHelper, /clearPendingWithdrawalKey\(user\.id, withdrawalFingerprint, safeKey\)/);
  assert.match(walletHelper, /export async function createWithdrawalRequest[\s\S]*?await requestWithdrawal\(user, crypto, chain, amount, address, fee\)/);
});

test('primary withdrawal path persists the intent key across reloads and does not clear it for ambiguous responses', () => {
  assert.match(context, /getOrCreatePendingWithdrawalKeyDetails\(userId, withdrawalFingerprint\)/);
  assert.match(context, /clearPendingWithdrawalKey\(userId, withdrawalFingerprint, idempotencyKey\)/);
  assert.match(context, /retry\.reused/);
  assert.doesNotMatch(context, /pendingWithdrawalKeys/);
  assert.match(context, /resData\?\.success !== true[\s\S]*?Keep the key when the outcome is not definitively acknowledged/);
});

test('persistent retry key storage hashes the intent and uses cross-tab Web Locks when available', () => {
  const store = readFileSync('src/lib/withdrawal-idempotency-store.ts', 'utf8');
  assert.match(store, /window\.localStorage/);
  assert.match(store, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(store, /navigator\.locks\?\.request/);
  assert.match(store, /getOrCreatePendingWithdrawalKeyDetails/);
  assert.match(store, /reused:\s*true/);
  assert.match(store, /reused:\s*false/);
  assert.match(store, /Unable to persist withdrawal retry state/);
});
