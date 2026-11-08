import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateTradeId } from '@/lib/id-generator';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { isTier2User } from '@/lib/kyc';
import { checkAdOwnerAvailability } from '@/lib/ad-owner-availability';
import { checkNewTradeEligibility } from '@/lib/account-action-guard';
import { validateAdFiatLimits } from '@/lib/trade-ad-limits';

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

    const eligibility = await checkNewTradeEligibility(user.id);
    if (!eligibility.allowed) {
      return NextResponse.json({ error: eligibility.message, code: eligibility.code }, { status: eligibility.statusCode });
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

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
      return NextResponse.json({ error: 'Trade request is too large.' }, { status: 413 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const {
      ad_id,
      fiat_amount,
      crypto_amount,
      payment_method,
      trade_ref,
      idempotency_key,
    } = body;

    const rawIdempotencyKey =
      idempotency_key ??
      body.idempotencyKey ??
      req.headers.get('x-idempotency-key') ??
      req.headers.get('idempotency-key') ??
      '';
    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';

    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency key is required to create a trade.', code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
    }
    if (idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: 'Invalid idempotency key format.', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
    }

    const cleanAdId = typeof ad_id === 'string' ? ad_id.trim().replace(/^#/, '') : '';
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(cleanAdId)) {
      return NextResponse.json({ error: 'Advertisement identifier is invalid.', code: 'INVALID_ADVERTISEMENT_ID' }, { status: 400 });
    }
    if (trade_ref !== undefined && trade_ref !== null &&
        (typeof trade_ref !== 'string' || trade_ref.trim().length === 0 ||
         trade_ref.trim().length > 128 || !/^[A-Za-z0-9._:-]+$/.test(trade_ref.trim()))) {
      return NextResponse.json({ error: 'Trade reference is invalid.', code: 'INVALID_TRADE_REFERENCE' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(cleanAdId);

    // 1. Fetch Ad safely to read metadata & parameters
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${cleanAdId},public_ad_id.eq.${cleanAdId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${cleanAdId},id.eq.${cleanAdId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', cleanAdId).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_ad_id.eq.${cleanAdId},id.eq.${cleanAdId}`).maybeSingle();
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
    // Pricing is authoritative on the stored advertisement, never client input.
    const rawPrice = ad.fixed_rate ?? ad.price;
    const unitPrice = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 400 }
      );
    }
    let calculatedCrypto = Number(crypto_amount);
    let numericFiat = Number(fiat_amount);

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      if (Number.isFinite(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    // Exact fiat amount invariant: fiat_amount = ROUND(crypto_amount * price, 2)
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));
    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0 || !Number.isFinite(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Trade amount is outside the supported numeric range.' }, { status: 400 });
    }

    // 4. Verify the stored advertisement's min/max limits using the shared validator.
    const limitError = validateAdFiatLimits(ad, numericFiat);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });

    // 5. Verify Trader Requirements (Full name & KYC)
    const { data: buyerProfile, error: buyerProfileError } = await supabase
      .from('profiles')
      .select('full_name, display_name, kyc_status')
      .eq('id', user.id)
      .maybeSingle();

    if (buyerProfileError) {
      console.error('[Trade Creation] Buyer profile eligibility lookup failed:', buyerProfileError.code || 'UNKNOWN');
      return NextResponse.json(
        { error: 'Unable to verify the buyer profile requirements. Please try again.', code: 'BUYER_PROFILE_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const hasFullName = Boolean(
      buyerProfile?.full_name?.trim() ||
      buyerProfile?.display_name?.trim() ||
      user.user_metadata?.full_name?.trim() ||
      user.user_metadata?.name?.trim()
    );
    const isKycVerified = isTier2User(buyerProfile);

    if (ad.require_full_name_verified && !hasFullName) {
      return NextResponse.json(
        { error: 'This trade requires you to have a verified full legal name on your profile.' },
        { status: 403 }
      );
    }

    if (ad.require_verified_users && !isKycVerified) {
      return NextResponse.json(
        { error: 'This trade requires completed identity (KYC) verification.' },
        { status: 403 }
      );
    }

    // Cumulative Tier 1 BUY volume and USD conversion are enforced transactionally by the escrow RPC.
    // Do not repeat them here using client-side FX snapshots or both sides of historical trades.

    // 7. Resolve Payment Method & Currency
    let rawPaymentMethods: unknown[] = [];
    if (Array.isArray(ad.payment_methods)) {
      rawPaymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        rawPaymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        rawPaymentMethods = [ad.payment_methods];
      }
    } else if (typeof ad.payment_method === 'string') {
      rawPaymentMethods = [ad.payment_method];
    }
    const paymentMethods = rawPaymentMethods.filter(
      (method): method is string => typeof method === 'string' && method.trim().length > 0
    );
    const requestedPaymentMethod = typeof payment_method === 'string' ? payment_method.trim() : '';
    if (paymentMethods.length === 0) {
      return NextResponse.json({ error: 'This advertisement has no valid payment method configured.' }, { status: 400 });
    }
    const matchedPaymentMethod = requestedPaymentMethod
      ? paymentMethods.find((method) => method.trim().toLowerCase() === requestedPaymentMethod.toLowerCase())
      : paymentMethods.length === 1 ? paymentMethods[0] : undefined;
    if (!matchedPaymentMethod) {
      return NextResponse.json({ error: 'Select a payment method supported by this advertisement.' }, { status: 400 });
    }
    const resolvedPaymentMethod = matchedPaymentMethod;
    // Fiat currency is also canonicalized from the stored advertisement.
    const resolvedFiatCurrency = ad.fiat_currency || ad.fiat || 'USD';
    const shortRef = typeof trade_ref === 'string' && trade_ref.trim() ? trade_ref.trim() : generateTradeId();
    const adIdentifier = String(ad.id || ad.public_ad_id || cleanAdId);
    const availabilityResponse = await checkAdOwnerAvailability(supabase, adIdentifier, idempotencyKey);
    if (availabilityResponse) return availabilityResponse;

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
      console.error('[Trade Creation] Escrow RPC failed:', { code: rpcError.code || 'UNKNOWN' });
      return NextResponse.json(
        { error: 'Unable to initiate this trade. Please review the trade details and try again.', code: rpcError.code === 'P0001' ? 'ESCROW_ERROR' : 'RPC_ERROR' },
        { status: 400 }
      );
    }

    if (!rpcResult || rpcResult.success !== true) {
      console.error('[Trade Creation] Escrow RPC did not return explicit success.');
      return NextResponse.json(
        { error: 'Unable to confirm trade initiation. Check your trade list before retrying.', code: 'ESCROW_FAILED' },
        { status: 502 }
      );
    }

    const tradeId = typeof rpcResult.trade_id === 'string' ? rpcResult.trade_id : '';
    const publicId = typeof rpcResult.public_id === 'string' && rpcResult.public_id.trim() ? rpcResult.public_id : shortRef;
    const sellerId = typeof rpcResult.seller_id === 'string' ? rpcResult.seller_id : '';
    const buyerId = typeof rpcResult.buyer_id === 'string' ? rpcResult.buyer_id : '';
    const adType = String(ad.type || ad.ad_type || 'SELL').trim().toUpperCase();
    const expectedBuyerId = adType === 'BUY' ? String(ad.user_id || '') : user.id;
    const expectedSellerId = adType === 'BUY' ? user.id : String(ad.user_id || '');
    const responseCryptoAmount = Number(rpcResult.crypto_amount);
    const responseFiatAmount = Number(rpcResult.fiat_amount);
    if (
      !isValidUUID(tradeId) || !publicId || !expectedBuyerId || !expectedSellerId ||
      buyerId !== expectedBuyerId || sellerId !== expectedSellerId || buyerId === sellerId ||
      !Number.isFinite(responseCryptoAmount) || responseCryptoAmount !== calculatedCrypto ||
      !Number.isFinite(responseFiatAmount) || responseFiatAmount !== numericFiat
    ) {
      console.error('[Trade Creation] Escrow RPC returned an invalid trade payload.');
      return NextResponse.json(
        { error: 'Unable to confirm trade initiation. Check your trade list before retrying.', code: 'ESCROW_RESPONSE_INVALID' },
        { status: 502 }
      );
    }
    const nowIso = new Date().toISOString();

    // 9. Send Auto-Reply Message if configured
    try {
      const autoReplyText = ad.auto_reply?.trim();
      let sellerAutoReply = autoReplyText;
      let sellerUsername = 'Trader';

      const { data: sellerProf, error: sellerProfileError } = await supabase
        .from('public_profiles')
        .select('username')
        .eq('id', sellerId)
        .maybeSingle();

      if (sellerProfileError) {
        console.warn('[Trade Creation] Public seller username lookup failed:', sellerProfileError.code || 'UNKNOWN');
      } else if (sellerProf?.username) {
        sellerUsername = sellerProf.username;
      }

      // Auto-reply is sourced from the advertisement itself. The deployed
      // profiles table has no auto_reply_message column.

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
