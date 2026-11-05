import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy withdrawal worker.
 *
 * This route used a second direct-broadcast implementation that did not share
 * the canonical worker's lease, chain verification, or recovery lifecycle.
 * Keep authentication to avoid exposing endpoint state, but fail closed.
 * Scheduled dispatch must use /api/cron/withdrawals/dispatch.
 */
export async function POST(req: NextRequest) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.WORKER_SECRET,
    ],
    customHeaderNames: ['x-withdrawal-worker-secret', 'x-worker-secret'],
  });

  if (!auth.authorized) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_WITHDRAWAL_WORKER_DISABLED',
      error: 'This legacy withdrawal worker is disabled. Use the canonical scheduled withdrawal worker.',
    },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
