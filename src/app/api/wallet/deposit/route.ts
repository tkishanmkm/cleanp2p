import { NextResponse } from 'next/server';

/**
 * This endpoint previously accepted caller-supplied transaction amounts and
 * confirmation counts before crediting balances. It is intentionally disabled.
 *
 * Deposits must be credited only by the monitored chain-ingestion workers,
 * which query chain data and submit it to process_deposit_atomic. Re-enable a
 * webhook only after implementing and testing the actual provider's signature
 * verification and independent transaction verification.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: 'Direct deposit credit is disabled. Deposits are processed by monitored chain ingestion.',
      code: 'DIRECT_DEPOSIT_CREDIT_DISABLED',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
