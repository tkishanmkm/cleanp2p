import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || (await supabase.auth.getUser()).data.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { resolution, notes } = await req.json();

    if (!resolution || !['RELEASE_TO_BUYER', 'REFUND_TO_SELLER'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution option' }, { status: 400 });
    }

    // Fetch trade (by UUID or trade_id)
    let { data: trade } = await supabase
      .from('trades')
      .select('*')
      .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      .maybeSingle();

    const actualTradeId = trade?.id || tradeId;

    let rpcSucceeded = false;
    let rpcResult: any = null;

    try {
      const { data, error } = await supabase.rpc('admin_resolve_dispute', {
        p_trade_id: actualTradeId,
        p_admin_id: user.id,
        p_resolution: resolution, // 'RELEASE_TO_BUYER' or 'REFUND_TO_SELLER'
        p_notes: notes || 'Resolved after admin review',
      });

      if (!error && data) {
        rpcSucceeded = true;
        rpcResult = data;
      } else if (error && error.code !== 'PGRST202') {
        if (!data?.success && error.message) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      }
    } catch (e) {
      console.warn('admin_resolve_dispute RPC failed, using admin fallback:', e);
    }

    if (rpcSucceeded) {
      if (!rpcResult.success) {
        return NextResponse.json({ error: rpcResult.message || 'Failed to resolve dispute' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: rpcResult.message || 'Dispute resolved successfully' });
    }

    // Direct fallback: Use Admin Client to bypass RLS and finalize trade
    const adminClient = getSupabaseAdminClient();
    const resolvedStatus = resolution === 'RELEASE_TO_BUYER' ? 'COMPLETED' : 'CANCELLED';
    const escrowStatus = resolution === 'RELEASE_TO_BUYER' ? 'released' : 'refunded';
    const now = new Date().toISOString();

    const { error: updateError } = await adminClient
      .from('trades')
      .update({
        status: resolvedStatus,
        escrow_status: escrowStatus,
        dispute_resolution: resolution,
        dispute_notes: notes || 'Resolved after admin review',
        resolved_at: now,
        resolved_by: user.id,
      })
      .or(`id.eq.${actualTradeId},trade_id.eq.${tradeId}`);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    // Also update disputes table if open
    try {
      await adminClient
        .from('disputes')
        .update({
          status: 'resolved',
          resolution: resolution,
          resolved_at: now,
          resolved_by: user.id,
          resolution_notes: notes || 'Resolved by admin',
        })
        .eq('trade_id', actualTradeId);
    } catch (dErr) {
      console.warn('Disputes table resolution update skipped:', dErr);
    }

    // System announcement in chat
    const actionDesc = resolution === 'RELEASE_TO_BUYER' ? 'Crypto released to Buyer' : 'Escrow refunded to Seller';
    const resolutionMsg = `Admin moderator resolved dispute: ${actionDesc}. Notes: ${notes || 'No notes provided'}`;
    try {
      await adminClient.from('trade_messages').insert({
        trade_id: actualTradeId,
        sender_id: user.id,
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
      message: `Dispute resolved successfully as ${resolution}`,
    });
  } catch (err: any) {
    console.error('Error in admin dispute resolution route:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
