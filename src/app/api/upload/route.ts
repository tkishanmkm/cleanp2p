import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Deprecated legacy upload endpoint.
 * The current application uses dedicated, authorization-scoped routes for
 * avatars, KYC records, and trade media. Keeping this generic endpoint enabled
 * would permit callers to select storage categories and object-key prefixes
 * without the corresponding resource-specific authorization checks.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This legacy upload endpoint is disabled. Use the dedicated profile, KYC, or trade-media upload flow.',
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
