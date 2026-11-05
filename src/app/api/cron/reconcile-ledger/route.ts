import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function verifyCronAuth(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const validSecrets = [process.env.CRON_SECRET, process.env.WORKER_SECRET]
    .filter((s): s is string => Boolean(s && s.trim().length > 0));
  if (validSecrets.length === 0) return process.env.NODE_ENV === 'development';
  const headerBuf = Buffer.from(authHeader);
  for (const secret of validSecrets) {
    const expectedBuf = Buffer.from(`Bearer ${secret}`);
    if (headerBuf.length === expectedBuf.length && crypto.timingSafeEqual(headerBuf, expectedBuf)) return true;
  }
  return false;
}

/**
 * Financial safety interlock: disable automatic reconciliation/freezing until
 * the authoritative wallet model and transaction accounting formula are proven.
 * The previous implementation compared user_wallets against a partial event sum
 * and automatically froze wallets when it found a discrepancy. The schema audit
 * identified overlapping wallet models, so that action could freeze valid users.
 */
function unavailable() {
  return NextResponse.json({
    success: false,
    error: 'Automated ledger reconciliation is temporarily disabled pending authoritative balance-model verification.',
    code: 'LEDGER_RECONCILIATION_UNAVAILABLE',
  }, { status: 503 });
}

export async function POST(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return unavailable();
}

// GET must never trigger financial side effects. Keep compatibility with cron
// providers, but apply the same authorization and fail-closed response.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return unavailable();
}
