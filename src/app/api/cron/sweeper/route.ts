import { NextRequest, NextResponse } from 'next/server';
import { runDepositSweeper } from '@/jobs/sweeperWorker';
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
    checkQueryParam: true,
  });

  return result.authorized;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Worker] Executing deposit sweeper job...');
    const result = await runDepositSweeper();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('[Cron Sweeper Error]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
