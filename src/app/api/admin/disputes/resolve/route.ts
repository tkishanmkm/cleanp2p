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

    // Verify the dispute is attached to the exact trade before any escrow mutation.
    const { data: dispute, error: disputeLookupError } = await supabase
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeLookupError) {
      console.error('[Dispute Resolution] Failed to validate dispute/trade linkage:', disputeLookupError);
      return NextResponse.json({ error: 'Unable to verify dispute; no settlement was attempted' }, { status: 503 });
    }
    if (!dispute || dispute.trade_id !== tradeId) {
      return NextResponse.json({ error: 'Dispute does not exist or is not linked to the supplied trade' }, { status: 404 });
    }
    if (['resolved', 'RESOLVED', 'closed', 'CLOSED'].includes(String(dispute.status || ''))) {
      return NextResponse.json({ error: 'This dispute has already been resolved' }, { status: 409 });
    }

    const { data: trade, error: tradeLookupError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeLookupError || !trade) {
      console.error('[Dispute Resolution] Failed to validate trade:', tradeLookupError);
      return NextResponse.json({ error: 'Unable to verify trade; no settlement was attempted' }, { status: 503 });
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

    // Update dispute record. If this fails after settlement, surface the partial
    // failure explicitly so it can be reconciled instead of reporting success.
    const { error: disputeUpdateError } = await supabase
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
      .eq('trade_id', tradeId);

    if (disputeUpdateError) {
      console.error('[Dispute Resolution] Escrow settled but dispute update failed; reconciliation required:', disputeUpdateError);
      return NextResponse.json({
        error: 'Escrow settlement completed, but dispute status could not be updated. Manual reconciliation is required.',
        settlementCompleted: true,
      }, { status: 500 });
    }

    // Audit log
    const { error: auditLogError } = await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'RESOLVE_DISPUTE',
      target_id: tradeId,
      details: { disputeId, tradeId, resolution, notes },
    });

    if (auditLogError) {
      console.error('[Dispute Resolution] Settlement recorded but audit log insert failed:', auditLogError);
      return NextResponse.json({
        error: 'Settlement and dispute update completed, but audit logging failed. Manual review is required.',
        settlementCompleted: true,
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: rpcResult.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

