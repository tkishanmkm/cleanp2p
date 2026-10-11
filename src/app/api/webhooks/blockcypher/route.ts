import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired until provider-origin authentication and canonical chain verification
 * are implemented. This legacy endpoint accepted unauthenticated payloads and
 * forwarded caller-supplied amounts/confirmations to a privileged credit RPC.
 * BTC/LTC deposits are scanned by the authenticated canonical ingestion worker.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'BlockCypher webhook ingestion is disabled pending authenticated provider verification.',
      code: 'UNAUTHENTICATED_DEPOSIT_WEBHOOK_DISABLED',
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
