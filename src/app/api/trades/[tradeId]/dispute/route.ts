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

    if (typeof tradeId !== 'string' || tradeId.trim().length === 0 || tradeId.length > 128) {
      return NextResponse.json({ error: 'Trade ID is required and must be 128 characters or fewer.' }, { status: 400 });
    }
    const cleanTradeId = tradeId.trim();

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const { reason } = body as Record<string, unknown>;
    if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length > 2000)) {
      return NextResponse.json({ error: 'Dispute reason must be text of 2,000 characters or fewer.' }, { status: 400 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTradeId);

    // Fetch trade (by UUID or trade_id)
    let tradeQuery = supabase.from('trades').select('id, trade_id, buyer_id, seller_id, status, escrow_status, payment_method');
    if (isUuid) {
      tradeQuery = tradeQuery.or(`id.eq.${cleanTradeId},trade_id.eq.${cleanTradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', cleanTradeId);
    }
    const { data: trade } = await tradeQuery.maybeSingle();

    const actualTradeId = trade?.id || tradeId;

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
    const disputeReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'Non-responsive counterparty or payment issue';

    // Execute Atomic Dispute Opening via Canonical Database RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('raise_trade_dispute', {
      p_trade_id: actualTradeId,
      p_user_id: user.id,
      p_reason: disputeReason,
    });

    if (rpcError || (rpcData && !rpcData.success)) {
      // Keep database internals out of public API responses.
      console.error('raise_trade_dispute failed:', rpcError?.code || 'RPC_REJECTED');
      return NextResponse.json({ error: 'Unable to open a dispute for this trade. Check the trade status and try again.' }, { status: 400 });
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

    const tradePaymentMethod = trade?.payment_method || 'Bank Transfer';

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
