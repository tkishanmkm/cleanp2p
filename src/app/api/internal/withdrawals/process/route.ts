import { NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy payout endpoint. It used the unleased withdrawal processor,
 * which could broadcast and mark withdrawals complete without the canonical
 * worker's durable broadcast evidence and confirmation workflow.
 *
 * All dispatch must go through /api/cron/withdrawals/dispatch and the
 * owner-token-fenced worker. This endpoint intentionally performs no DB writes
 * and no blockchain calls.
 */
export async function POST(req: Request) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.WORKER_SECRET,
      process.env.CRON_SECRET,
    ],
    customHeaderNames: ['x-withdrawal-secret', 'x-worker-secret', 'x-cron-secret'],
  });

  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    error: 'Legacy withdrawal processor is disabled. Use the canonical lease-aware withdrawal worker.',
    code: 'LEGACY_WITHDRAWAL_PROCESSOR_DISABLED',
    reconciliationRequired: false,
  }, { status: 410 });
}
