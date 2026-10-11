import { createClient } from '@/utils/supabase/server';
import { resolveAuthoritativeAdQuote } from '@/lib/p2p/authoritativeAdQuote';
import { getTradeEligibilityFailure } from '@/lib/p2p/tradeEligibility';
import { NextRequest, NextResponse } from 'next/server';
import { generateTradeId } from '@/lib/id-generator';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Please sign in to initiate a trade.' },
        { status: 401 }
      );
    }

    // Pending Withdrawal Approval Lockout Check
    const isWithdrawalPending = await hasPendingWithdrawalApproval(user.id);
    if (isWithdrawalPending) {
      return NextResponse.json(
        {
          error: 'Your previous withdrawal is awaiting administrator approval. You cannot initiate new P2P trades until it is approved or rejected.',
          code: 'WITHDRAWAL_APPROVAL_PENDING',
        },
        { status: 403 }
      );
    }

    // Platform Guard Check
    try {
      await assertPlatformControlAllowed('trade', { userId: user.id });
    } catch (guardErr: any) {
      return NextResponse.json(
        { error: guardErr.message || 'Trading is temporarily disabled.', code: guardErr.code || 'PLATFORM_TRADING_DISABLED' },
        { status: guardErr.statusCode || 403 }
      );
    }

    const body = await req.json();
    const {
      ad_id,
      fiat_amount,
      crypto_amount,
      payment_method,
      trade_ref,
      idempotency_key,
    } = body;

    const idempotencyKey =
      (idempotency_key ||
      body.idempotencyKey ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      '').trim();

    if (!idempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required to create a trade.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      }, { status: 400 });
    }

    if (!ad_id) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(ad_id);

    // 1. Fetch Ad safely to read metadata & parameters
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${ad_id},public_ad_id.eq.${ad_id}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${ad_id},id.eq.${ad_id}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', ad_id).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_ad_id.eq.${ad_id},id.eq.${ad_id}`).maybeSingle();
        if (primaryAd) ad = primaryAd;
      }
    }

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 2. Prevent trading with own ad
    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    // 3. Resolve numerical values and authoritative parameters
    const adQuote = await resolveAuthoritativeAdQuote(ad);
    if (!adQuote) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 400 }
      );
    }
    const unitPrice = adQuote.price;
    const adFiatCurrency = adQuote.fiatCurrency;
    let calculatedCrypto = parseFloat(crypto_amount);
    let numericFiat = parseFloat(fiat_amount);

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      if (!isNaN(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    // Exact fiat amount invariant: fiat_amount = ROUND(crypto_amount * price, 2)
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));

    // 4. Verify min/max limits
    const minLimit = Number(ad.min_amount ?? ad.min_limit ?? 0);
    const maxLimit = Number(ad.max_amount ?? ad.max_limit ?? Infinity);
    if (numericFiat < minLimit || numericFiat > maxLimit) {
      return NextResponse.json(
        { error: `Amount must be between ${minLimit} and ${maxLimit} ${adFiatCurrency}` },
        { status: 400 }
      );
    }

    const eligibilityFailure = await getTradeEligibilityFailure(supabase, user, ad, numericFiat, adFiatCurrency);
    if (eligibilityFailure) {
      return NextResponse.json({ error: eligibilityFailure.error, code: eligibilityFailure.code }, { status: eligibilityFailure.status });
    }

    const shortRef = trade_ref || generateTradeId();
    const adIdentifier = String(ad.id || ad.public_ad_id || ad_id);

    // 8. Execute Atomic Escrow Lock & Trade Creation via Canonical Database RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: shortRef,
      p_idempotency_key: idempotencyKey,
      p_caller_id: user.id,
    });

    if (rpcError) {
      console.error('[Trade Creation] initiate_trade_with_escrow RPC error:', rpcError);
      return NextResponse.json(
        { error: rpcError.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    if (!rpcResult || rpcResult.success === false) {
      return NextResponse.json(
        { error: rpcResult?.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    const tradeId = rpcResult.trade_id;
    const publicId = rpcResult.public_id || shortRef;
    const sellerId = rpcResult.seller_id;
    const buyerId = rpcResult.buyer_id;
    const nowIso = new Date().toISOString();

    // 9. Send Auto-Reply Message if configured
    try {
      const autoReplyText = ad.auto_reply?.trim();
      let sellerAutoReply = autoReplyText;
      let sellerUsername = 'Trader';

      const { data: sellerProf } = await supabase
        .from('profiles')
        .select('username, auto_reply_message')
        .eq('id', sellerId)
        .maybeSingle();

      if (sellerProf) {
        if (sellerProf.username) sellerUsername = sellerProf.username;
        if (!sellerAutoReply && sellerProf.auto_reply_message?.trim()) {
          sellerAutoReply = sellerProf.auto_reply_message.trim();
        }
      }

      if (sellerAutoReply && sellerAutoReply.length > 0) {
        await supabase.from('trade_messages').insert({
          trade_id: tradeId,
          sender_id: sellerId,
          sender_username: sellerUsername,
          message: sellerAutoReply,
          visibility: 'all',
          created_at: nowIso,
        });
      }
    } catch (autoReplyErr) {
      console.warn('Auto-reply message creation notice:', autoReplyErr);
    }

    // 10. Send Activity Center & Trade Request Notifications
    try {
      const formattedCoin = (rpcResult.asset || ad.crypto || 'USDT').toUpperCase();
      const tradeLink = `/trade/${publicId || tradeId}`;

      // Prevent duplicate trade-created notifications on retry
      const { data: existingNotifs } = await supabase
        .from('notifications')
        .select('id, user_id')
        .eq('metadata->>link', tradeLink)
        .eq('type', 'trade_initiated')
        .limit(2);

      const notifiedUsers = new Set((existingNotifs || []).map((n: any) => n.user_id));

      if (sellerId && !notifiedUsers.has(sellerId)) {
        await supabase.from('notifications').insert({
          user_id: sellerId,
          title: 'Trade Request Initiated',
          message: `New trade request #${publicId} opened: ${calculatedCrypto.toFixed(4)} ${formattedCoin} for ${numericFiat.toFixed(2)} ${resolvedFiatCurrency}.`,
          type: 'trade_initiated',
          is_read: false,
          read: false,
          metadata: { link: tradeLink },
          created_at: nowIso,
        });
      }
      if (buyerId && buyerId !== sellerId && !notifiedUsers.has(buyerId)) {
        await supabase.from('notifications').insert({
          user_id: buyerId,
          title: 'Trade Request Initiated',
          message: `Trade #${publicId} opened successfully. Awaiting payment/escrow confirmation.`,
          type: 'trade_initiated',
          is_read: false,
          read: false,
          metadata: { link: tradeLink },
          created_at: nowIso,
        });
      }
    } catch (notifErr) {
      console.warn('Trade notification creation notice:', notifErr);
    }

    // 11. Send Email Notification to Seller (Non-blocking & Duplicate-Protected)
    if (!rpcResult.message?.includes('idempotent replay') && sellerId) {
      try {
        void sendNewTradeNotificationEmail({
          tradeId: String(tradeId),
          publicId: String(publicId),
          sellerId: String(sellerId),
          buyerId: String(buyerId || user.id),
          cryptoAmount: calculatedCrypto,
          fiatAmount: numericFiat,
          fiatCurrency: resolvedFiatCurrency,
          asset: String(rpcResult.asset || ad.crypto || 'USDT'),
          price: unitPrice,
          paymentMethod: resolvedPaymentMethod,
          status: 'pending',
          createdAt: nowIso,
        }).catch((emailErr) => {
          console.error('[Trade Creation] Email notification failure notice:', emailErr);
        });
      } catch (emailTriggerErr) {
        console.error('[Trade Creation] Email trigger notice:', emailTriggerErr);
      }
    }

    return NextResponse.json({
      success: true,
      trade_id: tradeId,
      id: tradeId,
      public_id: publicId,
      trade: rpcResult,
    });
  } catch (err: any) {
    console.error('Error creating trade:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to initiate trade.' },
      { status: 500 }
    );
  }
}
