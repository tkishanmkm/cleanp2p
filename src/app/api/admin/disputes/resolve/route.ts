import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || 'admin@paxones.com';
    const supabase = getSupabaseAdminClient();

    const { disputeId, tradeId, resolution, notes } = await req.json();

    if (!disputeId || !tradeId || !['RELEASE', 'CANCEL'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution parameters' }, { status: 400 });
    }

    // Bind the dispute to the requested trade before any escrow mutation.
    // The previous route accepted disputeId and tradeId independently, so an
    // admin request could settle one trade while resolving a different dispute.
    const { data: dispute, error: disputeLookupError } = await supabase
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeLookupError) {
      console.error('[Dispute Resolution] Failed to load dispute:', disputeLookupError.message);
      return NextResponse.json({ error: 'Unable to verify dispute' }, { status: 500 });
    }

    if (!dispute || String(dispute.trade_id) !== String(tradeId)) {
      return NextResponse.json({ error: 'Dispute does not belong to the specified trade' }, { status: 404 });
    }

    if (String(dispute.status).toLowerCase() !== 'open') {
      return NextResponse.json({ error: 'Dispute is not open' }, { status: 409 });
    }

    const { data: trade, error: tradeLookupError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeLookupError) {
      console.error('[Dispute Resolution] Failed to load trade:', tradeLookupError.message);
      return NextResponse.json({ error: 'Unable to verify trade' }, { status: 500 });
    }

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    let rpcResult;
    if (resolution === 'RELEASE') {
      rpcResult = await supabase.rpc('release_trade_escrow', {
        p_trade_id: tradeId,
        p_caller_id: adminId,
      });
    } else {
      rpcResult = await supabase.rpc('cancel_p2p_trade', {
        p_trade_id: tradeId,
        p_caller_id: adminId,
      });
    }

    if (rpcResult.error || (rpcResult.data && !rpcResult.data.success)) {
      const errMsg = rpcResult.error?.message || rpcResult.data?.message || 'Escrow settlement RPC failed';
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const winnerId = resolution === 'RELEASE' ? trade.buyer_id : trade.seller_id;

    // Update only the still-open dispute tied to this trade. Check errors and
    // affected-row count; an unchecked write previously reported success even
    // when the dispute row was not updated. Escrow settlement and this update
    // are still separate operations; atomic settlement is a follow-up blocker.
    const { data: updatedDisputes, error: disputeUpdateError } = await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        winner_id: winnerId,
        resolution: resolution === 'RELEASE' ? 'RELEASE_TO_BUYER' : 'REFUND_TO_SELLER',
        resolution_reason: notes || (resolution === 'RELEASE' ? 'Dispute awarded to Buyer' : 'Dispute refunded to Seller'),
        resolution_note: notes || (resolution === 'RELEASE' ? 'Dispute awarded to Buyer' : 'Dispute refunded to Seller'),
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId)
      .eq('trade_id', tradeId)
      .eq('status', 'open')
      .select('id');

    if (disputeUpdateError || !updatedDisputes || updatedDisputes.length !== 1) {
      console.error('[Dispute Resolution] Dispute update failed after settlement:', disputeUpdateError?.message || 'No matching open dispute row');
      return NextResponse.json({
        error: 'Escrow settlement completed, but dispute status update failed; manual reconciliation is required.',
        settlementCompleted: true,
        reconciliationRequired: true,
      }, { status: 500 });
    }

    // Audit log
    const { error: auditError } = await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'RESOLVE_DISPUTE',
      target_id: tradeId,
      details: { disputeId, tradeId, resolution, notes },
    });

    if (auditError) {
      console.error('[Dispute Resolution] Audit log insert failed:', auditError.message);
      return NextResponse.json({
        success: true,
        data: rpcResult.data,
        warning: 'Settlement and dispute update completed, but audit log insertion failed.',
        auditLogFailed: true,
      }, { status: 200 });
    }

    return NextResponse.json({ success: true, data: rpcResult.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

