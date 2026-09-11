import 'dotenv/config';
import cron from 'node-cron';
import { supabaseAdmin } from './lib/supabaseAdmin';
import { startDepositIngestionWorker, stopDepositIngestionWorker } from './jobs/depositIngestion';
import { startConfirmationsWorker, stopConfirmationsWorker } from './jobs/confirmationsWorker';
import { startWithdrawalWorker, stopWithdrawalWorker } from './jobs/withdrawalWorker';
import { checkHotWalletBalance } from './jobs/hotWalletMonitor';
import { processExpiredP2PTrades } from './jobs/p2pExpiryWorker';
import { SUPPORTED_EVM_CHAINS, getEvmProvider } from './lib/blockchain/providers';

console.log('====================================================');
console.log('  PAXONES CRYPTO & ESCROW BACKGROUND WORKER DAEMON  ');
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

/**
 * 1. Initialize and verify Database Connection Pools & Supabase
 */
async function initializeDatabaseConnection(): Promise<boolean> {
  console.log('[Database] Initializing connection pool & database client...');
  try {
    const startTime = Date.now();
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    const latency = Date.now() - startTime;

    if (error && error.code !== 'PGRST116') {
      console.warn(`[Database] Connection notice (${latency}ms):`, error.message);
    }

    state.isDatabaseConnected = true;
    console.log(`[Database] PostgreSQL database pool ready & authenticated (${latency}ms latency).`);
    return true;
  } catch (err: any) {
    console.error('[Database] Failed to connect to database pool:', err.message);
    state.isDatabaseConnected = false;
    return false;
  }
}

/**
 * 2. Initialize Blockchain Providers & Network Listeners
 */
async function initializeBlockchainListeners(): Promise<void> {
  console.log('[Blockchain] Initializing RPC providers and chain event listeners...');

  for (const [netCode, config] of Object.entries(SUPPORTED_EVM_CHAINS)) {
    try {
      const provider = getEvmProvider(netCode);
      const blockNumber = await provider.getBlockNumber();
      state.activeEVMListeners.push(netCode);
      console.log(`[Blockchain: ${netCode}] Connected to ${config.name}. Current block: #${blockNumber}`);
    } catch (err: any) {
      console.warn(`[Blockchain: ${netCode}] RPC connection notice: ${err?.message || err}`);
    }
  }

  console.log('[Workers] Bootstrapping transaction ingestion, confirmation, and withdrawal daemons...');

  try {
    startDepositIngestionWorker(30000);
    state.depositWorkerRunning = true;
    console.log('[Workers] Deposit Ingestion Worker active (interval: 30s).');
  } catch (err: any) {
    console.error('[Workers] Deposit Ingestion Worker error:', err.message);
  }

  try {
    startConfirmationsWorker(30000);
    state.confirmationsWorkerRunning = true;
    console.log('[Workers] Confirmations Verification Worker active (interval: 30s).');
  } catch (err: any) {
    console.error('[Workers] Confirmations Worker error:', err.message);
  }

  try {
    startWithdrawalWorker(15000);
    state.withdrawalWorkerRunning = true;
    console.log('[Workers] Automated Withdrawal Queue Worker active (interval: 15s).');
  } catch (err: any) {
    console.error('[Workers] Withdrawal Worker error:', err.message);
  }
}

/**
 * 3. Schedule Recurring Maintenance Jobs & Cron Daemons
 */
function initializeScheduledJobs(): void {
  console.log('[Cron] Initializing scheduled cron daemons...');

  // Hot Wallet Balance & Reserve Monitor: every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      console.log('[Cron: Hot Wallet] Auditing hot wallet balances...');
      await checkHotWalletBalance('USDT');
    } catch (err: any) {
      console.error('[Cron: Hot Wallet Error]:', err.message);
    }
  });

  // P2P Expiry Daemon: auto-cancellation & escrow refund every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processExpiredP2PTrades();
    } catch (err: any) {
      console.error('[Cron: P2P Expiry Error]:', err?.message);
    }
  });

  // Worker Health Heartbeat: every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    const memory = process.memoryUsage();
    console.log('[Worker Heartbeat]', {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dbConnected: state.isDatabaseConnected,
      activeEVM: state.activeEVMListeners,
      rssMemoryMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    });
  });

  console.log('[Cron] All scheduled cron daemons active.');
}

/**
 * 4. Graceful Shutdown Handler
 */
function handleGracefulShutdown(signal: string): void {
  console.log(`\n[Worker] Received ${signal}. Initiating graceful shutdown...`);

  try {
    stopDepositIngestionWorker();
    stopConfirmationsWorker();
    stopWithdrawalWorker();
    console.log('[Worker] All background worker loops stopped cleanly.');
  } catch (err: any) {
    console.error('[Worker] Error during worker loop termination:', err.message);
  }

  console.log('[Worker] Shutdown complete. Exiting process.');
  process.exit(0);
}

/**
 * Main Worker Entry Point
 */
export async function startWorkerDaemon(): Promise<void> {
  console.log('[Worker] Starting Paxones Background Daemon...');
  await initializeDatabaseConnection();
  await initializeBlockchainListeners();
  initializeScheduledJobs();
  console.log('[Worker] All systems initialized and listening.');
}

// Only auto-run if explicitly executed via standalone CLI flag or direct node execution with explicit flag
if (typeof require !== 'undefined' && require.main === module && process.env.RUN_STANDALONE_WORKER === 'true') {
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('[Worker Unhandled Rejection]:', reason);
  });

  process.on('uncaughtException', (error) => {
    console.error('[Worker Uncaught Exception]:', error);
  });

  startWorkerDaemon().catch((err) => {
    console.error('[Worker Fatal Startup Error]:', err);
  });
}

