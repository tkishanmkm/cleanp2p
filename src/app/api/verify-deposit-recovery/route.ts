import { NextResponse } from 'next/server';

// Read-only audit safety: the former diagnostic handler triggered ingestion
// and returned wallet/ledger records for hard-coded identifiers. Keep retired
// until an authenticated, non-mutating diagnostic is implemented.
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Deposit recovery diagnostic retired pending secure replacement.' },
    { status: 410 },
  );
}
