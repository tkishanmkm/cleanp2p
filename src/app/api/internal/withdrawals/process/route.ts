import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export async function POST(req: NextRequest) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.PROVISION_SERVICE_KEY,
      process.env.CHAIN_INGEST_SECRET,
    ],
    customHeaderNames: ['x-withdrawal-secret', 'x-service-key', 'x-worker-secret'],
  });

  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing withdrawal worker secret header.' },
      { status: 401 }
    );
  }

  // This endpoint used the legacy processor, which settled immediately after
  // broadcast. Keep it closed until callers are migrated to the canonical
  // confirmation-aware withdrawal queue and reconciliation worker.
  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_WITHDRAWAL_PROCESSOR_DISABLED',
      error: 'Legacy withdrawal dispatch is disabled. Use the confirmation-aware withdrawal worker.',
    },
    { status: 410 }
  );
}
