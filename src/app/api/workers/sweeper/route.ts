import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * DECOMMISSIONED: Legacy sweeper worker endpoint
 * This route formerly processed the unhardened `sweep_queue` table and performed
 * direct unpersisted gas funding and token transfers.
 * It is permanently decommissioned to guarantee strict idempotency, pre-broadcast
 * persistence, and centralized reconciliation via the hardened `runDepositSweeper`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'DEPRECATED_ENDPOINT',
      message: 'Legacy sweep_queue worker endpoint is decommissioned to protect against unpersisted broadcasts and duplicate gas funding. All deposit sweeps must execute via the hardened sweeper worker (runDepositSweeper).',
      decommissioned: true,
      timestamp: new Date().toISOString(),
    },
    { status: 410 }
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}

