import { NextResponse } from 'next/server';

/**
 * Retired for security: provider webhook payloads are not sufficient by
 * themselves to authorize a wallet credit. The prior handler accepted
 * caller-supplied amount and confirmation metadata and called the financial
 * credit RPC without independently verifying the chain transaction/log.
 *
 * Route provider events into the canonical deposit-ingestion pipeline after
 * its authentication, chain verification, and idempotency checks. Do not
 * restore direct crediting here until the provider-specific signature and
 * event schema are verified and the transaction is independently rechecked.
 */
function retiredResponse() {
  return NextResponse.json(
    {
      error: 'DEPOSIT_WEBHOOK_RETIRED',
      message: 'Direct deposit-webhook crediting is disabled. Use the canonical verified deposit-ingestion pipeline.',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

export async function POST(_req: Request) {
  return retiredResponse();
}
