import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAnyWorkerFeatureEnabled, resolveWorkerFeatureFlags } from '../src/jobs/worker-config';

const off = {
  depositIngestion: false,
  depositConfirmations: false,
  withdrawal: false,
  hotWalletMonitor: false,
  p2pExpiry: false,
  depositSweeper: false,
  marketPrices: false,
  ledgerReconciliation: false,
  depositIntegrityMonitor: false,
};

test('all daemon capabilities default to disabled when no environment flags are supplied', () => {
  const flags = resolveWorkerFeatureFlags({});
  assert.deepEqual(flags, off);
  assert.equal(hasAnyWorkerFeatureEnabled(flags), false);
});

test('the generic standalone-worker switch cannot enable financial workers', () => {
  const flags = resolveWorkerFeatureFlags({ RUN_STANDALONE_WORKER: 'true' });
  assert.deepEqual(flags, off);
});

test('withdrawal requires explicit enable, broadcast approval and settlement approval', () => {
  assert.equal(resolveWorkerFeatureFlags({ WAYONES_WORKER_ENABLE_WITHDRAWAL: 'true' }).withdrawal, false);
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_WITHDRAWAL: 'true',
    WAYONES_WORKER_WITHDRAWAL_BROADCAST_APPROVED: 'true',
  }).withdrawal, false);
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_WITHDRAWAL: 'true',
    WAYONES_WORKER_WITHDRAWAL_BROADCAST_APPROVED: 'true',
    WAYONES_WORKER_WITHDRAWAL_SETTLEMENT_APPROVED: 'true',
  }).withdrawal, true);
});

test('deposit confirmation requires a distinct approval to credit user balances', () => {
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_DEPOSIT_CONFIRMATIONS: 'true',
  }).depositConfirmations, false);
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_DEPOSIT_CONFIRMATIONS: 'true',
    WAYONES_WORKER_DEPOSIT_CREDIT_APPROVED: 'true',
  }).depositConfirmations, true);
});

test('sweeps and expiry settlement need distinct approval gates', () => {
  assert.equal(resolveWorkerFeatureFlags({ WAYONES_WORKER_ENABLE_DEPOSIT_SWEEPER: 'true' }).depositSweeper, false);
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_DEPOSIT_SWEEPER: 'true',
    WAYONES_WORKER_SWEEP_BROADCAST_APPROVED: 'true',
  }).depositSweeper, true);
  assert.equal(resolveWorkerFeatureFlags({ WAYONES_WORKER_ENABLE_P2P_EXPIRY: 'true' }).p2pExpiry, false);
  assert.equal(resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_P2P_EXPIRY: 'true',
    WAYONES_WORKER_P2P_SETTLEMENT_APPROVED: 'true',
  }).p2pExpiry, true);
});

test('each read-only/ingress capability is individually opt-in', () => {
  const flags = resolveWorkerFeatureFlags({
    WAYONES_WORKER_ENABLE_DEPOSIT_INGESTION: 'true',
    WAYONES_WORKER_ENABLE_DEPOSIT_CONFIRMATIONS: 'true',
    WAYONES_WORKER_DEPOSIT_CREDIT_APPROVED: 'true',
    WAYONES_WORKER_ENABLE_MARKET_PRICES: 'true',
    WAYONES_WORKER_ENABLE_LEDGER_RECONCILIATION: 'true',
    WAYONES_WORKER_ENABLE_DEPOSIT_INTEGRITY: 'true',
    WAYONES_WORKER_ENABLE_HOT_WALLET_MONITOR: 'true',
  });
  assert.deepEqual(flags, {
    ...off,
    depositIngestion: true,
    depositConfirmations: true,
    marketPrices: true,
    ledgerReconciliation: true,
    depositIntegrityMonitor: true,
    hotWalletMonitor: true,
  });
  assert.equal(hasAnyWorkerFeatureEnabled(flags), true);
});

test('only the literal true enables a worker flag', () => {
  for (const value of ['1', 'yes', 'TRUE-ish', 'false', '', ' true '].slice(0, 5)) {
    assert.equal(resolveWorkerFeatureFlags({ WAYONES_WORKER_ENABLE_MARKET_PRICES: value }).marketPrices, false);
  }
  assert.equal(resolveWorkerFeatureFlags({ WAYONES_WORKER_ENABLE_MARKET_PRICES: ' true ' }).marketPrices, true);
});
