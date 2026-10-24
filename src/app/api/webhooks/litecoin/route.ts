import { NextResponse } from 'next/server';

/**
 * Retired: provider payloads are not sufficient evidence to credit a deposit.
 * Route must remain disabled until it forwards a candidate to an independent
 * chain verifier and cannot call the credit RPC directly.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Webhook retired pending independent deposit verification', code: 'DEPOSIT_VERIFICATION_REQUIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
