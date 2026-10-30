import { NextResponse } from 'next/server';

/**
 * Direct Alchemy webhook crediting is intentionally disabled.
 *
 * The former handler trusted a fixed confirmation count and used output index
 * zero for every event. A signed webhook authenticates the sender, but does not
 * establish chain finality or uniquely identify token-transfer logs. Re-enable
 * this endpoint only after it durably registers pending events and an
 * independent chain-verification worker validates the exact transfer/log.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      code: 'UNVERIFIED_DEPOSIT_INGESTION_DISABLED',
      error:
        'Direct webhook crediting is disabled until pending-event registration and independent on-chain verification are implemented.',
    },
    { status: 410 }
  );
}
