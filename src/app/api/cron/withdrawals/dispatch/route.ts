import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy dispatcher. Use /api/workers/withdrawals or
 * /api/workers/withdrawal-worker, both of which invoke the canonical queue.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Legacy withdrawal dispatch is disabled. Use the authenticated canonical withdrawal queue.',
      code: 'LEGACY_WITHDRAWAL_DISPATCH_DISABLED',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(_request: Request): Promise<NextResponse> {
  return retiredResponse();
}

export async function POST(_request: Request): Promise<NextResponse> {
  return retiredResponse();
}
