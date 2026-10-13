import { NextRequest, NextResponse } from 'next/server';

// Retired until this listener verifies canonical receipts/outputs and uses the
// hardened ingestion path. Keep both methods closed to prevent scheduler retries
// from reaching the legacy credit implementation.
function retired() {
  return NextResponse.json(
    { error: 'Deposit listener retired: verified ingestion is not enabled.' },
    { status: 410 }
  );
}

export async function GET(_req: NextRequest) {
  return retired();
}

export async function POST(_req: NextRequest) {
  return retired();
}
