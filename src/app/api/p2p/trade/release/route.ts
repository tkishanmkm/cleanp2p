import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { verify2FAOTP } from '@/lib/2fa';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User (Seller)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized request' },
        { status: 401 }
      );
    }

    // 2. Parse Payload
    const body = await request.json().catch(() => ({}));
    const tradeId = body.tradeId || body.trade_id;
    const totpCode = body.totpCode || body.totp_code || body.code;

    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Valid tradeId is required' },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdminClient();

    // 2FA check for sensitive trade release operation
    const { data: sellerProfile, error: sellerProfileError } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();

    if (sellerProfileError || !sellerProfile) {
      console.error('[P2P trade release] Seller security profile unavailable:', sellerProfileError?.code || 'PROFILE_MISSING');
      return NextResponse.json(
        { success: false, error: 'Seller security settings could not be verified. Please try again.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const is2faActive = Boolean(
      sellerProfile?.is_2fa_enabled || sellerProfile?.is_mfa_enabled || sellerProfile?.two_factor_enabled
    );
    const secret = sellerProfile?.totp_secret || sellerProfile?.two_factor_secret;

    if (is2faActive) {
      if (!totpCode) {
        return NextResponse.json(
          { success: false, error: 'TWO_FACTOR_REQUIRED: 2FA TOTP code is required to release trade escrow.' },
          { status: 403 }
        );
      }
      const isValid = verify2FAOTP(secret, String(totpCode).trim(), is2faActive);
      if (!isValid) {
        return NextResponse.json({ success: false, error: 'Invalid 2FA authentication code.' }, { status: 401 });
      }
    }

    // 3. Execute Atomic RPC Procedure (Releases Escrow to Buyer & Completes Trade) via admin client
    const { data, error } = await adminClient.rpc('release_trade_escrow', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
    });

    if (error) {
      console.error('[P2P trade release] release_trade_escrow RPC failed:', error.code || 'UNKNOWN');
      return NextResponse.json(
        { success: false, error: 'Escrow release could not be completed.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Fail closed: a returned JSON error must never be reported as a successful release.
    if (!data || data.success !== true) {
      return NextResponse.json(
        { success: false, error: 'Escrow release was not confirmed by the database.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json({
      success: true,
      tradeId: data.trade_id || tradeId,
      message: 'Escrow released successfully and buyer wallet credited.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
