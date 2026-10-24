import { NextResponse } from 'next/server';

/**
 * Retired: this endpoint accepted caller-supplied transaction fields and passed
 * them to a privileged deposit-credit RPC. A shared secret authenticates the
 * caller, but does not prove the blockchain event or its amount/recipient.
 *
 * Keep this endpoint closed until it is replaced by verifier-owned evidence
 * ingestion. Do not add a direct credit RPC call here.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      code: 'CHAIN_INGEST_RETIRED',
      depositsPaused: true,
      error: 'Chain ingestion is disabled pending independent, exact-event verification.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
