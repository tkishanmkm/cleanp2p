import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * This was a diagnostic endpoint that directly invoked the privileged deposit-credit
 * RPC with hard-coded transaction details and caller-supplied confirmation evidence.
 * It is intentionally disabled. Use read-only database inspection and the verified
 * deposit confirmation worker for diagnostics; never expose a test credit endpoint.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Diagnostic deposit-credit endpoint is disabled.' },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: 'Diagnostic deposit-credit endpoint is disabled.' },
    { status: 410 }
  );
}
