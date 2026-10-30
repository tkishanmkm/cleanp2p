import { NextResponse } from 'next/server';

/**
 * This legacy endpoint accepted caller-supplied amounts and transaction hashes,
 * and credited deposits using a hard-coded confirmation count. It also allowed
 * requests through when BLOCKCHAIN_WEBHOOK_SECRET was unset.
 *
 * Keep it disabled until the endpoint registers an untrusted pending event and
 * an independent chain-verification worker proves the exact transfer/output.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Direct deposit crediting is disabled',
      code: 'UNVERIFIED_DEPOSIT_INGESTION_DISABLED',
      message:
        'This endpoint cannot credit deposits directly. Use a verified ingestion path that checks the exact on-chain transfer and required network confirmations.',
    },
    { status: 410 }
  );
}
