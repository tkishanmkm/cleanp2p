import { NextRequest, NextResponse } from 'next/server';
import { processWithdrawalQueue, processAllPendingWithdrawals } from '@/jobs/withdrawalWorker';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secretKey =
    process.env.WITHDRAWAL_WORKER_SECRET?.trim() ||
    process.env.CRON_SECRET_KEY?.trim() ||
    process.env.DEPOSIT_WORKER_SECRET?.trim();

  if (!secretKey) return true; // Allow in development if not explicitly configured

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const urlKey = req.nextUrl.searchParams.get('key');
  const serviceKey = req.headers.get('x-service-key') || req.headers.get('x-worker-secret');

  return token === secretKey || urlKey === secretKey || serviceKey === secretKey;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
  }

  const batch = req.nextUrl.searchParams.get('batch');
  if (batch === 'true' || batch === '1') {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10', 10);
    const result = await processAllPendingWithdrawals(limit);
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      type: 'batch',
      result,
    });
  }

  const result = await processWithdrawalQueue();
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    result,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
