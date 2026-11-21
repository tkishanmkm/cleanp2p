import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy provisioning endpoint.
 *
 * The former handler used the shared CHAIN_INGEST_SECRET/PROVISION_SERVICE_KEY
 * to provision arbitrary user IDs and attempted to poll a wallet_provisioning
 * queue table that is not present in the current schema. The active database
 * profile trigger already targets /api/auth/provision-wallets with its
 * dedicated WALLET_PROVISIONING_BEARER credential.
 *
 * Use the authenticated canonical deposit-address routes for user requests.
 * Do not restore the legacy batch queue without an explicit schema and worker
 * design review.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_WALLET_PROVISIONING_DISABLED',
      error: 'This legacy provisioning endpoint is retired. Use the authenticated canonical deposit-address API.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST() {
  return GET();
}
