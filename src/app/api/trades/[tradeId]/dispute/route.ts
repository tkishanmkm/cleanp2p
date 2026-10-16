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
    const authHeader = req.headers.get('authorization');
    if (authHeader !== null) {
      const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (!bearerMatch) {
        return NextResponse.json({ error: 'Authorization header is invalid.' }, { status: 401 });
      }
      const token = bearerMatch[1].trim();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Bearer dispute auth is not configured.');
        return NextResponse.json({ error: 'Authentication is temporarily unavailable.' }, { status: 500 });
      }
      supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > 64 * 1024) {
        return NextResponse.json({ error: 'Request body exceeds the 64 KB limit.' }, { status: 413 });
      }
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
        return NextResponse.json({ error: 'Request body exceeds the 64 KB limit.' }, { status: 413 });
      }
      body = JSON.parse(rawBody);
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
    const { data: trade, error: tradeLookupError } = await tradeQuery.maybeSingle();
    if (tradeLookupError) {
      console.error('Dispute trade lookup failed:', tradeLookupError.code || 'UNKNOWN');
      return NextResponse.json({ error: 'Unable to verify trade access right now. Please try again.' }, { status: 500 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    }

    const actualTradeId = trade.id;

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
    const normalizedReason = typeof reason === 'string'
      ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const disputeReason = normalizedReason
      ? normalizedReason.slice(0, 2000)
      : 'Non-responsive counterparty or payment issue';

    // Execute Atomic Dispute Opening via Canonical Database RPC
    const { data: rpcData, error: rpcError } = await supabase.rpc('raise_trade_dispute', {
      p_trade_id: actualTradeId,
      p_user_id: user.id,
      p_reason: disputeReason,
    });

    if (rpcError || !rpcData || rpcData.success !== true) {
      // Keep database internals out of public API responses.
      console.error('raise_trade_dispute failed:', rpcError?.code || 'RPC_REJECTED');
      return NextResponse.json({ error: 'Unable to open a dispute for this trade. Check the trade status and try again.' }, { status: 400 });
    }

    // The dispute RPC is authoritative. Secondary notifications must not turn a
    // successfully opened dispute into an apparent API failure.
    try {
      // Service-role admin client for official system message and notification insertion
      const adminClient = getSupabaseAdminClient();
  
      // Fetch opener username & trade payment method
      let openerName = 'Trader';
      try {
        const { data: opProfile, error: profileError } = await adminClient
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) {
          console.warn('Dispute opener profile lookup failed:', profileError.code || 'UNKNOWN');
        } else if (typeof opProfile?.username === 'string' && opProfile.username.trim()) {
          openerName = opProfile.username.trim().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
        }
      } catch (profileError) {
        console.warn('Dispute opener profile lookup threw:', profileError instanceof Error ? profileError.name : 'UnknownError');
      }
  
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
        console.warn('System message insert failed:', mErr instanceof Error ? mErr.name : 'UnknownError');
      }
  
      // Insert notifications for both participants in Activity Center (storing link in metadata)
      const participantIds = [trade?.buyer_id, trade?.seller_id].filter(Boolean);
      for (const pid of participantIds) {
        try {
          const { error: notificationError } = await adminClient.from('notifications').insert({
            user_id: pid,
            title: 'Trade Disputed',
            message: `Dispute opened for Trade. Moderator review requested: ${disputeReason}`,
            type: 'dispute',
            is_read: false,
            metadata: { link: `/trade/${actualTradeId}` },
            created_at: now,
          });
          if (notificationError) {
            console.warn('Dispute notification could not be saved:', notificationError.code || 'UNKNOWN');
          }
        } catch {
          console.warn('Dispute notification insert threw an exception.');
        }
      }
  
    } catch {
      console.warn('Dispute opened, but follow-up notifications could not be initialized.');
    }

    return NextResponse.json({
      success: true,
      message: 'Dispute raised successfully. An admin moderator will review this trade.',
    });
  } catch (err: unknown) {
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    console.error('Error in raise dispute route:', errorName);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
