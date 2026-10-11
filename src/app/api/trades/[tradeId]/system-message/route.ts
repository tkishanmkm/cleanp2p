import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { formatSystemMessageContent, type SystemMessagePayload } from '@/lib/trade-system-messages';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
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
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const allowedTypes = new Set([
      'TRADE_INITIATED', 'TRADE_STARTED', 'ESCROW_LOCKED', 'MARKED_PAID',
      'TRADE_RELEASED', 'TRADE_COMPLETED', 'TRADE_CANCELLED', 'TRADE_EXPIRED',
      'TRADE_DISPUTED', 'TRADE_REPORTED', 'USER_BLOCKED', 'FEEDBACK_LEFT', 'MODERATOR_JOINED',
    ]);
    if ((!type && !customText) || (type && !allowedTypes.has(String(type)))) {
      return NextResponse.json({ error: 'Unsupported system message type.' }, { status: 400 });
    }

    const adminAuth = await verifyServerAdmin(req);
    const isAdmin = adminAuth.authorized;
    if (customText && !isAdmin) {
      return NextResponse.json({ error: 'Only an administrator can post custom system messages.' }, { status: 403 });
    }
    if (type === 'MODERATOR_JOINED' && !isAdmin) {
      return NextResponse.json({ error: 'Only an administrator can post moderator messages.' }, { status: 403 });
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
    // Admin status is verified server-side above; user metadata/email alone is not trusted.

    const isBuyer = String(trade.buyer_id) === String(user.id);
    const isSeller = String(trade.seller_id) === String(user.id);

    if (!isAdmin && !isBuyer && !isSeller) {
      return NextResponse.json({ error: 'Forbidden: You are not a participant in this trade' }, { status: 403 });
    }

    const tradeStatus = String(trade.status || '').trim().toLowerCase();
    const escrowStatus = String(trade.escrow_status || '').trim().toUpperCase();
    const lifecycleReady =
      type === 'MARKED_PAID'
        ? Boolean(trade.paid_at || trade.marked_paid_at || escrowStatus === 'PAID' || ['paid', 'buyer_marked_paid', 'payment_sent'].includes(tradeStatus))
        : type === 'TRADE_RELEASED' || type === 'TRADE_COMPLETED'
          ? Boolean(trade.released_at || trade.completed_at || ['released', 'completed'].includes(tradeStatus) || ['RELEASED', 'COMPLETED'].includes(escrowStatus))
          : type === 'TRADE_CANCELLED'
            ? Boolean(trade.cancelled_at || ['cancelled', 'canceled'].includes(tradeStatus) || ['CANCELLED', 'CANCELED'].includes(escrowStatus))
            : type === 'TRADE_EXPIRED'
              ? Boolean(trade.expired_at || tradeStatus === 'expired' || escrowStatus === 'EXPIRED')
              : type === 'TRADE_DISPUTED'
                ? Boolean(trade.is_disputed || tradeStatus === 'disputed' || escrowStatus === 'DISPUTED')
                : true;

    if (!isAdmin && ['MARKED_PAID', 'TRADE_RELEASED', 'TRADE_COMPLETED', 'TRADE_CANCELLED', 'TRADE_EXPIRED', 'TRADE_DISPUTED'].includes(String(type)) && !lifecycleReady) {
      return NextResponse.json({ error: 'System message does not match the authoritative trade state.' }, { status: 409 });
    }

    const actualTradeId = trade.id || tradeId;

    // Fetch profiles for accurate usernames in system message
    let buyerUsername = '';
    let sellerUsername = '';

    if (metadata.buyerUsername && metadata.buyerUsername.toLowerCase() !== 'buyer' && metadata.buyerUsername.toLowerCase() !== 'trader') {
      buyerUsername = metadata.buyerUsername;
    }
    if (metadata.sellerUsername && metadata.sellerUsername.toLowerCase() !== 'seller' && metadata.sellerUsername.toLowerCase() !== 'trader') {
      sellerUsername = metadata.sellerUsername;
    }

    if (trade.buyer_id) {
      try {
        const { data: bp } = await supabaseAdmin
          .from('profiles')
          .select('username, display_name, email')
          .eq('id', trade.buyer_id)
          .maybeSingle();

        if (bp?.username) buyerUsername = bp.username;
        else if (bp?.display_name && !buyerUsername) buyerUsername = bp.display_name;
        else if (bp?.email && !buyerUsername) buyerUsername = bp.email.split('@')[0];
      } catch (bpErr) {
        console.warn('Buyer profile fetch warning in system message:', bpErr);
      }

      if (!buyerUsername) {
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
      try {
        const { data: sp } = await supabaseAdmin
          .from('profiles')
          .select('username, display_name, email')
          .eq('id', trade.seller_id)
          .maybeSingle();

        if (sp?.username) sellerUsername = sp.username;
        else if (sp?.display_name && !sellerUsername) sellerUsername = sp.display_name;
        else if (sp?.email && !sellerUsername) sellerUsername = sp.email.split('@')[0];
      } catch (spErr) {
        console.warn('Seller profile fetch warning in system message:', spErr);
      }

      if (!sellerUsername) {
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

    // Secondary fallback to trade records / metadata if still unassigned
    if (!buyerUsername) buyerUsername = trade.buyer_username || metadata.buyerUsername || 'Trader';
    if (!sellerUsername) sellerUsername = trade.seller_username || metadata.sellerUsername || 'Trader';

    const payload: SystemMessagePayload = {
      ...safeMetadata,
      tradeId: actualTradeId,
      type: type || 'CUSTOM',
      buyerUsername,
      sellerUsername,
      openerUsername: user.user_metadata?.username || user.email?.split('@')[0] || 'Trader',
      coinAmount: trade.crypto_amount || trade.amount || safeMetadata.coinAmount || '0.00',
      coinSymbol: trade.crypto || trade.asset_symbol || safeMetadata.coinSymbol || 'USDT',
      paymentMethod: trade.payment_method || safeMetadata.paymentMethod || '',
      disputeReason: safeMetadata.disputeReason || '',
      issueDetails: safeMetadata.issueDetails || '',
      issueCategory: safeMetadata.issueCategory || '',
      feedbackComment: safeMetadata.feedbackComment || '',
      customText: isAdmin ? (customText || safeMetadata.customText) : undefined,
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
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const tradeId = resolvedParams?.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    const adminAuth = await verifyServerAdmin(req);
    const isAdmin = adminAuth.authorized;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    let tradeQuery = supabaseAdmin.from('trades').select('id, buyer_id, seller_id');
    if (isUuid) tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    else tradeQuery = tradeQuery.eq('trade_id', tradeId);
    const { data: trade } = await tradeQuery.maybeSingle();
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if (!isAdmin && trade.buyer_id !== user.id && trade.seller_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
