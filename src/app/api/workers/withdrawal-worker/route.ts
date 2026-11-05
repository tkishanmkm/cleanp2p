import { NextResponse } from 'next/server';
import { processAllPendingWithdrawals } from '@/jobs/withdrawalWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [
        process.env.WITHDRAWAL_WORKER_SECRET,
        process.env.WORKER_SECRET,
      ],
      customHeaderNames: ['x-withdrawal-worker-secret', 'x-worker-secret'],
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
    }

    // Never dispatch directly: even one-item runs must pass through the singleton guard.
    const result = await processAllPendingWithdrawals(1);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[Withdrawal Worker] Fatal route error:', error.message);
    return NextResponse.json({ error: error.message || 'Withdrawal worker failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
