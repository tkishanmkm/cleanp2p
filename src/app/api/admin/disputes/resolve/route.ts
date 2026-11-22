import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || auth.user.email || null;
    if (!UUID_RE.test(String(adminId || ''))) {
      return NextResponse.json({ success: false, error: 'Administrator identity is invalid.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const disputeId = String(body?.disputeId || '').trim();
    const tradeId = String(body?.tradeId || '').trim();
    const resolution = String(body?.resolution || '').trim().toUpperCase();
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

    if (!UUID_RE.test(disputeId) || !UUID_RE.test(tradeId) || !['RELEASE', 'CANCEL'].includes(resolution)) {
      return NextResponse.json({ success: false, error: 'Invalid dispute resolution parameters.' }, { status: 400 });
    }
    if (notes.length > 2000) {
      return NextResponse.json({ success: false, error: 'Resolution notes cannot exceed 2,000 characters.' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeError) {
      console.error('[Admin dispute] Dispute lookup failed:', disputeError);
      return NextResponse.json({ success: false, error: 'Dispute state is temporarily unavailable.' }, { status: 503 });
    }
    if (!dispute) {
      return NextResponse.json({ success: false, error: 'Dispute not found.' }, { status: 404 });
    }
    if (String(dispute.trade_id) !== tradeId) {
      return NextResponse.json({ success: false, error: 'Dispute does not belong to the supplied trade.' }, { status: 409 });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeError) {
      console.error('[Admin dispute] Trade lookup failed:', tradeError);
      return NextResponse.json({ success: false, error: 'Trade state is temporarily unavailable.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Associated trade not found.' }, { status: 404 });
    }

    const winnerId = resolution === 'RELEASE' ? trade.buyer_id : trade.seller_id;
    if (!UUID_RE.test(String(winnerId || ''))) {
      return NextResponse.json({ success: false, error: 'Trade participant identity is invalid.' }, { status: 409 });
    }

    // One service-only RPC performs settlement, dispute transition and audit insertion atomically.
    const { data, error } = await supabase.rpc('resolve_trade_dispute_with_audit', {
      p_dispute_id: disputeId,
      p_resolution: resolution,
      p_winner_id: winnerId,
      p_caller_id: adminId,
      p_admin_email: adminEmail,
      p_notes: notes || null,
    });

    if (error || !data || data.success !== true) {
      console.error('[Admin dispute] Atomic resolution failed:', error || data);
      return NextResponse.json({ success: false, error: error?.message || data?.message || 'Dispute settlement failed.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[Admin dispute] Unexpected failure:', err);
    return NextResponse.json({ success: false, error: 'Unable to resolve dispute at this time.' }, { status: 500 });
  }
}