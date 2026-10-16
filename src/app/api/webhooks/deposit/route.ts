import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// DECOMMISSIONED: this webhook previously forwarded payload-supplied amount,
// destination, network and confirmation values to a privileged deposit-credit RPC.
// HMAC authenticates the sender but does not independently verify chain facts.
// Re-enable only after provider events are independently checked against canonical
// chain data and configured token contracts before invoking the atomic credit RPC.
export async function POST() {
  return NextResponse.json(
    {
      error: 'DEPRECATED_ENDPOINT',
      message: 'Webhook deposit crediting is disabled until independent on-chain verification is implemented. Use the canonical ingestion pipeline.',
      decommissioned: true,
    },
    { status: 410 }
  );
}
