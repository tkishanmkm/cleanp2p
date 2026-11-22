import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_DISPUTE_STATES = new Set(['open', 'pending', 'in_review', 'investigating']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = String(resolvedParams.tradeId || '').trim();
    if (!UUID_RE.test(tradeId)) return NextResponse.json({ error: 'A valid trade ID is required.' }, { status: 400 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) return NextResponse.json({ error: 'Authentication service is not configured.' }, { status: 503 });

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: { getAll: () => req.cookies.getAll() },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const totpCode = body?.totpCode || body?.totp_code || body?.code;
    const adminClient = getSupabaseAdminClient();

    const { data: trade, error: tradeError } = await adminClient
      .from('trades')
      .select('id, seller_id, buyer_id, status, escrow_status, paid_at, marked_paid_at, is_disputed')
      .eq('id', tradeId)
      .maybeSingle();
    if (tradeError) return NextResponse.json({ error: 'Trade authorization is temporarily unavailable.' }, { status: 503 });
    if (!trade) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    if (String(trade.seller_id) !== user.id) return NextResponse.json({ error: 'Only the trade seller can release escrow.' }, { status: 403 });

    const status = String(trade.status || '').toLowerCase().trim();
    const escrowStatus = String(trade.escrow_status || '').toLowerCase().trim();
    const { data: disputes, error: disputeError } = await adminClient
      .from('disputes').select('id, status').eq('trade_id', tradeId).limit(10);
    if (disputeError) return NextResponse.json({ error: 'Dispute state is temporarily unavailable.' }, { status: 503 });
    const hasOpenDispute = (disputes || []).some((d) => OPEN_DISPUTE_STATES.has(String(d.status || '').toLowerCase().trim()));
    if (trade.is_disputed === true || status === 'disputed' || escrowStatus === 'disputed' || hasOpenDispute) {
      return NextResponse.json({ error: 'Disputed trades must be resolved through the administrator dispute workflow.' }, { status: 409 });
    }

    const isPaid = Boolean(trade.paid_at || trade.marked_paid_at || escrowStatus === 'paid' || ['paid', 'buyer_marked_paid', 'payment_sent'].includes(status));
    if (!isPaid) return NextResponse.json({ error: 'Escrow can only be released after the buyer marks the trade as paid.' }, { status: 400 });

    const { data: sellerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !sellerProfile) {
      console.error('[P2P trade release] Seller security profile lookup failed:', profileError);
      return NextResponse.json({ error: 'Seller security settings are temporarily unavailable.' }, { status: 503 });
    }

    const is2faActive = Boolean(sellerProfile.is_2fa_enabled || sellerProfile.is_mfa_enabled || sellerProfile.two_factor_enabled);
    const secret = sellerProfile.totp_secret || sellerProfile.two_factor_secret;
    if (is2faActive && (!totpCode || !secret || !verify2FAOTP(secret, String(totpCode).trim(), true))) {
      return NextResponse.json({ error: 'A valid 2FA code is required to release escrow.' }, { status: 401 });
    }

    const { data, error } = await adminClient.rpc('release_trade_escrow', { p_trade_id: tradeId, p_caller_id: user.id });
    if (error || !data || data.success !== true) {
      console.error('[P2P trade release] Escrow RPC failed:', error || data);
      return NextResponse.json({ error: error?.message || data?.message || 'Escrow release failed.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[P2P trade release] Unexpected error:', err);
    return NextResponse.json({ error: 'Unable to release escrow at this time.' }, { status: 500 });
  }
}