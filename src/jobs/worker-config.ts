export interface WorkerFeatureFlags {
  depositIngestion: boolean;
  depositConfirmations: boolean;
  withdrawal: boolean;
  hotWalletMonitor: boolean;
  p2pExpiry: boolean;
  depositSweeper: boolean;
  marketPrices: boolean;
  ledgerReconciliation: boolean;
  depositIntegrityMonitor: boolean;
}

type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

function explicitlyEnabled(env: WorkerEnvironment, key: string): boolean {
  return env[key]?.trim().toLowerCase() === 'true';
}

/**
 * Every daemon capability defaults OFF. Financial side effects need both an
 * operational enable flag and a separately named approval flag; a generic
 * RUN_STANDALONE_WORKER=true is never sufficient to dispatch or settle funds.
 */
export function resolveWorkerFeatureFlags(env: WorkerEnvironment): WorkerFeatureFlags {
  return {
    depositIngestion: explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_DEPOSIT_INGESTION'),
    depositConfirmations:
      explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_DEPOSIT_CONFIRMATIONS') &&
      explicitlyEnabled(env, 'WAYONES_WORKER_DEPOSIT_CREDIT_APPROVED'),
    withdrawal:
      explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_WITHDRAWAL') &&
      explicitlyEnabled(env, 'WAYONES_WORKER_WITHDRAWAL_BROADCAST_APPROVED') &&
      explicitlyEnabled(env, 'WAYONES_WORKER_WITHDRAWAL_SETTLEMENT_APPROVED'),
    hotWalletMonitor: explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_HOT_WALLET_MONITOR'),
    p2pExpiry:
      explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_P2P_EXPIRY') &&
      explicitlyEnabled(env, 'WAYONES_WORKER_P2P_SETTLEMENT_APPROVED'),
    depositSweeper:
      explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_DEPOSIT_SWEEPER') &&
      explicitlyEnabled(env, 'WAYONES_WORKER_SWEEP_BROADCAST_APPROVED'),
    marketPrices: explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_MARKET_PRICES'),
    ledgerReconciliation: explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_LEDGER_RECONCILIATION'),
    depositIntegrityMonitor: explicitlyEnabled(env, 'WAYONES_WORKER_ENABLE_DEPOSIT_INTEGRITY'),
  };
}

export function hasAnyWorkerFeatureEnabled(flags: WorkerFeatureFlags): boolean {
  return Object.values(flags).some(Boolean);
}
