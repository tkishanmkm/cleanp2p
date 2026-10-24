import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Disabled legacy EVM dispatcher. It broadcast directly from the queue and
 * called complete_onchain_withdrawal before the configured confirmation depth.
 */
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

  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_EVM_DISPATCH_DISABLED',
      error: 'Legacy EVM dispatch is disabled. Use the confirmation-aware withdrawal queue worker.',
    },
    { status: 410 }
  );
}

export async function GET(req: NextRequest) {
  return POST(req);
}
