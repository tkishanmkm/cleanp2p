import { NextResponse } from 'next/server';

/**
 * Retired for security: this listener inferred ERC-20 transfers from transaction
 * calldata and passed a hardcoded confirmation count to the crediting RPC.
 * It did not verify successful receipts and canonical token Transfer logs.
 *
 * Use the canonical deposit ingestion worker, which scans logs emitted by the
 * configured token contract and calculates confirmations from the chain head.
 * Do not re-enable this endpoint until receipt/log verification and network-
 * specific confirmation calculation are implemented and tested.
 */
function retiredResponse() {
  return NextResponse.json(
    {
      error: 'DEPOSIT_LISTENER_RETIRED',
      message: 'This deposit listener is disabled. Use the canonical verified deposit-ingestion worker.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
