import 'dotenv/config';
import cron from 'node-cron';
import { runDepositIngestion } from './depositIngestion';
import { runDepositSweeper } from './sweeperWorker';
import { processPendingWithdrawals } from '../lib/withdrawal-processor';
import { checkHotWalletBalance } from './hotWalletMonitor';
import { processExpiredP2PTrades } from './p2pExpiryWorker';

console.log('[Worker Scheduler] Multi-Chain HD Custodial Wallet Daemon Started.');

// 1. Ingest & scan on-chain deposits every minute (EVM, TRON, BTC, LTC)
cron.schedule('* * * * *', async () => {
  try {
    const res = await runDepositIngestion();
    console.log('[Scheduler: Deposit Ingestion]', new Date().toISOString(), `Total detected: ${res.totalDetected}`);
  } catch (err: any) {
    console.error('[Scheduler: Deposit Ingestion Error]:', err?.message);
  }
});

// 2. Broadcast approved on-chain withdrawals with 2X Priority Gas every minute
cron.schedule('* * * * *', async () => {
  try {
    const summary = await processPendingWithdrawals(10);
    if (summary.processedCount > 0) {
      console.log('[Scheduler: Withdrawals]', new Date().toISOString(), `Processed: ${summary.processedCount}, Success: ${summary.successful}`);
    }
  } catch (err: any) {
    console.error('[Scheduler: Withdrawal Broadcaster Error]:', err?.message);
  }
});

// 3. Auto-sweep confirmed user balances to Hot Wallet every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const sweepRes = await runDepositSweeper();
    console.log('[Scheduler: Auto-Sweeper]', new Date().toISOString(), `Swept: ${sweepRes.sweptCount}/${sweepRes.candidatesCount}`);
  } catch (err: any) {
    console.error('[Scheduler: Auto-Sweeper Error]:', err?.message);
  }
});

// 4. P2P Expiry Daemon: Auto-cancel expired trades and return escrow every minute
cron.schedule('* * * * *', async () => {
  try {
    await processExpiredP2PTrades();
  } catch (err: any) {
    console.error('[Scheduler: P2P Expiry Daemon Error]:', err?.message);
  }
});

// 5. Hot Wallet Reserves & Gas Health Monitoring every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    await checkHotWalletBalance('USDT');
  } catch (err: any) {
    console.error('[Scheduler: Hot Wallet Monitor Error]:', err?.message);
  }
});

// 6. Hourly System Heartbeat
cron.schedule('0 * * * *', () => {
  console.log('[Worker Scheduler] Heartbeat: Multi-Chain Custodial Wallet Daemon Active.');
});

