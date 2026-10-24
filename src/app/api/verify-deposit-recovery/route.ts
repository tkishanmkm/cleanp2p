import { NextResponse } from 'next/server';

/**
 * Retired diagnostic endpoint. The former unauthenticated GET route ran deposit
 * ingestion and returned user-specific wallet, deposit, and ledger data using
 * an admin client. Recovery diagnostics must be authenticated, narrowly scoped,
 * and must never return private financial records from a public endpoint.
 */
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Deposit recovery diagnostic is retired', code: 'DEPOSIT_RECOVERY_DIAGNOSTIC_RETIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
