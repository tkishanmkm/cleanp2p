import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { verify2FAOTP } from '@/lib/2fa';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_DISPUTE_STATES = new Set(['open', 'pending', 'in_review', 'investigating']);

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized request' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const tradeId = String(body?.tradeId ?? body?.trade_id ?? '').trim();
    const totpCode = body?.totpCode ?? body?.totp_code ?? body?.code;
    if (!UUID_RE.test(tradeId)) {
      return NextResponse.json({ success: false, error: 'A valid trade ID is required.' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: trade, error: tradeError } = await adminClient
      .from('trades')
      .select('id, buyer_id, seller_id, status, escrow_status')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeError) {
      console.error('[P2P release] Trade lookup failed:', tradeError);
      return NextResponse.json({ success: false, error: 'Trade authorization is temporarily unavailable.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found.' }, { status: 404 });
    }

    const tradeStatus = String(trade.status || '').toLowerCase().trim();
    const escrowStatus = String(trade.escrow_status || '').toLowerCase().trim();
    const { data: disputes, error: disputeError } = await adminClient
      .from('disputes')
      .select('id, status')
      .eq('trade_id', tradeId)
      .limit(10);

    if (disputeError) {
      console.error('[P2P release] Dispute lookup failed:', disputeError);
      return NextResponse.json({ success: false, error: 'Trade dispute state is temporarily unavailable.' }, { status: 503 });
    }

    const hasOpenDispute =
      tradeStatus === 'disputed' ||
      escrowStatus === 'disputed' ||
      (disputes || []).some((dispute) => OPEN_DISPUTE_STATES.has(String(dispute.status || '').toLowerCase().trim()));

    if (hasOpenDispute) {
      return NextResponse.json({
        success: false,
        error: 'This trade has an open dispute. Resolve it through the administrator dispute workflow.',
        code: 'TRADE_DISPUTE_REQUIRES_ADMIN_RESOLUTION',
      }, { status: 409 });
    }

    let callerId = user.id;
    const isSeller = String(trade.seller_id) === user.id;

    if (!isSeller) {
      // Buyers and other users cannot release escrow. An active full admin must use the admin boundary.
      const adminAuth = await verifyServerAdmin(request);
      if (!adminAuth.authorized) {
        return adminAuth.response || NextResponse.json({ success: false, error: 'Only the trade seller or an authorized administrator can release escrow.' }, { status: 403 });
      }
      callerId = adminAuth.adminId || adminAuth.user.id;
    } else {
      // A profile lookup failure must never silently disable the seller's configured 2FA requirement.
      const { data: sellerProfile, error: profileError } = await adminClient
        .from('profiles')
        .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError || !sellerProfile) {
        console.error('[P2P release] Seller security profile unavailable:', profileError);
        return NextResponse.json({ success: false, error: 'Seller security settings are temporarily unavailable.' }, { status: 503 });
      }

      const is2faActive = Boolean(
        sellerProfile.is_2fa_enabled || sellerProfile.is_mfa_enabled || sellerProfile.two_factor_enabled
      );
      if (is2faActive) {
        const secret = sellerProfile.totp_secret || sellerProfile.two_factor_secret;
        if (!totpCode || !secret || !verify2FAOTP(secret, String(totpCode).trim(), true)) {
          return NextResponse.json({ success: false, error: 'A valid 2FA code is required to release trade escrow.' }, { status: 401 });
        }
      }
    }

    const { data, error } = await adminClient.rpc('release_trade_escrow', {
      p_trade_id: tradeId,
      p_caller_id: callerId,
    });

    if (error || !data || data.success === false) {
      console.error('[P2P release] Atomic escrow release failed:', error || data);
      return NextResponse.json({ success: false, error: error?.message || data?.message || 'Escrow release failed.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      tradeId: data.trade_id || tradeId,
      message: 'Escrow released successfully and buyer wallet credited.',
    });
  } catch (err: any) {
    console.error('[P2P release] Unexpected failure:', err);
    return NextResponse.json({ success: false, error: 'Unable to release escrow at this time.' }, { status: 500 });
  }
}