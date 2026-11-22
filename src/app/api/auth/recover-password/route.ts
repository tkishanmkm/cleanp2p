import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Retired legacy endpoint.
 *
 * This route previously used placeholder credential fallbacks and generated a
 * recovery link without a CAPTCHA or a verified completion flow. Keep it closed
 * rather than maintaining a second, weaker password-recovery implementation.
 * Clients must use /api/auth/forgot-password.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This recovery endpoint has been retired. Use the secure password recovery form.' },
    {
      status: 410,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    }
  );
}
