import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [
        process.env.CRON_SECRET_KEY,
        process.env.CRON_SECRET,
        process.env.DEPOSIT_WORKER_SECRET,
      ],
      customHeaderNames: ['x-worker-secret', 'x-service-key'],
      checkQueryParam: true,
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized: Invalid worker secret' }, { status: 401 });
    }

    const { runDepositSweeper } = await import('@/jobs/sweeperWorker');
    const result = await runDepositSweeper();
    return NextResponse.json({ success: true, mode: 'automated_queue', timestamp: new Date().toISOString(), result });
  } catch (err: unknown) {
    // Keep detailed diagnostics in server logs; never expose provider/DB errors to callers.
    console.error('Deposit sweep GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'DEPRECATED_ENDPOINT',
      message: 'Direct transaction broadcast via legacy deposit-sweep POST is decommissioned. All on-chain deposits must be ingested via canonical depositIngestion workers, and all sweeps must be orchestrated via the hardened sweeperWorker (runDepositSweeper) with pre-broadcast persistence.',
      decommissioned: true,
      timestamp: new Date().toISOString(),
    },
    { status: 410 }
  );
}
