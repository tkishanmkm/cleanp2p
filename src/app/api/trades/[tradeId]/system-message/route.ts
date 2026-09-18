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
    let buyerUsername = trade.buyer_username || metadata.buyerUsername || '';
    let sellerUsername = trade.seller_username || metadata.sellerUsername || '';

    if (trade.buyer_id) {
      const { data: bp } = await supabaseAdmin
        .from('profiles')
        .select('username, display_name, email')
        .or(`id.eq.${trade.buyer_id},user_id.eq.${trade.buyer_id}`)
        .maybeSingle();
      if (bp?.username) buyerUsername = bp.username;
      else if (bp?.display_name) buyerUsername = bp.display_name;
      else if (bp?.email && !buyerUsername) buyerUsername = bp.email.split('@')[0];
      else if (!buyerUsername) {
        // Fallback: Check auth.admin user
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(trade.buyer_id);
          if (authUser?.user?.user_metadata?.username) {
            buyerUsername = authUser.user.user_metadata.username;
          } else if (authUser?.user?.email) {
            buyerUsername = authUser.user.email.split('@')[0];
          }
        } catch {}
      }
    }

    if (trade.seller_id) {
      const { data: sp } = await supabaseAdmin
        .from('profiles')
        .select('username, display_name, email')
        .or(`id.eq.${trade.seller_id},user_id.eq.${trade.seller_id}`)
        .maybeSingle();
      if (sp?.username) sellerUsername = sp.username;
      else if (sp?.display_name) sellerUsername = sp.display_name;
      else if (sp?.email && !sellerUsername) sellerUsername = sp.email.split('@')[0];
      else if (!sellerUsername) {
        // Fallback: Check auth.admin user
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(trade.seller_id);
          if (authUser?.user?.user_metadata?.username) {
            sellerUsername = authUser.user.user_metadata.username;
          } else if (authUser?.user?.email) {
            sellerUsername = authUser.user.email.split('@')[0];
          }
        } catch {}
      }
    }

    if (!buyerUsername || buyerUsername.toLowerCase() === 'buyer') buyerUsername = metadata.buyerUsername || trade.buyer_username || 'Trader';
    if (!sellerUsername || sellerUsername.toLowerCase() === 'seller') sellerUsername = metadata.sellerUsername || trade.seller_username || 'Trader';

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

    // Prevent duplicate automated system messages for all trade lifecycle events
    if (type === 'TRADE_INITIATED' || type === 'TRADE_STARTED' || type === 'ESCROW_LOCKED') {
      const { data: existingInit } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .or('message.ilike.%TRADE INITIATED%,message.ilike.%PAXONES ESCROW SECURED%,message.ilike.%safely held in Paxones Escrow%')
        .limit(1)
        .maybeSingle();

      if (existingInit) {
        return NextResponse.json({ success: true, message: 'Initiation message already present', id: existingInit.id });
      }
    } else if (type === 'TRADE_EXPIRED') {
      // Guard: Do not generate an Expired system message if trade is already paid, completed, or disputed
      const isPaidOrCompleted = Boolean(
        trade.paid_at ||
        trade.marked_paid_at ||
        trade.payment_confirmed_at ||
        trade.escrow_status === 'PAID' ||
        ['paid', 'buyer_marked_paid', 'payment_sent', 'released', 'completed', 'disputed'].includes((trade.status || '').toLowerCase())
      );
      if (isPaidOrCompleted) {
        return NextResponse.json({ success: true, message: 'Trade is paid or completed. Expiration message suppressed.' });
      }

      const { data: existingExp } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .or('message.ilike.%TRADE EXPIRED%,message.ilike.%PAYMENT TIME EXCEEDED%')
        .limit(1)
        .maybeSingle();

      if (existingExp) {
        return NextResponse.json({ success: true, message: 'Expiration message already present', id: existingExp.id });
      }
    } else if (type === 'TRADE_CANCELLED') {
      const { data: existingCancel } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .ilike('message', '%Trade cancelled%')
        .limit(1)
        .maybeSingle();

      if (existingCancel) {
        return NextResponse.json({ success: true, message: 'Cancellation message already present', id: existingCancel.id });
      }
    } else if (type === 'TRADE_RELEASED' || type === 'TRADE_COMPLETED') {
      const { data: existingRelease } = await supabaseAdmin
        .from('trade_messages')
        .select('id')
        .eq('trade_id', actualTradeId)
        .or('message.ilike.%sold%successfully to%,message.ilike.%bought%successfully from%')
        .limit(1)
        .maybeSingle();

      if (existingRelease) {
        return NextResponse.json({ success: true, message: 'Release message already present', id: existingRelease.id });
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
