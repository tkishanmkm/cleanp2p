import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

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

    let supabase = await createClient();
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reason } = await req.json();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade (by UUID or trade_id)
    let tradeQuery = supabase.from('trades').select('*');
    if (isUuid) {
      tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', tradeId);
    }
    const { data: trade } = await tradeQuery.maybeSingle();

    const actualTradeId = trade?.id || tradeId;
    const isActualUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualTradeId);

    // Verify caller is a trade participant
    const isBuyer = trade?.buyer_id === user.id;
    const isSeller = trade?.seller_id === user.id;
    if (!isBuyer && !isSeller) {
      return NextResponse.json({ error: 'Only trade participants can open a dispute.' }, { status: 403 });
    }

    // Verify trade status allows dispute
    const currentStatus = String(trade?.status || '').toLowerCase();
    const escrowStatus = String(trade?.escrow_status || '').toLowerCase();
    if (
      currentStatus === 'completed' ||
      currentStatus === 'released' ||
      currentStatus === 'cancelled' ||
      currentStatus === 'canceled' ||
      escrowStatus === 'released' ||
      escrowStatus === 'cancelled'
    ) {
      return NextResponse.json({ error: 'Dispute cannot be opened for this trade in its current state.' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const disputeReason = reason || 'Non-responsive counterparty or payment issue';

    // Execute Atomic Dispute Opening via Canonical Database RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('raise_trade_dispute', {
      p_trade_id: actualTradeId,
      p_user_id: user.id,
      p_reason: disputeReason,
    });

    if (rpcError || (rpcData && !rpcData.success)) {
      const errorMsg = rpcError?.message || rpcData?.message || 'Failed to open dispute.';
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    // Service-role admin client for official system message and notification insertion
    const adminClient = getSupabaseAdminClient();

    // Fetch opener username & trade payment method
    let openerName = 'Trader';
    try {
      const { data: opProfile } = await adminClient
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      if (opProfile?.username) openerName = opProfile.username;
    } catch {}

    const tradePaymentMethod = trade?.payment_method || trade?.paymentMethod || 'Bank Transfer';

    // Insert official system notification in trade_messages using admin client to bypass user RLS
    try {
      await insertPaxonesSystemMessage(adminClient, {
        tradeId: actualTradeId,
        type: 'TRADE_DISPUTED',
        openerUsername: openerName,
        disputeReason: disputeReason,
        paymentMethod: tradePaymentMethod,
      });
    } catch (mErr) {
      console.warn('System message insert error:', mErr);
    }

    // Insert notifications for both participants in Activity Center (storing link in metadata)
    const participantIds = [trade?.buyer_id, trade?.seller_id].filter(Boolean);
    for (const pid of participantIds) {
      try {
        await adminClient.from('notifications').insert({
          user_id: pid,
          title: 'Trade Disputed',
          message: `Dispute opened for Trade. Moderator review requested: ${disputeReason}`,
          type: 'dispute',
          is_read: false,
          metadata: { link: `/trade/${actualTradeId}` },
          created_at: now,
        });
      } catch (nErr) {
        console.warn('Dispute notification insert error:', nErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Dispute raised successfully. An admin moderator will review this trade.',
    });
  } catch (err: any) {
    console.error('Error in raise dispute route:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
