import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Legacy endpoint disabled intentionally.
 *
 * This endpoint previously accepted a client-supplied userId and generated a
 * random EVM private key that was not securely persisted or integrated with
 * the platform's deterministic deposit/sweeping flow. Such addresses could
 * receive funds that the platform cannot recover.
 *
 * Use the authenticated /api/wallet/deposit-addresses endpoint, which resolves
 * identity from a verified Supabase session and provisions the canonical HD
 * deposit addresses.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'This legacy wallet creation endpoint is disabled. Use the authenticated deposit-addresses endpoint.',
      code: 'LEGACY_WALLET_CREATION_DISABLED',
    },
    { status: 410 }
  );
}
