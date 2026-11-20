import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareWalletAssetsToLedger,
  formatNumericUnits,
  parseNumericUnits,
  type LedgerBalanceSnapshotRow,
  type WalletAssetBalanceRow,
} from '../src/lib/security/wallet-ledger-reconciliation';

function wallet(overrides: Partial<WalletAssetBalanceRow> = {}): WalletAssetBalanceRow {
  return {
    id: 'wallet-1',
    user_id: 'user-1',
    asset_symbol: 'USDT',
    balance: '80.000000',
    locked_balance: '10.000000',
    reserved_balance: '10.000000',
    in_escrow: '5.000000',
    in_withdrawal: '3.000000',
    ...overrides,
  };
}

function ledger(
  overrides: Partial<LedgerBalanceSnapshotRow> = {}
): LedgerBalanceSnapshotRow {
  return {
    id: 'ledger-1',
    user_id: 'user-1',
    asset: 'USDT',
    crypto: 'USDT',
    balance_after: '80.000000',
    created_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

test('numeric reconciliation converts decimal and scientific notation without Number arithmetic', () => {
  assert.equal(formatNumericUnits(parseNumericUnits('0.00000001')!), '0.00000001');
  assert.equal(formatNumericUnits(parseNumericUnits('1.000000000000000001')!), '1.000000000000000001');
  assert.equal(formatNumericUnits(parseNumericUnits('1e-8')!), '0.00000001');
  assert.equal(formatNumericUnits(parseNumericUnits('1.25e2')!), '125');
  assert.equal(formatNumericUnits(parseNumericUnits('-2.5e-3')!), '-0.0025');
  assert.equal(parseNumericUnits('1.0000000000000000000'), 1_000_000_000_000_000_000n);
  assert.equal(parseNumericUnits('0.0000000000000000001'), null);
  assert.equal(parseNumericUnits('NaN'), null);
  assert.equal(parseNumericUnits(Number.POSITIVE_INFINITY), null);
});

test('canonical wallet spendable balance matches the latest balance_after snapshot', () => {
  const result = compareWalletAssetsToLedger([wallet()], [ledger()]);
  assert.equal(result.totalWalletAssetsAudited, 1);
  assert.equal(result.balancedWallets, 1);
  assert.equal(result.totalUsdtLiability, '98');
  assert.equal(result.discrepancies.length, 0);
});

test('held liabilities include reserved, escrow and withdrawal buckets exactly once', () => {
  const result = compareWalletAssetsToLedger([
    wallet({
      balance: '100',
      reserved_balance: '7',
      locked_balance: '7',
      in_escrow: '20',
      in_withdrawal: '3',
    }),
  ], [ledger({ balance_after: '100' })]);

  assert.equal(result.totalUsdtLiability, '130');
  assert.equal(result.discrepancies.length, 0);
});

test('locked_balance is a mirror of reserved_balance and is not double-counted', () => {
  const result = compareWalletAssetsToLedger([
    wallet({
      balance: '100',
      reserved_balance: '7',
      locked_balance: '7',
      in_escrow: '0',
      in_withdrawal: '0',
    }),
  ], [ledger({ balance_after: '100' })]);

  assert.equal(result.totalUsdtLiability, '107');
});

test('newer ledger balance_after snapshot is selected by timestamp', () => {
  const result = compareWalletAssetsToLedger(
    [wallet({ balance: '55', reserved_balance: '0', locked_balance: '0', in_escrow: '0', in_withdrawal: '0' })],
    [
      ledger({ id: 'ledger-old', balance_after: '80', created_at: '2026-11-19T10:00:00.000Z' }),
      ledger({ id: 'ledger-new', balance_after: '55', created_at: '2026-11-20T10:00:00.000Z' }),
    ]
  );

  assert.equal(result.balancedWallets, 1);
  assert.equal(result.discrepancies.length, 0);
});

test('same-time ledger snapshots with different balances are ambiguous rather than UUID-ordered', () => {
  const result = compareWalletAssetsToLedger(
    [wallet({ balance: '55' })],
    [
      ledger({ id: '00000000-0000-0000-0000-000000000001', balance_after: '80' }),
      ledger({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', balance_after: '55' }),
    ]
  );

  assert.equal(result.discrepancies.length, 1);
  assert.equal(result.discrepancies[0].anomalyType, 'LEDGER_SNAPSHOT_AMBIGUOUS');
});

test('multiple snapshots with an untrusted timestamp are never silently ordered', () => {
  const result = compareWalletAssetsToLedger(
    [wallet()],
    [
      ledger({ id: 'ledger-null-time', created_at: null }),
      ledger({ id: 'ledger-valid-time', created_at: '2026-11-20T10:00:00.000Z' }),
    ]
  );

  assert.equal(result.discrepancies[0].anomalyType, 'LEDGER_SNAPSHOT_AMBIGUOUS');
});

test('invalid negative accounting buckets block reconciliation', () => {
  const result = compareWalletAssetsToLedger([
    wallet({ reserved_balance: '-1', locked_balance: '-1' }),
  ], [ledger()]);

  assert.equal(result.discrepancies[0].anomalyType, 'NEGATIVE_BALANCE');
});

test('locked and reserved mirror drift is surfaced explicitly', () => {
  const result = compareWalletAssetsToLedger([
    wallet({ locked_balance: '4', reserved_balance: '5' }),
  ], [ledger()]);

  assert.equal(result.discrepancies[0].anomalyType, 'ACCOUNTING_BUCKET_INVALID');
});

test('positive wallet liability without a ledger snapshot is flagged', () => {
  const result = compareWalletAssetsToLedger([wallet()], []);
  assert.equal(result.discrepancies[0].anomalyType, 'UNAUTHORIZED_CREDIT');
});

test('orphaned non-zero ledger snapshot without a wallet asset is flagged', () => {
  const result = compareWalletAssetsToLedger([], [
    ledger({ balance_after: '5', user_id: 'orphan-user' }),
  ]);

  assert.equal(result.discrepancies[0].anomalyType, 'ORPHANED_LEDGER_ASSET');
});

test('zero wallet with no ledger snapshot is a valid empty account', () => {
  const result = compareWalletAssetsToLedger([
    wallet({ balance: '0', locked_balance: '0', reserved_balance: '0', in_escrow: '0', in_withdrawal: '0' }),
  ], []);

  assert.equal(result.balancedWallets, 1);
  assert.equal(result.discrepancies.length, 0);
});
