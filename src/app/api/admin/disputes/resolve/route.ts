import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized || !auth.user) {
      return auth.response ?? NextResponse.json(
        { success: false, error: 'Administrator authorization required' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'A valid JSON request body is required' }, { status: 400 });
    }

    const { disputeId, tradeId, resolution, notes } = body;
    if (
      typeof disputeId !== 'string' || !UUID_RE.test(disputeId) ||
      typeof tradeId !== 'string' || !UUID_RE.test(tradeId) ||
      !['RELEASE', 'CANCEL'].includes(resolution)
    ) {
      return NextResponse.json({ success: false, error: 'Invalid resolution parameters' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // Verify the dispute belongs to the supplied trade before settlement.
    const { data: dispute, error: disputeLookupError } = await supabase
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeLookupError || !dispute || dispute.trade_id !== tradeId) {
      return NextResponse.json({ success: false, error: 'Dispute or associated trade not found' }, { status: 404 });
    }

    const { data: trade, error: tradeLookupError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeLookupError || !trade) {
      return NextResponse.json({ success: false, error: 'Associated trade not found' }, { status: 404 });
    }

    const winnerId = resolution === 'RELEASE' ? trade.buyer_id : trade.seller_id;
    if (typeof winnerId !== 'string' || !UUID_RE.test(winnerId)) {
      return NextResponse.json({ success: false, error: 'Trade participants are invalid' }, { status: 409 });
    }

    const reason = typeof notes === 'string' && notes.trim()
      ? notes.trim().slice(0, 2000)
      : resolution === 'RELEASE'
        ? 'Dispute awarded to buyer'
        : 'Dispute awarded to seller';

    // One canonical database operation performs authorization, row locking,
    // settlement, and dispute status update. Do not settle first and update the
    // dispute in a separate unchecked request.
    const { data, error } = await supabase.rpc('resolve_trade_dispute', {
      p_dispute_id: disputeId,
      p_resolution: reason,
      p_winner_id: winnerId,
      p_caller_id: auth.user.id,
    });

    if (error || (data && data.success === false)) {
      // Keep database internals out of the API response.
      return NextResponse.json({ success: false, error: 'Dispute resolution failed' }, { status: 409 });
    }

    // The RPC is the source of truth for settlement and dispute status.
    // Audit logging is supplemental; report its failure explicitly rather than
    // silently claiming that all audit work completed.
    const { error: auditError } = await supabase.from('admin_audit_logs').insert({
      admin_id: auth.user.id,
      admin_email: auth.user.email || 'admin@paxones.com',
      action: 'RESOLVE_DISPUTE',
      target_id: tradeId,
      details: { disputeId, tradeId, resolution, notes: reason },
    });

    if (auditError) {
      console.error('[admin dispute resolution] settlement succeeded but audit log insert failed');
      return NextResponse.json({
        success: true,
        auditLogWarning: true,
        message: 'Dispute settlement completed; audit log recording requires review.',
        data,
      }, { status: 200 });
    }

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
