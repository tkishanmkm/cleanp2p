import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_TRADE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await params;
    if (
      typeof tradeId !== 'string' ||
      (!UUID_RE.test(tradeId) && !PUBLIC_TRADE_ID_RE.test(tradeId))
    ) {
      return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });
    }

    let supabase = await createClient();
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (!match) {
        return NextResponse.json({ error: 'Invalid authorization header' }, { status: 401 });
      }
      const token = match[1].trim();
      if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const rawReason = (body as { reason?: unknown } | null)?.reason;
    if (typeof rawReason !== 'string' || rawReason.trim().length === 0 || rawReason.trim().length > 4000) {
      return NextResponse.json(
        { error: 'A dispute reason between 1 and 4000 characters is required' },
        { status: 400 }
      );
    }
    const disputeReason = rawReason.trim();

    // Resolve only a real trade. UUIDs are safe for the OR filter; public IDs use equality.
    let tradeQuery = supabase.from('trades').select('id, trade_id, buyer_id, seller_id, status, escrow_status, payment_method');
    if (UUID_RE.test(tradeId)) {
      tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', tradeId);
    }
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();
    if (tradeError) {
      console.error('[trade dispute] Trade lookup failed', { code: tradeError.code ?? 'unknown' });
      return NextResponse.json({ error: 'Unable to verify trade' }, { status: 400 });
    }
    if (!trade || !UUID_RE.test(String(trade.id))) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (trade.buyer_id !== user.id && trade.seller_id !== user.id) {
      return NextResponse.json({ error: 'Only trade participants can open a dispute' }, { status: 403 });
    }

    const currentStatus = String(trade.status ?? '').toLowerCase();
    const escrowStatus = String(trade.escrow_status ?? '').toLowerCase();
    if (
      ['completed', 'released', 'cancelled', 'canceled', 'expired'].includes(currentStatus) ||
      ['completed', 'released', 'cancelled', 'canceled', 'expired'].includes(escrowStatus)
    ) {
      return NextResponse.json(
        { error: 'Dispute cannot be opened for this trade in its current state' },
        { status: 409 }
      );
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('raise_trade_dispute', {
      p_trade_id: trade.id,
      p_user_id: user.id,
      p_reason: disputeReason,
    });

    if (rpcError) {
      console.error('[trade dispute] RPC failed', { code: rpcError.code ?? 'unknown' });
      return NextResponse.json({ error: 'Failed to open trade dispute' }, { status: 400 });
    }
    if (!rpcData || rpcData.success !== true) {
      return NextResponse.json({ error: 'Dispute was not confirmed by the database' }, { status: 409 });
    }

    const adminClient = getSupabaseAdminClient();
    let openerName = 'Trader';
    try {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.username) openerName = profile.username;
    } catch {
      // The dispute is already committed; ancillary messaging must not reverse that result.
    }

    const now = new Date().toISOString();
    const tradePaymentMethod = trade.payment_method || 'Bank Transfer';
    try {
      await insertPaxonesSystemMessage(adminClient, {
        tradeId: trade.id,
        type: 'TRADE_DISPUTED',
        openerUsername: openerName,
        disputeReason,
        paymentMethod: tradePaymentMethod,
      });
    } catch (error) {
      console.warn('[trade dispute] System message insert failed', error instanceof Error ? error.message : 'unknown');
    }

    for (const participantId of [trade.buyer_id, trade.seller_id].filter(Boolean)) {
      try {
        const { error } = await adminClient.from('notifications').insert({
          user_id: participantId,
          title: 'Trade Disputed',
          message: 'A dispute was opened for this trade. Moderator review requested.',
          type: 'dispute',
          is_read: false,
          metadata: { link: `/trade/${trade.id}` },
          created_at: now,
        });
        if (error) console.warn('[trade dispute] Notification insert failed', { code: error.code ?? 'unknown' });
      } catch {
        // Notifications are ancillary; the canonical dispute RPC is authoritative.
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Dispute raised successfully. An admin moderator will review this trade.',
      data: rpcData,
    });
  } catch (error) {
    console.error('[trade dispute] Unexpected route failure', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
