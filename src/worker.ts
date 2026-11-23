import 'dotenv/config';
import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabaseAdmin';
import { startDepositIngestionWorker, stopDepositIngestionWorker } from './jobs/depositIngestion';
import { startConfirmationsWorker, stopConfirmationsWorker } from './jobs/confirmationsWorker';
import { startWithdrawalWorker, stopWithdrawalWorker } from './jobs/withdrawalWorker';
import { checkHotWalletBalance } from './jobs/hotWalletMonitor';
import { processExpiredP2PTrades } from './jobs/p2pExpiryWorker';
import { runDepositSweeper } from './jobs/sweeperWorker';
import { runDepositChainIntegrityMonitor } from './jobs/depositIntegrityWorker';
import { runMarketPriceUpdate } from './jobs/priceUpdaterWorker';
import { reconcileLedgerVsChain } from './jobs/reconciliationWorker';
import { SUPPORTED_EVM_CHAINS, getEvmProvider } from './lib/blockchain/providers';
import { hasAnyWorkerFeatureEnabled, resolveWorkerFeatureFlags, type WorkerFeatureFlags } from './jobs/worker-config';

console.log('====================================================');
console.log('  Wayones CRYPTO & ESCROW BACKGROUND WORKER DAEMON  ');
console.log('====================================================');

interface WorkerState {
  isDatabaseConnected: boolean;
  activeEVMListeners: string[];
  depositWorkerRunning: boolean;
  confirmationsWorkerRunning: boolean;
  withdrawalWorkerRunning: boolean;
  startedAt: string;
}

const state: WorkerState = {
  isDatabaseConnected: false,
  activeEVMListeners: [],
  depositWorkerRunning: false,
  confirmationsWorkerRunning: false,
  withdrawalWorkerRunning: false,
  startedAt: new Date().toISOString(),
};

const scheduledTasks: Array<{ stop: () => void }> = [];

async function initializeDatabaseConnection(): Promise<boolean> {
  console.log('[Database] Initializing connection pool & Supabase...');
  try {
    const startedAt = Date.now();
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    const latency = Date.now() - startedAt;
    if (error) {
      state.isDatabaseConnected = false;
      throw new Error(`Database readiness check failed (${latency}ms, code=${error.code || 'unknown'}): ${error.message}`);
    }
    state.isDatabaseConnected = true;
    console.log(`[Database] Authenticated database connection ready (${latency}ms).`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Database] Worker startup check failed:', message);
    state.isDatabaseConnected = false;
    return false;
  }
}

async function initializeBlockchainListeners(features: WorkerFeatureFlags): Promise<void> {
  const needsEvmProviders = features.depositIngestion || features.depositConfirmations;
  if (needsEvmProviders) {
    console.log('[Blockchain] Checking EVM providers required by explicitly enabled workers...');
    for (const [networkCode, config] of Object.entries(SUPPORTED_EVM_CHAINS)) {
      try {
        const provider = getEvmProvider(networkCode);
        const blockNumber = await provider.getBlockNumber();
        state.activeEVMListeners.push(networkCode);
        console.log(`[Blockchain: ${networkCode}] Connected to ${config.name}. Current block: #${blockNumber}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Blockchain: ${networkCode}] Provider unavailable:`, message);
      }
    }
  }

  if (features.depositIngestion) {
    startDepositIngestionWorker(30000);
    state.depositWorkerRunning = true;
    console.log('[Workers] Deposit ingestion enabled (30-second poll).');
  } else {
    console.log('[Workers] Deposit ingestion remains disabled.');
  }

  if (features.depositConfirmations) {
    startConfirmationsWorker(30000);
    state.confirmationsWorkerRunning = true;
    console.log('[Workers] Deposit confirmation enabled (30-second poll).');
  } else {
    console.log('[Workers] Deposit confirmation remains disabled.');
  }

  if (features.withdrawal) {
    startWithdrawalWorker(15000);
    state.withdrawalWorkerRunning = true;
    console.log('[Workers] Withdrawal dispatch/settlement enabled by both explicit approval flags.');
  } else {
    console.log('[Workers] Withdrawal dispatch/settlement remains disabled; enable, broadcast and settlement gates are all required.');
  }
}

function scheduleJob(
  enabled: boolean,
  name: string,
  expression: string,
  action: () => Promise<void> | void,
): void {
  if (!enabled) {
    console.log(`[Cron] ${name} disabled; no schedule registered.`);
    return;
  }

  scheduledTasks.push(cron.schedule(expression, async () => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Cron: ${name}] Job failed:`, message);
    }
  }));
  console.log(`[Cron] ${name} scheduled: ${expression}`);
}

function initializeScheduledJobs(features: WorkerFeatureFlags): void {
  scheduleJob(features.hotWalletMonitor, 'Hot wallet monitor', '*/15 * * * *', async () => {
    await checkHotWalletBalance('USDT');
  });

  scheduleJob(features.p2pExpiry, 'P2P expiry and settlement', '* * * * *', async () => {
    const result = await processExpiredP2PTrades();
    if (!result.success) throw new Error(result.error || 'P2P expiry RPC rejected the request');
  });

  scheduleJob(features.depositSweeper, 'Deposit sweeper', '*/5 * * * *', async () => {
    const results = await runDepositSweeper();
    const successCount = results.filter((result) => result.status === 'SUCCESS').length;
    console.log(`[Cron: Deposit sweeper] Completed ${successCount}/${results.length} sweep result(s).`);
  });

  scheduleJob(features.marketPrices, 'Market price updater', '*/5 * * * *', async () => {
    const result = await runMarketPriceUpdate();
    if (!result.success) throw new Error(result.error || 'Market price update was unsuccessful');
    console.log(`[Cron: Market prices] Updated ${result.records_updated} record(s).`);
  });

  scheduleJob(features.ledgerReconciliation, 'Ledger reconciliation', '*/15 * * * *', async () => {
    const report = await reconcileLedgerVsChain('USDT');
    console.log('[Cron: Ledger reconciliation]', {
      balanced: report.isBalanced,
      discrepancy: report.discrepancy,
    });
  });

  scheduleJob(features.depositIntegrityMonitor, 'Deposit chain integrity monitor', '*/5 * * * *', async () => {
    const report = await runDepositChainIntegrityMonitor();
    console.log('[Cron: Deposit integrity]', report);
  });

  if (hasAnyWorkerFeatureEnabled(features)) {
    scheduledTasks.push(cron.schedule('*/5 * * * *', () => {
      const memory = process.memoryUsage();
      console.log('[Worker Heartbeat]', {
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        dbConnected: state.isDatabaseConnected,
        activeEVMProviders: state.activeEVMListeners,
        depositIngestion: state.depositWorkerRunning,
        depositConfirmations: state.confirmationsWorkerRunning,
        withdrawals: state.withdrawalWorkerRunning,
        rssMemoryMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      });
    }));
  }

  if (scheduledTasks.length === 0) {
    console.log('[Cron] No recurring jobs are active.');
  }
}

function stopScheduledJobs(): void {
  for (const task of scheduledTasks.splice(0)) {
    try {
      task.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Cron] Could not stop a scheduled job cleanly:', message);
    }
  }
}

function handleGracefulShutdown(signal: string): void {
  console.log(`\n[Worker] Received ${signal}. Initiating graceful shutdown...`);
  stopScheduledJobs();
  if (state.depositWorkerRunning) stopDepositIngestionWorker();
  if (state.confirmationsWorkerRunning) stopConfirmationsWorker();
  if (state.withdrawalWorkerRunning) stopWithdrawalWorker();
  console.log('[Worker] Enabled background loops and schedules stopped.');
  process.exit(0);
}

export async function startWorkerDaemon(): Promise<void> {
  console.log('[Worker] Starting Wayones background daemon...');
  const features = resolveWorkerFeatureFlags(process.env);
  console.log('[Worker] Explicit feature gate snapshot:', features);

  if (!hasAnyWorkerFeatureEnabled(features)) {
    console.warn('[Worker] No worker feature is explicitly enabled. Exiting without connecting to chains or starting jobs.');
    return;
  }

  const databaseReady = await initializeDatabaseConnection();
  if (!databaseReady) throw new Error('WORKER_STARTUP_ABORTED_DATABASE_NOT_READY');

  await initializeBlockchainListeners(features);
  initializeScheduledJobs(features);
  console.log('[Worker] Enabled features initialized. Disabled features remain stopped.');
}

// The standalone flag only selects the daemon entrypoint. Individual feature
// flags (and separate financial approval flags) are still required for work.
if (typeof require !== 'undefined' && require.main === module && process.env.RUN_STANDALONE_WORKER === 'true') {
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[Worker Unhandled Rejection]:', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[Worker Uncaught Exception]:', error);
  });
  startWorkerDaemon().catch((error) => {
    console.error('[Worker Fatal Startup Error]:', error);
    process.exitCode = 1;
  });
}
