import { NextRequest, NextResponse } from 'next/server';
import { runConfirmationsWorker } from '@/jobs/confirmationsWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const result = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.CRON_SECRET_KEY,
      process.env.CRON_SECRET,
      process.env.DEPOSIT_WORKER_SECRET,
    ],
    customHeaderNames: ['x-service-key', 'x-worker-secret'],
    checkQueryParam: true,
  });

  return result.authorized;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
  }

  const result = await runConfirmationsWorker();
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    result,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
