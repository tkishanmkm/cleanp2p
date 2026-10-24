import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy broadcaster. It accepted caller-supplied destination and amount
 * and broadcast directly from hot-wallet keys, bypassing the canonical atomic
 * onchain_withdrawals claim/reservation state machine.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Legacy direct withdrawal broadcast is disabled. Use the authenticated canonical withdrawal queue.',
      code: 'LEGACY_WITHDRAWAL_BROADCAST_DISABLED',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(_request: Request): Promise<NextResponse> {
  return retiredResponse();
}

export async function GET(_request: Request): Promise<NextResponse> {
  return retiredResponse();
}
