import { NextResponse } from 'next/server';

/**
 * This legacy webhook trusts provider-supplied transfer fields and confirmation
 * counts, including a default of 12 confirmations when the provider omits them.
 * HMAC authenticates the sender but does not prove chain finality or the exact
 * transfer/output. Do not credit funds directly from this endpoint.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      error: 'Direct deposit webhook crediting is disabled',
      code: 'UNVERIFIED_DEPOSIT_INGESTION_DISABLED',
      message:
        'This endpoint cannot credit deposits until it registers pending events and an independent verifier confirms the exact on-chain transfer and network-specific finality.',
    },
    { status: 410 }
  );
}
