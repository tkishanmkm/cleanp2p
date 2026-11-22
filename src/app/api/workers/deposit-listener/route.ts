import { NextRequest, NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Compatibility endpoint for the retired single-block EVM listener.
 * All scanning now uses the canonical multi-chain ingestion module, which
 * records exact log/output indexes and only registers zero-confirmation
 * candidates. Balance credit remains isolated in confirmationsWorker.
 */
async function runCanonicalDepositListener(request: NextRequest) {
  const auth = verifyWorkerAuth(request, {
    allowedSecrets: [
      process.env.DEPOSIT_WORKER_SECRET,
      process.env.PROVISION_SERVICE_KEY,
    ],
    customHeaderNames: ['x-worker-secret', 'x-deposit-worker-secret', 'x-service-key', 'x-provision-key'],
  });

  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: 'Unauthorized worker invocation.' }, { status: 401 });
  }

  try {
    const result = await runDepositIngestion();
    const pendingCandidatesRegistered = result.results.reduce(
      (total, item) => total + Number(item.depositsDetected || 0),
      0
    );
    const errors = result.results.flatMap((item) => item.errors || []);

    return NextResponse.json(
      {
        success: true,
        pendingCandidatesRegistered,
        creditedCount: 0,
        credited: false,
        results: result.results,
        pendingRecheck: result.pendingRecheck,
        errors,
        message: 'Canonical scanners registered pending candidates. The separate confirmation worker alone can credit balances.',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error('[DEPOSIT_LISTENER] Canonical ingestion failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { success: false, error: 'Canonical deposit ingestion could not be completed.' },
      { status: 503 }
    );
  }
}

export async function GET(request: NextRequest) {
  return runCanonicalDepositListener(request);
}

export async function POST(request: NextRequest) {
  return runCanonicalDepositListener(request);
}
