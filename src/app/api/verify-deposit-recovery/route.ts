import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired production debug/recovery endpoint. The previous public GET triggered
 * ingestion twice and returned hard-coded user, wallet, deposit, and ledger
 * records. Recovery must be performed through an authenticated operational
 * workflow with scoped access and audited output.
 */
function retiredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Deposit recovery diagnostics are disabled on the public API.',
      code: 'DEPOSIT_RECOVERY_DIAGNOSTICS_DISABLED',
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
