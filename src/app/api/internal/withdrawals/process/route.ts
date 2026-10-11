import { NextRequest, NextResponse } from 'next/server';
import { processPendingWithdrawals } from '@/lib/withdrawal-processor';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export async function POST(req: NextRequest) {
  try {
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

    // Parse optional batch limit from query or body
    let limit = 20;
    try {
      const url = new URL(req.url);
      const limitParam = url.searchParams.get('limit');
      if (limitParam) {
        limit = parseInt(limitParam, 10) || 20;
      }
    } catch {
      // Ignore URL parsing errors
    }

    // Process pending approved withdrawals
    const summary = await processPendingWithdrawals(limit);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: `Withdrawal broadcast processing failed: ${message}`,
      },
      { status: 500 }
    );
  }
}
