import { NextResponse } from 'next/server';

/**
 * Fail-closed placeholder for the legacy deposit webhook.
 *
 * The former implementation trusted the webhook body for amount/asset/network
 * and passed a hard-coded confirmation count to a privileged crediting RPC.
 * A shared bearer secret authenticates the caller, but does not independently
 * prove that the transaction exists on the intended chain or that its amount,
 * token contract, destination and confirmations are correct.
 *
 * Do not restore crediting here until a specific provider's signature scheme
 * is verified and the event is independently checked against the chain. The
 * on-chain ingestion worker remains the supported deposit-discovery path.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Deposit webhook is temporarily disabled',
      code: 'WEBHOOK_CHAIN_VERIFICATION_REQUIRED',
    },
    { status: 503 }
  );
}
