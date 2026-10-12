import { NextRequest, NextResponse } from 'next/server';
import { processWithdrawalQueue, processAllPendingWithdrawals } from '@/jobs/withdrawalWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const result = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.WORKER_SECRET,
      process.env.CRON_SECRET_KEY,
      process.env.CRON_SECRET,
    ],
    customHeaderNames: ['x-service-key', 'x-worker-secret', 'x-withdrawal-worker-secret'],
  });

  return result.authorized;
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
