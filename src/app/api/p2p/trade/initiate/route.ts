import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'This legacy trade-initiation endpoint is retired. Use the canonical /api/p2p/orders/create escrow route.',
      code: 'LEGACY_TRADE_INITIATION_ENDPOINT_RETIRED',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
