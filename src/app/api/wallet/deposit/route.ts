import { NextResponse } from 'next/server';

/**
 * Retired: this endpoint accepted caller-supplied deposit amounts and passed
 * a fabricated confirmation count to the crediting RPC. Deposits must be
 * credited only by the verified chain-ingestion worker/webhook flow.
 *
 * Keep this response explicit so legacy clients fail visibly rather than
 * accidentally relying on an unsafe credit path.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'DEPOSIT_ENDPOINT_RETIRED',
      message: 'This endpoint cannot credit deposits. Use the authenticated, verified blockchain ingestion flow.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
