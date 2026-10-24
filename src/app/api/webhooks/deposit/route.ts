import { NextResponse } from 'next/server';

/**
 * Retired generic deposit webhook. Authentication alone does not prove the
 * transaction event, destination, asset, amount, or canonical chain inclusion.
 * Do not restore until it only queues candidates for independent verification.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'Webhook retired pending independent deposit verification', code: 'DEPOSIT_VERIFICATION_REQUIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
