import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { verifyUserTotpForSensitiveAction } from '@/lib/2fa';

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

    // Keep administrative identity claims out of the participant release endpoint;
    // dispute settlement must go through the dedicated verified-admin workflow.
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
      return NextResponse.json({ success: false, error: 'Use the authorized admin workflow for administrative trade actions.' }, { status: 403 });
    }

    // 2. Parse Payload
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'A valid JSON object is required.' }, { status: 400 });
    }
    const tradeId = typeof (body.tradeId || body.trade_id) === 'string'
      ? String(body.tradeId || body.trade_id).trim()
      : '';
    const totpCode = body.totpCode || body.totp_code || body.code;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const publicTradeIdPattern = /^[A-Za-z0-9_-]{6,64}$/;

    if (!uuidPattern.test(tradeId) && !publicTradeIdPattern.test(tradeId)) {
      return NextResponse.json(
        { success: false, error: 'Valid tradeId is required' },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdminClient();

    // This user-facing route is seller-only; administrative dispute settlement uses
    // the dedicated admin workflow. Resolve public identifiers to the canonical UUID.
    let tradeQuery = adminClient.from('trades').select('id, buyer_id, seller_id');
    tradeQuery = uuidPattern.test(tradeId)
      ? tradeQuery.eq('id', tradeId)
      : tradeQuery.eq('trade_id', tradeId);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();
    if (tradeError) {
      console.error('[p2p/trade/release] Unable to verify seller ownership.', { code: tradeError.code });
      return NextResponse.json({ success: false, error: 'Unable to verify trade access right now.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found or not accessible.' }, { status: 404 });
    }
    if (trade.seller_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Only the trade seller can release escrow through this route.' }, { status: 403 });
    }

    // 2FA check for sensitive trade release operation
    const { data: sellerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !sellerProfile) {
      console.error('[p2p/trade/release] Unable to verify seller security settings', { code: profileError?.code || null });
      return NextResponse.json({ success: false, error: 'Unable to verify account security settings. Please try again.' }, { status: 503 });
    }
    if (totpCode !== undefined && (typeof totpCode !== 'string' || totpCode.length > 32)) {
      return NextResponse.json({ success: false, error: 'Invalid two-factor authentication code format.' }, { status: 400 });
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
      const verification = await verifyUserTotpForSensitiveAction(
        adminClient, user.id, secret, totpCode, 'trade_release'
      );
      if (!verification.ok) {
        return NextResponse.json(
          { success: false, error: verification.error },
          {
            status: verification.status,
            headers: verification.retryAfterSeconds
              ? { 'Retry-After': String(verification.retryAfterSeconds) }
              : undefined,
          }
        );
      }
    }

    // 3. Execute Atomic RPC Procedure (Releases Escrow to Buyer & Completes Trade) via admin client
    const { data, error } = await adminClient.rpc('release_trade_escrow', {
      p_trade_id: trade.id,
      p_caller_id: user.id,
    });

    if (error || !data || typeof data !== 'object' || data.success !== true) {
      console.warn('[p2p/trade/release] Escrow release RPC rejected', { code: error?.code || null });
      return NextResponse.json(
        { success: false, error: 'Escrow release was rejected. Verify the trade status and try again.' },
        { status: 400 }
      );
    }

    // 4. Return Success Response
    return NextResponse.json({
      success: true,
      tradeId: data?.trade_id || tradeId,
      message: 'Escrow released successfully and buyer wallet credited.',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Unable to process escrow release right now.' },
      { status: 500 }
    );
  }
}
