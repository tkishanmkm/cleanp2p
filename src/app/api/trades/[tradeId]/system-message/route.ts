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

    const { type, metadata = {}, customText } = body as Record<string, unknown>;
    if ((type !== undefined && type !== null && (typeof type !== 'string' || type.length > 64)) ||
        (customText !== undefined && customText !== null && (typeof customText !== 'string' || customText.length > 2000)) ||
        !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return NextResponse.json({ error: 'Message type, metadata, or custom text is invalid.' }, { status: 400 });
    }
    if (!(typeof type === 'string' && type.trim()) && !(typeof customText === 'string' && customText.trim())) {
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
    // Only trusted app metadata may grant this bypass. User-editable metadata
    // and an email suffix are not authoritative administrator credentials.
    const isAdmin = user.app_metadata?.role === 'admin';

    const isBuyer = String(trade.buyer_id) === String(user.id);
    const isSeller = String(trade.seller_id) === String(user.id);

    if (!isAdmin && !isBuyer && !isSeller) {
      return NextResponse.json({ error: 'Forbidden: You are not a participant in this trade' }, { status: 403 });
    }

    const actualTradeId = trade.id || tradeId;

    // Fetch profiles for accurate usernames in system message
    let buyerUsername = '';
    let sellerUsername = '';

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
    if (!buyerUsername) buyerUsername = trade.buyer_username || 'Trader';
    if (!sellerUsername) sellerUsername = trade.seller_username || 'Trader';

    const payload: SystemMessagePayload = {
      tradeId: actualTradeId,
      type: type || 'CUSTOM',
      buyerUsername,
      sellerUsername,
      openerUsername: user.user_metadata?.username || user.email?.split('@')[0] || 'Trader',
      coinAmount: trade.crypto_amount || trade.amount || '0.00',
      coinSymbol: trade.crypto || trade.asset_symbol || 'USDT',
      paymentMethod: trade.payment_method || '',
      disputeReason: metadata.disputeReason || '',
      issueDetails: metadata.issueDetails || '',
      issueCategory: metadata.issueCategory || '',
      feedbackComment: metadata.feedbackComment || '',
      customText: typeof customText === 'string' ? customText : undefined,
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
        // Retry with the minimal schema only for compatibility.
        const baseInsert = await supabaseAdmin.from('trade_messages').insert([
          {
            trade_id: actualTradeId,
            sender_id: systemUuid,
            message: text,
            created_at: now
          }
        ]).select().maybeSingle();

        if (baseInsert.error) {
          console.error('System-message persistence failed:', baseInsert.error.code || richInsert.error.code || 'UNKNOWN');
          return NextResponse.json({ error: 'Unable to save system message.' }, { status: 500 });
        }
        insertResult = baseInsert.data;
      } else {
        insertResult = richInsert.data;
      }
    } catch (insertErr) {
      const errorName = insertErr instanceof Error ? insertErr.name : 'UnknownError';
      console.error('System-message persistence threw:', errorName);
      return NextResponse.json({ error: 'Unable to save system message.' }, { status: 500 });
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
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('System message POST failed:', errorName);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams?.tradeId;
    if (!tradeId || tradeId.length > 128) {
      return NextResponse.json({ error: 'Valid trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    let tradeQuery = supabaseAdmin.from('trades').select('id, trade_id, buyer_id, seller_id');
    tradeQuery = isUuid
      ? tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      : tradeQuery.eq('trade_id', tradeId);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();
    if (tradeError) {
      console.error('System-message read authorization lookup failed:', tradeError.code || 'UNKNOWN');
      return NextResponse.json({ error: 'Unable to verify trade access.' }, { status: 500 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const isAdmin = user.app_metadata?.role === 'admin';
    if (!isAdmin && trade.buyer_id !== user.id && trade.seller_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: messages, error } = await supabaseAdmin
      .from('trade_messages')
      .select('id, trade_id, sender_id, sender_username, message, created_at, visibility')
      .eq('trade_id', trade.id)
      .eq('sender_id', '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('System-message read failed:', error.code || 'UNKNOWN');
      return NextResponse.json({ error: 'Unable to load system messages.' }, { status: 500 });
    }
    return NextResponse.json({ messages: messages || [] });
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('System-message GET failed:', errorName);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
