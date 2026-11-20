import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePrimaryWalletAssetBalance } from '../src/lib/wallet-balance-normalization';

test('spendable balance is not reduced by reserved, escrow or withdrawal buckets again', () => {
  const result = normalizePrimaryWalletAssetBalance({
    balance: '80.25',
    locked_balance: '10',
    reserved_balance: '10',
    in_escrow: '5',
    in_withdrawal: '3',
  });

  assert.equal(result.accountingValid, true);
  assert.equal(result.available, 80.25);
  assert.equal(result.reserved, 10);
  assert.equal(result.inEscrow, 5);
  assert.equal(result.inWithdrawal, 3);
  assert.equal(result.total, 98.25);
});

test('locked_balance is only a mirror of reserved_balance', () => {
  const result = normalizePrimaryWalletAssetBalance({
    balance: '100',
    locked_balance: '7',
    reserved_balance: '7',
    in_escrow: '20',
    in_withdrawal: '3',
  });

  assert.equal(result.total, 130);
  assert.equal(result.reserved, 7);
  assert.equal(result.inEscrow, 20);
});

test('reservation mirror drift is invalid instead of being silently maxed', () => {
  const result = normalizePrimaryWalletAssetBalance({
    balance: '100',
    locked_balance: '4',
    reserved_balance: '5',
    in_escrow: '0',
    in_withdrawal: '0',
  });

  assert.equal(result.accountingValid, false);
});

test('negative, missing and non-finite accounting buckets are invalid', () => {
  const negative = normalizePrimaryWalletAssetBalance({
    balance: '-1',
    locked_balance: '0',
    reserved_balance: '0',
    in_escrow: '0',
    in_withdrawal: '0',
  });
  const missing = normalizePrimaryWalletAssetBalance({
    balance: '1',
    locked_balance: '0',
    reserved_balance: null,
    in_escrow: '0',
    in_withdrawal: '0',
  });
  const notFinite = normalizePrimaryWalletAssetBalance({
    balance: 'Infinity',
    locked_balance: '0',
    reserved_balance: '0',
    in_escrow: '0',
    in_withdrawal: '0',
  });

  assert.equal(negative.accountingValid, false);
  assert.equal(missing.accountingValid, false);
  assert.equal(notFinite.accountingValid, false);
});
