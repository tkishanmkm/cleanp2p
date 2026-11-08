// app/api/trades/[tradeId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Strips email addresses, moderator IDs, and admin identity from message text
 * to guarantee strict moderator privacy and anonymity to users.
 */
function sanitizeModeratorMessage(text: string): string {
  if (!text) return '';
  let sanitized = text;

  // Replace legacy join strings
  if (sanitized.includes('Moderator Joined') || sanitized.includes('joined the trade discussion')) {
    return 'Wayones Moderator joined the trade.';
  }

  // Remove prefix like [MODERATOR - email@domain.com]: or [MODERATOR]:
  sanitized = sanitized.replace(/^\[MODERATOR\s*(?:-\s*[^\]]+)?\]:\s*/i, '');

  // Strip explicit email addresses from moderator messages
  sanitized = sanitized.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gi, '[protected]');

  // Remove personal admin names if appearing in decision strings
  sanitized = sanitized.replace(/Resolved by [^:]+:\s*/i, '');

  return sanitized.trim();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const resolvedParams = await params;
    const tradeParam = resolvedParams.tradeId;

    if (!tradeParam) {
      return NextResponse.json({ error: 'Trade ID is required.' }, { status: 400 });
    }

    const authSupabase = await createClient();
    const adminSupabase = getSupabaseAdminClient();

    // 1. Verify the caller against Supabase Auth on the server. Do not trust
    // a locally stored session object as proof of identity for a protected route.
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Please log in to continue.', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    // 2. Fetch target trade (by UUID or trade_id)
    let trade: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeParam);

    if (isUuid) {
      const { data } = await adminSupabase
        .from('trades')
        .select('*')
        .eq('id', tradeParam)
        .maybeSingle();
      trade = data;
    }

    if (!trade) {
      const { data } = await adminSupabase
        .from('trades')
        .select('*')
        .eq('trade_id', tradeParam)
        .maybeSingle();
      trade = data;
    }

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // 3. Fetch current user's profile to evaluate role and status
    const { data: currentProfile, error: currentProfileError } = await adminSupabase
      .from('profiles')
      .select('id, role, status, is_suspended')
      .eq('id', user.id)
      .maybeSingle();

    // Do not grant trade access when the account status/role lookup failed.
    if (currentProfileError) {
      console.error('[trade-access] Profile authorization lookup failed');
      return NextResponse.json({ error: 'Unable to verify account access. Please try again.' }, { status: 503 });
    }
    if (!currentProfile) {
      return NextResponse.json({ error: 'Account profile is unavailable.' }, { status: 403 });
    }

    const isAdmin = ['admin', 'moderator'].includes(currentProfile.role || '');
    const isBuyer = trade.buyer_id === user.id;
    const isSeller = trade.seller_id === user.id;

    // 4. Strict Access Control Validation (Step 20.9)
    if (!isBuyer && !isSeller && !isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized access to trade instance.' },
        { status: 403 }
      );
    }

    // 5. Banned User Isolation (Step 20.11)
    // If current requesting participant is banned, prevent access for them.
    // The legitimate non-banned counterparty can still access if authorized.
    if (currentProfile?.status === 'banned' || currentProfile?.is_suspended) {
      return NextResponse.json(
        { error: 'Your account is banned. You cannot access or perform trade actions.' },
        { status: 403 }
      );
    }

    // 6. Fetch buyer and seller profiles (without exposing private keys or sensitive credentials)
    const userIds = [trade.buyer_id, trade.seller_id].filter(Boolean);
    let buyer = null;
    let seller = null;

    if (userIds.length > 0) {
      const { data: profiles } = await adminSupabase
        .from('public_profiles')
        .select('id, username, display_name, avatar_url, photo_url, country, is_verified, merchant_tier')
        .in('id', userIds);

      (profiles || []).forEach((p: any) => {
        if (p.id === trade.buyer_id) buyer = p;
        if (p.id === trade.seller_id) seller = p;
      });
    }

    // 7. Fetch chat messages from trade_chat_messages and trade_messages
    const [{ data: chatMsgs }, { data: legacyMsgs }] = await Promise.all([
      adminSupabase
        .from('trade_chat_messages')
        .select('id, trade_id, sender_id, message, created_at')
        .eq('trade_id', trade.id)
        .order('created_at', { ascending: false })
        .limit(500),
      adminSupabase
        .from('trade_messages')
        .select('id, trade_id, sender_id, message, attachment_url, media_url, media_type, visibility, created_at')
        .eq('trade_id', trade.id)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const restrictedKeys = new Set(
      (legacyMsgs || [])
        .filter((m: any) =>
          m.visibility === 'moderator_only' &&
          !isAdmin &&
          m.sender_id !== user.id
        )
        .map((m: any) => `${m.sender_id}:${m.message}:${m.created_at}`)
    );

    // The legacy chat table has no visibility column. If it mirrors a restricted
    // row from trade_messages, suppress that duplicate before merging.
    const rawList: Array<{ id: any; trade_id: any; sender_id: any; message: any; attachment_url?: string | null; media_url?: string | null; media_type?: string | null; visibility?: string | null; created_at: any }> =
      (chatMsgs || []).filter((m: any) =>
        !restrictedKeys.has(`${m.sender_id}:${m.message}:${m.created_at}`)
      );
    const seenTexts = new Set(rawList.map((m: any) => `${m.sender_id}:${m.message}:${m.created_at}`));
    (legacyMsgs || []).forEach((lm: any) => {
      const key = `${lm.sender_id}:${lm.message}:${lm.created_at}`;
      if (!seenTexts.has(key)) {
        rawList.push({
          id: lm.id,
          trade_id: lm.trade_id,
          sender_id: lm.sender_id,
          message: lm.message,
          attachment_url: lm.attachment_url,
          media_url: lm.media_url,
          media_type: lm.media_type,
          visibility: lm.visibility,
          created_at: lm.created_at,
        });
        seenTexts.add(key);
      }
    });

    // Enforce restricted-message visibility at the API boundary, not only in UI.
    // Participants may see their own restricted evidence; only moderators/admins
    // may see another user's moderator-only message.
    const visibleMessages = rawList.filter((msg: any) =>
      msg.visibility !== 'moderator_only' ||
      isAdmin ||
      msg.sender_id === user.id
    );

    visibleMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // 8. Anonymize chat and decision payload for users (Step 20.1 & 20.14)
    // Strip moderator/admin email, name, or IDs for client visibility
    const sanitizedMessages = visibleMessages.map((msg: any) => {
      const isModOrSystem =
        msg.sender_id === '00000000-0000-0000-0000-000000000000' ||
        msg.sender_id === null ||
        msg.message?.includes('Moderator') ||
        msg.message?.startsWith('[MODERATOR]') ||
        msg.message?.startsWith('[SYSTEM]') ||
        msg.message?.startsWith('🛡️');

      if (isModOrSystem) {
        return {
          id: msg.id,
          trade_id: msg.trade_id,
          sender_id: '00000000-0000-0000-0000-000000000000',
          sender_name: 'Wayones Moderator',
          message: sanitizeModeratorMessage(msg.message),
          attachment_url: msg.attachment_url || null,
          is_system: true,
          created_at: new Date(msg.created_at).toISOString(),
        };
      }

      const isMe = msg.sender_id === user.id;
      return {
        id: msg.id,
        trade_id: msg.trade_id,
        sender_id: msg.sender_id,
        sender_name: isMe ? 'You' : msg.sender_id === trade.buyer_id ? 'Buyer' : 'Seller',
        message: msg.message,
        attachment_url: msg.attachment_url || null,
        is_system: false,
        created_at: new Date(msg.created_at).toISOString(),
      };
    });

    // Return only fields needed by the trade UI. Never spread the raw database
    // row into an API response because schema additions could expose internal
    // payment, risk, or operational metadata to participants.
    const safeTrade = {
      id: trade.id,
      trade_id: trade.trade_id ?? null,
      ad_id: trade.ad_id ?? null,
      buyer_id: trade.buyer_id,
      seller_id: trade.seller_id,
      crypto: trade.crypto ?? null,
      asset_symbol: trade.asset_symbol ?? null,
      amount: trade.amount ?? null,
      crypto_amount: trade.crypto_amount ?? null,
      escrow_fee: trade.escrow_fee ?? null,
      fiat_currency: trade.fiat_currency ?? null,
      fiat_amount: trade.fiat_amount ?? null,
      fiat_amount_usd: trade.fiat_amount_usd ?? null,
      payment_method: trade.payment_method ?? null,
      price: trade.price ?? null,
      status: trade.status,
      claimed_by_buyer: trade.claimed_by_buyer ?? null,
      payment_receipt_url: trade.payment_receipt_url ?? null,
      cancellation_reason: trade.cancellation_reason ?? null,
      expires_at: trade.expires_at ?? null,
      paid_at: trade.paid_at ?? null,
      released_at: trade.released_at ?? null,
      created_at: trade.created_at ?? null,
      updated_at: trade.updated_at ?? null,
      buyer,
      seller,
    };

    return NextResponse.json({
      success: true,
      trade: safeTrade,
      chat: sanitizedMessages,
      userRole: isAdmin ? 'moderator' : isBuyer ? 'buyer' : 'seller',
    });
  } catch (err: unknown) {
    // Keep internal database/provider details out of authenticated API responses.
    console.error('[API/TRADES/TRADE_ID] Failed to load trade details.');
    return NextResponse.json(
      { error: 'Unable to load trade details right now. Please try again.' },
      { status: 500 }
    );
  }
}
