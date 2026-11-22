import { NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * This legacy endpoint previously broadcast payouts outside the canonical
 * withdrawal worker, without the worker's network-specific verification,
 * durable broadcast evidence, and lease protections.
 *
 * Keep it authenticated but disabled. Scheduled withdrawals must run through
 * /api/cron/withdrawals/dispatch, which calls processPendingWithdrawals().
 */
export async function POST(req: Request) {
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
    error: 'Legacy withdrawal dispatcher is disabled. Use the canonical withdrawal worker.',
    code: 'LEGACY_WITHDRAWAL_DISPATCH_DISABLED',
    reconciliationRequired: false,
  }, { status: 410 });
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed. Use authenticated POST for this legacy endpoint.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
