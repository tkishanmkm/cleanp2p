import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function legacyRouteResponse() {
  return NextResponse.json(
    {
      success: false,
      error: 'This legacy order-book endpoint is retired. Create advertisements through /ads/create and initiate trades through the canonical escrow trade flow.',
      code: 'LEGACY_P2P_ORDERS_ENDPOINT_RETIRED',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}

export async function GET() {
  return legacyRouteResponse();
}

export async function POST() {
  return legacyRouteResponse();
}
