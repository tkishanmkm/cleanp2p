import { NextRequest, NextResponse } from 'next/server';
import { processPendingWithdrawals } from '@/lib/withdrawal-processor';

export async function POST(req: NextRequest) {
  try {
    // Validate worker authorization secret
    const providedSecret =
      req.headers.get('x-withdrawal-secret') ||
      req.headers.get('x-service-key') ||
      req.headers.get('authorization')?.replace('Bearer ', '');

    const configuredSecret =
      process.env.WITHDRAWAL_WORKER_SECRET ||
      process.env.PROVISION_SERVICE_KEY ||
      process.env.CHAIN_INGEST_SECRET;

    let isAuthorized = false;
    if (configuredSecret && providedSecret === configuredSecret) {
      isAuthorized = true;
    } else if (process.env.NODE_ENV === 'development' || !configuredSecret) {
      // In dev environment or without explicit secret, allow internal calls
      isAuthorized = true;
    }

    if (!isAuthorized) {
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

export async function GET(req: NextRequest) {
  // Support GET trigger for cron schedulers if authorized
  return POST(req);
}
