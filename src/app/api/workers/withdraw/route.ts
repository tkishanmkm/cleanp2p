import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * This legacy endpoint allowed direct hot-wallet broadcasts and immediately
 * settled withdrawals without the canonical confirmation monitor. It is
 * intentionally disabled. Use the confirmation-aware queue worker instead.
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
      { success: false, error: 'Unauthorized: invalid WITHDRAWAL_WORKER_SECRET' },
      { status: 401 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_DIRECT_WITHDRAWAL_DISABLED',
      error: 'Direct hot-wallet dispatch is disabled. Use the confirmation-aware withdrawal queue worker.',
    },
    { status: 410 }
  );
}
