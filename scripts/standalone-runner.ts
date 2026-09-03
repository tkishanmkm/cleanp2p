// scripts/standalone-runner.ts (Used only if migrating off Vercel)
import fs from 'fs';
import cron from 'node-cron';
import { runDepositSweeper } from '../src/jobs/sweeperWorker';
import { processPendingWithdrawals } from '../src/jobs/withdrawalWorker';
import { reconcileLedgerVsChain } from '../src/jobs/reconciliationWorker';

// Automatically load local environment variables if available
if (typeof process.loadEnvFile === 'function') {
  if (fs.existsSync('.env.local')) {
    try {
      process.loadEnvFile('.env.local');
    } catch (_) {}
  }
  if (fs.existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch (_) {}
  }
}

console.log('🚀 Standalone Cron Runner initialized...');
console.log('• Deposit Sweeper scheduled for every 2 minutes (*/2 * * * *)');
console.log('• Withdrawal Dispatcher scheduled for every 1 minute (*/1 * * * *)');
console.log('• Solvency & Gas Check scheduled for every 15 minutes (*/15 * * * *)');

cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('[Runner] Executing deposit sweeper...');
    await runDepositSweeper();
  } catch (err: any) {
    console.error('[Runner Sweeper Error]:', err.message);
  }
});

cron.schedule('*/1 * * * *', async () => {
  try {
    console.log('[Runner] Executing withdrawal dispatch...');
    await processPendingWithdrawals();
  } catch (err: any) {
    console.error('[Runner Dispatcher Error]:', err.message);
  }
});

cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('[Runner] Executing reconciliation & gas check...');
    await reconcileLedgerVsChain();
  } catch (err: any) {
    console.error('[Runner Reconciliation Error]:', err.message);
  }
});
