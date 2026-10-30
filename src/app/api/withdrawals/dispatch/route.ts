import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

// This legacy route directly broadcasts and finalizes withdrawals without the
// confirmation-aware state machine. Keep it closed until all callers migrate
// to /api/workers/withdrawals.
export async function POST(req: NextRequest) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.WORKER_SECRET,
      process.env.CRON_SECRET,
    ],
    customHeaderNames: ['x-worker-secret', 'x-withdrawal-worker-secret'],
  });

  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    error: 'Legacy withdrawal dispatcher is disabled because it bypasses confirmation-aware settlement.',
    replacement: '/api/workers/withdrawals',
  }, { status: 410 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
