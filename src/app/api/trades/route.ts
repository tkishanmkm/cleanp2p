import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateTradeId } from '@/lib/id-generator';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { checkAdOwnerAvailability } from '@/lib/ad-owner-availability';
import { checkNewTradeEligibility } from '@/lib/account-action-guard';
import { validateAdFiatLimits } from '@/lib/trade-ad-limits';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const statusFilter = searchParams.get('status');

    let query = supabase
      .from('trades')
      .select('*')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (statusFilter) {
      const statuses = statusFilter.split(',').map((s) => s.trim().toLowerCase());
      const expandedStatuses = new Set<string>();
      for (const s of statuses) {
        expandedStatuses.add(s);
        expandedStatuses.add(s.toUpperCase());
      }
      query = query.in('status', Array.from(expandedStatuses));
    }

    const { data: trades, error } = await query;

    if (error) {
      console.error('Error fetching trades in GET /api/trades:', { code: error.code || 'UNKNOWN' });
      return NextResponse.json({ error: 'Unable to load your trades right now.' }, { status: 500 });
    }

    // Return only fields needed by participant trade-list views; do not expose
    // internal accounting, dispute, moderation, or operational columns by default.
    const publicTradeFields = [
      'id', 'trade_id', 'public_id', 'ad_id', 'buyer_id', 'seller_id',
      'status', 'escrow_status', 'is_disputed', 'created_at', 'expires_at',
      'completed_at', 'released_at', 'cancelled_at', 'expired_at', 'paid_at',
      'marked_paid_at', 'payment_window_minutes', 'payment_window',
      'crypto', 'crypto_currency', 'asset_symbol', 'amount', 'crypto_amount',
      'fiat_currency', 'fiat', 'fiat_amount', 'price', 'payment_method',
      'buyer_username', 'seller_username',
    ];
    const safeTrades = (trades || []).map((trade: Record<string, unknown>) =>
      Object.fromEntries(publicTradeFields.filter((field) => field in trade).map((field) => [field, trade[field]]))
    );
    return NextResponse.json({ trades: safeTrades });
  } catch (err: any) {
    console.error('Error in GET /api/trades:', { name: err?.name || 'UnknownError' });
    return NextResponse.json({ error: 'Unable to load your trades right now.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const eligibility = await checkNewTradeEligibility(user.id);
    if (!eligibility.allowed) {
      return NextResponse.json({ error: eligibility.message, code: eligibility.code }, { status: eligibility.statusCode });
    }

    // Pending Withdrawal Approval Lockout Check
    const isWithdrawalPending = await hasPendingWithdrawalApproval(user.id);
    if (isWithdrawalPending) {
      return NextResponse.json({
        error: 'Your previous withdrawal is awaiting administrator approval. You cannot initiate new P2P trades until it is approved or rejected.',
        code: 'WITHDRAWAL_APPROVAL_PENDING',
      }, { status: 403 });
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

    const adId = body.adId || body.ad_id;
    const rawCrypto = body.cryptoAmount ?? body.crypto_amount;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const customFiat = body.fiatCurrency || body.fiat_currency;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const tradeRef = body.tradeRef || body.trade_ref || generateTradeId();
    const rawIdempotencyKey =
      body.idempotencyKey ??
      body.idempotency_key ??
      req.headers.get('x-idempotency-key') ??
      req.headers.get('idempotency-key') ??
      '';
    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';

    if (!idempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required to initiate a trade.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      }, { status: 400 });
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: 'Invalid idempotency key format.', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
    }
    if (typeof tradeRef !== 'string' || tradeRef.length > 128) {
      return NextResponse.json({ error: 'Trade reference is invalid.' }, { status: 400 });
    }

    if (!adId) {
      return NextResponse.json({ error: 'Missing required trade parameter: adId' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(adId);

    // 1. Fetch Ad safely to read authoritative pricing & metadata
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},id.eq.${adId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', adId).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_ad_id.eq.${adId},id.eq.${adId}`).maybeSingle();
        if (primaryAd) ad = primaryAd;
      }
    }

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    // 2. Resolve unit price & amounts
    // Always use the stored advertisement price; client-supplied rates are not authoritative.
    const rawPrice = ad.fixed_rate ?? ad.price;
    const unitPrice = Number(rawPrice);
    if (!rawPrice || isNaN(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 400 }
      );
    }
    const parseAmount = (value: unknown): number => {
      if (typeof value !== 'number' && typeof value !== 'string') return Number.NaN;
      if (typeof value === 'string' && value.trim() === '') return Number.NaN;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    };
    let calculatedCrypto = parseAmount(rawCrypto);
    let numericFiat = parseAmount(rawFiat);

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      if (!isNaN(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));
    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0 || !Number.isFinite(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Trade amount is outside the supported numeric range.' }, { status: 400 });
    }
    const limitError = validateAdFiatLimits(ad, numericFiat);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });

    // 3. Resolve Payment Method & Currency
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
    const requestedPaymentMethod = typeof customPaymentMethod === 'string' ? customPaymentMethod.trim() : '';
    const resolvedPaymentMethod = requestedPaymentMethod
      ? paymentMethods.find((method) => method.trim().toLowerCase() === requestedPaymentMethod.toLowerCase())
      : paymentMethods.length === 1 ? paymentMethods[0] : undefined;
    if (!resolvedPaymentMethod) {
      return NextResponse.json({ error: 'Select a payment method supported by this advertisement.' }, { status: 400 });
    }
    // Fiat currency is authoritative on the stored advertisement, never client input.
    const resolvedFiatCurrency = ad.fiat_currency || ad.fiat || 'USD';
    const adIdentifier = String(ad.id || ad.public_ad_id || adId);
    const availabilityResponse = await checkAdOwnerAvailability(supabase, adIdentifier, idempotencyKey);
    if (availabilityResponse) return availabilityResponse;

    // 4. Call Canonical Atomic Database RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: tradeRef,
      p_idempotency_key: idempotencyKey,
      p_caller_id: user.id,
    });

    if (rpcError) {
      console.error('[POST /api/trades] RPC initiate_trade_with_escrow error:', { code: rpcError.code || 'UNKNOWN' });
      return NextResponse.json(
        { error: 'Unable to initiate this trade. Check your trade list before retrying.', code: 'ESCROW_RPC_ERROR' },
        { status: 502 }
      );
    }

    if (!rpcResult || rpcResult.success !== true) {
      console.error('[POST /api/trades] Escrow RPC did not return explicit success.');
      return NextResponse.json(
        { error: 'Unable to confirm trade initiation. Check your trade list before retrying.', code: 'ESCROW_FAILED' },
        { status: 502 }
      );
    }

    const tradeId = typeof rpcResult.trade_id === 'string' ? rpcResult.trade_id : '';
    const publicId = typeof rpcResult.public_id === 'string' ? rpcResult.public_id.trim() : '';
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
      console.error('[POST /api/trades] Escrow RPC returned an invalid trade payload.');
      return NextResponse.json(
        { error: 'Unable to confirm trade initiation. Check your trade list before retrying.', code: 'ESCROW_RESPONSE_INVALID' },
        { status: 502 }
      );
    }

    // Send Email Notification to Seller (Non-blocking & Duplicate-Protected)
    if (!rpcResult.message?.includes('idempotent replay') && sellerId) {
      try {
        void sendNewTradeNotificationEmail({
          tradeId: String(tradeId),
          publicId: String(publicId),
          sellerId: String(sellerId),
          buyerId: String(buyerId),
          cryptoAmount: calculatedCrypto,
          fiatAmount: numericFiat,
          fiatCurrency: resolvedFiatCurrency,
          asset: String(rpcResult.asset || ad.crypto || 'USDT'),
          price: unitPrice,
          paymentMethod: resolvedPaymentMethod,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }).catch((emailErr) => {
          console.error('[API/Trades] Email notification failure notice:', emailErr);
        });
      } catch (emailTriggerErr) {
        console.error('[API/Trades] Email trigger notice:', emailTriggerErr);
      }
    }

    return NextResponse.json({
      success: true,
      trade: rpcResult,
      trade_id: tradeId,
      id: tradeId,
      public_id: publicId,
    });
  } catch (err: any) {
    console.error('Trade creation API error:', { name: err?.name || 'UnknownError' });
    return NextResponse.json({ error: 'Unable to process the trade request right now.' }, { status: 500 });
  }
}
