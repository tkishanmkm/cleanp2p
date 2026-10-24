import { NextResponse } from 'next/server';

/**
 * Retired: a valid provider signature authenticates the sender, but does not
 * independently prove canonical inclusion or the exact transfer to credit.
 * Keep disabled until a chain verifier validates the receipt/log and the
 * database credit boundary accepts only verified evidence.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Webhook retired pending independent deposit verification', code: 'DEPOSIT_VERIFICATION_REQUIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
