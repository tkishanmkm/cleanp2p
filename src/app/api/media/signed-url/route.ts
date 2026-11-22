import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Deprecated generic object-key signer.
 * Current media reads go through resource-scoped routes that validate trade
 * membership, file records, and moderator-only visibility before granting access.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Generic object-key signing is disabled. Use the resource-specific media route.' },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
