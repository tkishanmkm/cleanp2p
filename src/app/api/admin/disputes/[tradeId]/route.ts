import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || 'admin@paxones.com';

    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();

    const { resolution, notes } = await req.json();

    if (!resolution || !['RELEASE_TO_BUYER', 'REFUND_TO_SELLER'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution option' }, { status: 400 });
    }

    // Fetch trade (by UUID or trade_id)
    let { data: trade } = await adminClient
      .from('trades')
      .select('id, seller_id, buyer_id, crypto, crypto_amount, escrow_fee, status')
      .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      .maybeSingle();

    const actualTradeId = trade?.id || tradeId;

    let rpcError: any = null;
    let rpcData: any = null;

    if (resolution === 'RELEASE_TO_BUYER') {
      const res = await adminClient.rpc('release_trade_escrow', {
        p_trade_id: actualTradeId,
        p_caller_id: adminId,
      });
      rpcError = res.error;
      rpcData = res.data;
    } else {
      const res = await adminClient.rpc('cancel_p2p_trade', {
        p_trade_id: actualTradeId,
        p_caller_id: adminId,
        p_reason: notes || 'Admin dispute refund to seller',
      });
      rpcError = res.error;
      rpcData = res.data;
    }

    if (rpcError || (rpcData && !rpcData.success)) {
      const errorMsg = rpcError?.message || rpcData?.message || 'Escrow settlement RPC failed.';
      console.error('Dispute settlement RPC error:', errorMsg);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    // Update disputes record to resolved
    try {
      await adminClient
        .from('disputes')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
        })
        .eq('trade_id', actualTradeId);
    } catch (dErr) {
      console.warn('Disputes record update warning:', dErr);
    }

    // Insert system message in chat
    const actionDesc = resolution === 'RELEASE_TO_BUYER' ? 'Crypto released to Buyer' : 'Escrow refunded to Seller';
    const resolutionMsg = `Admin moderator resolved dispute: ${actionDesc}. Notes: ${notes || 'No notes provided'}`;
    try {
      await adminClient.from('trade_messages').insert({
        trade_id: actualTradeId,
        sender_id: adminId,
        content: resolutionMsg,
        message: resolutionMsg,
        is_system_message: true,
        is_system: true,
      });
    } catch (mErr) {
      console.warn('Message insert error:', mErr);
    }

    return NextResponse.json({
      success: true,
      message: rpcData?.message || `Dispute resolved successfully as ${resolution}`,
    });
  } catch (err: any) {
    console.error('Error in admin dispute resolution route:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
