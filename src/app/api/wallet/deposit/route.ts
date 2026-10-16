import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * DECOMMISSIONED: this legacy endpoint accepted caller-supplied transaction
 * details and credited funds through a privileged RPC without independently
 * verifying the transaction against the blockchain. Do not re-enable it.
 * Deposits must be processed by the canonical chain ingestion pipeline.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'DEPRECATED_ENDPOINT',
      message: 'Direct deposit crediting is disabled. Deposits are credited only by the verified chain-ingestion pipeline.',
      decommissioned: true,
    },
    { status: 410 }
  );
}
