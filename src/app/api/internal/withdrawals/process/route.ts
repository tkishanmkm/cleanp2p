import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy processor. All withdrawal dispatch must use the canonical
 * withdrawal worker, which atomically claims onchain_withdrawals and preserves
 * reservations for ambiguous broadcasts.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Legacy withdrawal processing is disabled. Use the authenticated canonical withdrawal queue.',
      code: 'LEGACY_WITHDRAWAL_PROCESSOR_DISABLED',
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
