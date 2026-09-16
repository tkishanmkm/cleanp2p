import { NextRequest, NextResponse } from 'next/server';
import { reconcileLedgerVsChain } from '@/jobs/reconciliationWorker';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secretKey =
    process.env.CRON_SECRET_KEY?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.WORKER_SECRET?.trim();
  if (!secretKey) return true;

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const urlKey = req.nextUrl.searchParams.get('key');
  const serviceKey = req.headers.get('x-service-key') || req.headers.get('x-worker-secret');

  return token === secretKey || urlKey === secretKey || serviceKey === secretKey;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Worker] Executing reconciliation & gas check...');
    const result = await reconcileLedgerVsChain();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('[Cron Reconciliation Error]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

