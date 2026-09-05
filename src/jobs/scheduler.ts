import 'dotenv/config';
import cron from 'node-cron';
import { checkHotWalletBalance } from './hotWalletMonitor';
import { processExpiredP2PTrades } from './p2pExpiryWorker';

console.log('[Worker Scheduler] Hot Wallet Monitoring Daemon Started.');

// 1. Run balance and health check every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    await checkHotWalletBalance('USDT');
  } catch (err: any) {
    console.error('[Hot Wallet Monitor Error]:', err.message);
  }
});

// 2. Hourly System Heartbeat
cron.schedule('0 * * * *', () => {
  console.log('[Worker Scheduler] Heartbeat: Single Hot Wallet Operations Active.');
});

// 3. P2P Expiry Daemon: Run auto-cancellation & escrow refund worker every minute
cron.schedule('* * * * *', async () => {
  try {
    await processExpiredP2PTrades();
  } catch (err: any) {
    console.error('[P2P Expiry Daemon Error]:', err?.message);
  }
});
