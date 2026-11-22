import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyUserTotpForSensitiveAction } from '@/lib/2fa';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) {
      return NextResponse.json({ error: 'A valid trade ID is required.' }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }
    const totpCode = body.totpCode || body.totp_code || body.code;
    if (totpCode !== undefined && (typeof totpCode !== 'string' || totpCode.length > 32)) {
      return NextResponse.json({ error: 'Invalid two-factor authentication code format.' }, { status: 400 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Keep administrative identity claims out of the participant release endpoint;
    // dispute settlement must go through the dedicated verified-admin workflow.
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
      return NextResponse.json({ error: 'Use the authorized admin workflow for administrative trade actions.' }, { status: 403 });
    }

    const adminClient = getSupabaseAdminClient();

    // This user-facing route is seller-only; administrative dispute settlement uses
    // the dedicated admin workflow. Verify ownership before invoking service-role RPC.
    const { data: trade, error: tradeError } = await adminClient
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();
    if (tradeError) {
      console.error('[p2p/trades/release] Unable to verify seller ownership.', { code: tradeError.code });
      return NextResponse.json({ error: 'Unable to verify trade access right now.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found or not accessible.' }, { status: 404 });
    }
    if (trade.seller_id !== user.id) {
      return NextResponse.json({ error: 'Only the trade seller can release escrow through this route.' }, { status: 403 });
    }

    // 2FA check for sensitive trade release operation
    const { data: sellerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !sellerProfile) {
      console.error('[p2p/trades/release] Unable to verify seller security settings', { code: profileError?.code || null });
      return NextResponse.json({ error: 'Unable to verify account security settings. Please try again.' }, { status: 503 });
    }

    const is2faActive = Boolean(
      sellerProfile?.is_2fa_enabled || sellerProfile?.is_mfa_enabled || sellerProfile?.two_factor_enabled
    );
    const secret = sellerProfile?.totp_secret || sellerProfile?.two_factor_secret;

    if (is2faActive) {
      if (!totpCode) {
        return NextResponse.json(
          { error: 'TWO_FACTOR_REQUIRED: 2FA TOTP code is required to release trade escrow.' },
          { status: 403 }
        );
      }
      const verification = await verifyUserTotpForSensitiveAction(
        adminClient, user.id, secret, totpCode, 'trade_release'
      );
      if (!verification.ok) {
        return NextResponse.json(
          { error: verification.error },
          {
            status: verification.status,
            headers: verification.retryAfterSeconds
              ? { 'Retry-After': String(verification.retryAfterSeconds) }
              : undefined,
          }
        );
      }
    }

    // Execute atomic escrow release procedure via service_role client
    const { data, error } = await adminClient.rpc('release_trade_escrow', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
    });

    if (error || !data || typeof data !== 'object' || data.success !== true) {
      console.warn('[p2p/trades/release] Escrow release RPC rejected', { code: error?.code || null });
      return NextResponse.json({ error: 'Escrow release was rejected. Verify the trade status and try again.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Unable to process escrow release right now.' }, { status: 500 });
  }
}
