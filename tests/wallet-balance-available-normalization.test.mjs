import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrimaryWalletAssetBalance } from '../src/lib/wallet-balance-normalization.ts';
import { readFileSync } from 'node:fs';

const balanceRoute = readFileSync('src/app/api/wallet/balance/route.ts', 'utf8');

test('wallet balance API uses the spendable-balance normalizer for the primary wallet_assets source', () => {
  assert.match(balanceRoute, /normalizePrimaryWalletAssetBalance\(row, activeEscrowMap\[symbol\]\)/);
  assert.match(balanceRoute, /import \{ normalizePrimaryWalletAssetBalance \}/);
  assert.doesNotMatch(
    balanceRoute,
    /balanceMap\[coin\]\.available = Math\.max\(0, balanceMap\[coin\]\.available - diff\)/,
    'active escrow fallback must not debit the spendable balance again',
  );
});

test('wallet_assets balance remains spendable after escrow and withdrawal reservations', () => {
  const result = normalizePrimaryWalletAssetBalance({
    balance: 90,
    locked_balance: 0,
    in_escrow: 10,
    in_withdrawal: 5,
  });

  assert.deepEqual(result, {
    available: 90,
    inEscrow: 10,
    inWithdrawal: 5,
    total: 105,
  });
});

test('explicit available value is not reduced and all lock aliases are reconciled by maximum', () => {
  const result = normalizePrimaryWalletAssetBalance({
    available: '72.5',
    balance: 100,
    locked_balance: 0,
    reserved_balance: 4,
    in_escrow: 25,
    locked_withdrawal: 3,
    in_withdrawal: 7,
  }, 30);

  assert.deepEqual(result, {
    available: 72.5,
    inEscrow: 30,
    inWithdrawal: 7,
    total: 109.5,
  });
});

test('malformed and negative wallet values fail closed to non-negative display values', () => {
  const result = normalizePrimaryWalletAssetBalance({
    balance: 'not-a-number',
    in_escrow: -20,
    in_withdrawal: Number.NaN,
  }, -1);

  assert.deepEqual(result, {
    available: 0,
    inEscrow: 0,
    inWithdrawal: 0,
    total: 0,
  });
});

console.log('PASS: primary wallet display preserves spendable balance and reconciles lock aliases without double subtraction.');
