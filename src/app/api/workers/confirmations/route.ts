import { NextRequest, NextResponse } from 'next/server';
import { runConfirmationsWorker } from '@/jobs/confirmationsWorker';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secretKey =
    process.env.CRON_SECRET_KEY?.trim() ||
    process.env.DEPOSIT_WORKER_SECRET?.trim();
  if (!secretKey) return true; // allow if no secret configured

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
