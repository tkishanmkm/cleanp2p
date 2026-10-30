import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || 'admin@paxones.com';
    const supabase = getSupabaseAdminClient();
    const body = await req.json();
    const disputeId = typeof body?.disputeId === 'string' ? body.disputeId : '';
    const tradeId = typeof body?.tradeId === 'string' ? body.tradeId : '';
    const resolution = body?.resolution;
    const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : '';

    if (!disputeId || !tradeId || !['RELEASE', 'CANCEL'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution parameters' }, { status: 400 });
    }

    // Validate the dispute/trade relationship and state BEFORE invoking a
    // financial settlement RPC. Otherwise a valid dispute ID could be paired
    // with an unrelated trade and the wrong escrow could be settled.
    const { data: dispute, error: disputeReadError } = await supabase
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeReadError) {
      console.error('[Dispute Resolution] Failed to load dispute', disputeReadError);
      return NextResponse.json({ error: 'Unable to verify dispute; no settlement was attempted' }, { status: 503 });
    }
    if (!dispute) return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    if (String(dispute.trade_id) !== tradeId) {
      return NextResponse.json({ error: 'Dispute does not belong to the supplied trade' }, { status: 409 });
    }
    if (!['open', 'pending', 'under_review', 'OPEN', 'PENDING', 'UNDER_REVIEW'].includes(String(dispute.status))) {
      return NextResponse.json({ error: 'Dispute is not in a resolvable state' }, { status: 409 });
    }

    const { data: trade, error: tradeReadError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeReadError) {
      console.error('[Dispute Resolution] Failed to load trade', tradeReadError);
      return NextResponse.json({ error: 'Unable to verify trade; no settlement was attempted' }, { status: 503 });
    }
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

    const rpcResult = resolution === 'RELEASE'
      ? await supabase.rpc('release_trade_escrow', { p_trade_id: tradeId, p_caller_id: adminId })
      : await supabase.rpc('cancel_p2p_trade', { p_trade_id: tradeId, p_caller_id: adminId });

    if (rpcResult.error || !rpcResult.data || rpcResult.data.success !== true) {
      const errMsg = rpcResult.error?.message || rpcResult.data?.message || 'Escrow settlement RPC did not confirm success';
      console.error('[Dispute Resolution] Settlement failed', { disputeId, tradeId, errMsg });
      return NextResponse.json({ error: errMsg }, { status: 409 });
    }

    const winnerId = resolution === 'RELEASE' ? trade.buyer_id : trade.seller_id;
    const now = new Date().toISOString();
    const { error: disputeUpdateError } = await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        winner_id: winnerId,
        resolution: resolution === 'RELEASE' ? 'RELEASE_TO_BUYER' : 'REFUND_TO_SELLER',
        resolution_reason: notes || (resolution === 'RELEASE' ? 'Dispute awarded to Buyer' : 'Dispute refunded to Seller'),
        resolution_note: notes || (resolution === 'RELEASE' ? 'Dispute awarded to Buyer' : 'Dispute refunded to Seller'),
        resolved_by: adminId,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', disputeId)
      .eq('trade_id', tradeId);

    if (disputeUpdateError) {
      // Escrow RPC already settled; surface the partial state loudly rather than
      // falsely reporting a complete dispute resolution.
      console.error('[Dispute Resolution] Escrow settled but dispute update failed; manual reconciliation required', {
        disputeId, tradeId, error: disputeUpdateError,
      });
      return NextResponse.json({
        error: 'Escrow settlement succeeded, but dispute record update failed. Manual reconciliation is required.',
        settlementSucceeded: true,
        reconciliationRequired: true,
      }, { status: 500 });
    }

    const { error: auditError } = await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'RESOLVE_DISPUTE',
      target_id: tradeId,
      details: { disputeId, tradeId, resolution, notes },
    });

    if (auditError) {
      console.error('[Dispute Resolution] Resolution succeeded but audit log insert failed', auditError);
      return NextResponse.json({
        success: true,
        data: rpcResult.data,
        warning: 'Settlement and dispute update succeeded, but audit logging failed; investigate immediately.',
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: rpcResult.data });
  } catch (err: any) {
    console.error('[Dispute Resolution] Unexpected error', err);
    return NextResponse.json({ error: 'Unable to resolve dispute safely' }, { status: 500 });
  }
}
