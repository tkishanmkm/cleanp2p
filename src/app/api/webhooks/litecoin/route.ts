import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired for security: this endpoint previously accepted caller-supplied LTC
 * amounts and confirmations and forwarded them to a privileged credit RPC
 * without authenticating the webhook provider or independently verifying the
 * transaction. LTC deposits must be credited only by canonical chain ingestion.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Litecoin webhook ingestion is disabled pending authenticated provider verification.',
      code: 'UNAUTHENTICATED_DEPOSIT_WEBHOOK_DISABLED',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
