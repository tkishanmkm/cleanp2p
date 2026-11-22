import { NextRequest, NextResponse } from 'next/server';
import { runDepositSweeper } from '@/jobs/sweeperWorker';
import { runMarketPriceUpdate, type PriceUpdateResult } from '@/jobs/priceUpdaterWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const result = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.CRON_SECRET_KEY,
      process.env.CRON_SECRET,
      process.env.WORKER_SECRET,
    ],
    customHeaderNames: ['x-service-key', 'x-worker-secret'],
  });

  return result.authorized;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Worker] Refreshing market prices before deposit sweeps...');
    let priceUpdate: PriceUpdateResult | null = null;
    try {
      priceUpdate = await runMarketPriceUpdate();
    } catch {
      // Sweeping independently fetches a fresh live price and fails closed if unavailable.
      console.error('[Cron Worker] Market-price refresh failed; sweep threshold checks will use live fallback.');
    }

    console.log('[Cron Worker] Executing deposit sweeper job...');
    const result = await runDepositSweeper();
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), priceUpdate, result });
  } catch {
    console.error('[Cron Sweeper Error] job failed');
    return NextResponse.json({ error: 'Cron sweeper job failed.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
