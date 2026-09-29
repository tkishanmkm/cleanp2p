/**
 * DEPRECATED / REDUNDANT SCHEDULER
 * 
 * src/worker.ts is the canonical production background daemon.
 * This file must not be started as a separate production worker.
 */

import 'dotenv/config';
import cron from 'node-cron';
import { runDepositIngestion } from './depositIngestion';
import { runDepositSweeper } from './sweeperWorker';
import { processPendingWithdrawals } from '../lib/withdrawal-processor';
import { checkHotWalletBalance } from './hotWalletMonitor';
import { processExpiredP2PTrades } from './p2pExpiryWorker';
import { runMarketPriceUpdate } from './priceUpdaterWorker';
import { reconcileLedgerVsChain } from './reconciliationWorker';

console.log('[Worker Scheduler] Multi-Chain HD Custodial Wallet Daemon Started.');

// 1. Ingest & scan on-chain deposits every minute (EVM, TRON, BTC, LTC)
cron.schedule('* * * * *', async () => {
  try {
    const res = await runDepositIngestion();
    const detectedCount = res.results?.length ?? 0;
    console.log('[Scheduler: Deposit Ingestion]', new Date().toISOString(), `Total detected: ${detectedCount}`);
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
    const sweptCount = sweepRes.filter((r) => r.status === 'SUCCESS').length;
    console.log('[Scheduler: Auto-Sweeper]', new Date().toISOString(), `Swept: ${sweptCount}/${sweepRes.length}`);
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

// 6. Market Price Updater: fetch live crypto/fiat rates and update DB every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    console.log('[Scheduler: Market Prices] Updating live crypto/fiat market prices...');
    const res = await runMarketPriceUpdate();
    if (res.success) {
      console.log('[Scheduler: Market Prices]', new Date().toISOString(), `Updated ${res.records_updated} price pairs across ${res.live_crypto_assets} assets and ${res.total_fiats} fiats.`);
    } else {
      console.warn('[Scheduler: Market Prices Notice]:', res.error);
    }
  } catch (err: any) {
    console.error('[Scheduler: Market Prices Error]:', err?.message);
  }
});

// 7. System Reconciliation: ledger vs on-chain reserve audit every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('[Scheduler: Reconciliation] Auditing ledger vs on-chain balances...');
    const report = await reconcileLedgerVsChain('USDT');
    console.log('[Scheduler: Reconciliation]', new Date().toISOString(), `Balanced: ${report.isBalanced}, Liability: ${report.totalDbLiability.toFixed(2)} USDT, On-Chain: ${report.onChainHotWalletBalance.toFixed(2)} USDT, Discrepancy: ${report.discrepancy.toFixed(2)} USDT.`);
  } catch (err: any) {
    console.error('[Scheduler: Reconciliation Error]:', err?.message);
  }
});

// 8. Hourly System Heartbeat
cron.schedule('0 * * * *', () => {
  console.log('[Worker Scheduler] Heartbeat: Multi-Chain Custodial Wallet Daemon Active.');
});


