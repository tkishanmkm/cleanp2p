import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * This legacy endpoint created unrelated random EVM wallets, accepted arbitrary
 * user IDs, and did not persist private keys for custody/sweeping. It is
 * intentionally retired; all supported deposit addresses must come from the
 * canonical HD derivation/provisioning flow after Supabase identity verification.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'LEGACY_WALLET_CREATION_DISABLED',
      message: 'Use the authenticated canonical deposit-address provisioning endpoint.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST() {
  return GET();
}
