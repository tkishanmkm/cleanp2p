import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy payout endpoint.
 *
 * This endpoint previously claimed a legacy queue item and broadcast directly
 * from a hot wallet without using the canonical withdrawal reservation path.
 * All on-chain payouts must go through the authenticated withdrawal worker and
 * the atomic onchain_withdrawals queue.
 */
function retiredEndpointResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Legacy withdrawal dispatch is disabled. Use the canonical withdrawal queue.',
      code: 'LEGACY_WITHDRAWAL_DISPATCH_DISABLED',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  return retiredEndpointResponse();
}

// GET must never initiate a value-moving operation.
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return retiredEndpointResponse();
}
