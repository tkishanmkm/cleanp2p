import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { formatSystemMessageContent, type SystemMessagePayload } from '@/lib/trade-system-messages';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams?.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || (await supabase.auth.getUser()).data?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { type, metadata = {}, customText } = body;

    if (!type && !customText) {
      return NextResponse.json({ error: 'Message type or customText is required' }, { status: 400 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade record using supabaseAdmin to guarantee access
    let tradeQuery = supabaseAdmin.from('trades').select('*');
    if (isUuid) {
      tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', tradeId);
    }
    const { data: trade, error: tradeErr } = await tradeQuery.maybeSingle();

    if (tradeErr || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Verify caller is buyer, seller, or admin
    const isAdmin =
      user.user_metadata?.role === 'admin' ||
      user.app_metadata?.role === 'admin' ||
      user.email?.endsWith('@paxones.com');

    const isBuyer = String(trade.buyer_id) === String(user.id);
    const isSeller = String(trade.seller_id) === String(user.id);

    if (!isAdmin && !isBuyer && !isSeller) {
      return NextResponse.json({ error: 'Forbidden: You are not a participant in this trade' }, { status: 403 });
    }

    const actualTradeId = trade.id || tradeId;

    // Fetch profiles for accurate usernames in system message
    let buyerUsername = metadata.buyerUsername || 'Buyer';
    let sellerUsername = metadata.sellerUsername || 'Seller';

    if (trade.buyer_id && (!metadata.buyerUsername || metadata.buyerUsername === 'Buyer')) {
      const { data: bp } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('id', trade.buyer_id)
        .maybeSingle();
      if (bp?.username) buyerUsername = bp.username;
    }

    if (trade.seller_id && (!metadata.sellerUsername || metadata.sellerUsername === 'Seller')) {
      const { data: sp } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('id', trade.seller_id)
        .maybeSingle();
      if (sp?.username) sellerUsername = sp.username;
    }

    const payload: SystemMessagePayload = {
      tradeId: actualTradeId,
      type: type || 'CUSTOM',
      buyerUsername,
      sellerUsername,
      openerUsername: user.user_metadata?.username || user.email?.split('@')[0] || 'Trader',
      coinAmount: trade.crypto_amount || trade.amount || metadata.coinAmount || '0.00',
      coinSymbol: trade.crypto || trade.asset_symbol || metadata.coinSymbol || 'USDT',
      paymentMethod: trade.payment_method || metadata.paymentMethod || '',
      disputeReason: metadata.disputeReason || '',
      issueDetails: metadata.issueDetails || '',
      issueCategory: metadata.issueCategory || '',
      feedbackComment: metadata.feedbackComment || '',
      customText: customText || metadata.customText,
      ...metadata
    };

    const text = formatSystemMessageContent(payload);
    const now = new Date().toISOString();
    const systemUuid = '00000000-0000-0000-0000-000000000000';

    // Prevent duplicate automated initiation or expiration notices
    if (type === 'TRADE_INITIATED' || type === 'TRADE_STARTED') {
      const { data: existingInit } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .ilike('message', '%PAXONES ESCROW SECURED%')
        .limit(1)
        .maybeSingle();

      if (existingInit) {
        return NextResponse.json({ success: true, message: 'Initiation message already present', id: existingInit.id });
      }
    } else if (type === 'TRADE_EXPIRED') {
      const { data: existingExp } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .ilike('message', '%TRADE EXPIRED%')
        .limit(1)
        .maybeSingle();

      if (existingExp) {
        return NextResponse.json({ success: true, message: 'Expiration message already present', id: existingExp.id });
      }
    }

    // Insert into trade_messages using supabaseAdmin (bypassing RLS safely)
    let insertResult: any = null;
    try {
      const richInsert = await supabaseAdmin.from('trade_messages').insert([
        {
          trade_id: actualTradeId,
          sender_id: systemUuid,
          sender_username: 'Paxones System',
          message: text,
          is_moderator: true,
          visibility: 'all',
          created_at: now
        }
      ]).select().maybeSingle();

      if (richInsert.error) {
        // Fallback to basic columns if schema is strict
        const baseInsert = await supabaseAdmin.from('trade_messages').insert([
          {
            trade_id: actualTradeId,
            sender_id: systemUuid,
            message: text,
            created_at: now
          }
        ]).select().maybeSingle();

        insertResult = baseInsert.data;
      } else {
        insertResult = richInsert.data;
      }
    } catch (insertErr) {
      console.warn('Error inserting into trade_messages:', insertErr);
    }

    // Also mirror to trade_chat_messages
    try {
      await supabaseAdmin.from('trade_chat_messages').insert([
        {
          trade_id: actualTradeId,
          sender_id: systemUuid,
          message: text,
          is_system_message: true,
          created_at: now
        }
      ]);
    } catch {
      // Optional fallback
    }

    return NextResponse.json({
      success: true,
      message: text,
      record: insertResult
    });
  } catch (error: any) {
    console.error('System message route error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams?.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const { data: messages, error } = await supabaseAdmin
      .from('trade_messages')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('sender_id', '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: messages || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
