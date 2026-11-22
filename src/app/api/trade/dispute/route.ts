import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired singular-path dispute handler.
 * All dispute creation uses the participant-checked, atomic canonical route:
 * POST /api/trades/{tradeId}/dispute
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'This legacy dispute endpoint has been retired. Use the canonical participant-verified dispute workflow.',
      code: 'LEGACY_DISPUTE_ENDPOINT_RETIRED',
    },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
