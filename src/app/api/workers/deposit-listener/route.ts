import { NextRequest, NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

/**
 * Compatibility endpoint: all chain scanning and crediting is delegated to
 * the canonical ingestion worker. Do not accept a caller-selected block or
 * caller-supplied deposit amount/confirmation count here.
 */
async function handle(req: NextRequest) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.DEPOSIT_WORKER_SECRET,
      process.env.PROVISION_SERVICE_KEY,
      process.env.WORKER_SECRET,
    ],
    customHeaderNames: [
      'x-worker-secret',
      'x-deposit-worker-secret',
      'x-service-key',
      'x-provision-key',
    ],
  });

  if (!auth.authorized) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized worker invocation' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const { results, pendingRecheck } = await runDepositIngestion();
    return NextResponse.json(
      {
        success: true,
        results,
        pendingRecheck,
        message: 'Canonical deposit ingestion completed.',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[Deposit Listener] Canonical ingestion failed:', error instanceof Error ? error.message : 'UNKNOWN');
    return NextResponse.json(
      { success: false, error: 'Canonical deposit ingestion failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
