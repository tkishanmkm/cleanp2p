import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateTradeId } from '@/lib/id-generator';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { resolveAuthoritativeAdQuote } from '@/lib/p2p/authoritativeAdQuote';

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
      .order('created_at', { ascending: false });

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
      console.error('Error fetching trades in GET /api/trades:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ trades: trades || [] });
  } catch (err: any) {
    console.error('Error in GET /api/trades:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
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

    const body = await req.json();
    const adId = body.adId || body.ad_id;
    const rawCrypto = body.cryptoAmount ?? body.crypto_amount;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const rawTradeRef = body.tradeRef ?? body.trade_ref;
    const tradeRef = typeof rawTradeRef === 'string' && rawTradeRef.trim()
      ? rawTradeRef.trim()
      : generateTradeId();
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

    if (ad.is_active === false || ad.active === false || ['INACTIVE', 'DELETED', 'SUSPENDED', 'REJECTED'].includes(String(ad.status || '').toUpperCase())) {
      return NextResponse.json({ error: 'This advertisement is not available for new trades.' }, { status: 409 });
    }

    // Resolve price and fiat currency from server-side market/ad data only.
    const adQuote = await resolveAuthoritativeAdQuote(ad);
    if (!adQuote || !Number.isFinite(adQuote.price) || adQuote.price <= 0) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 503 }
      );
    }
    const unitPrice = adQuote.price;
    const resolvedFiatCurrency = String(adQuote.fiatCurrency || 'USD').toUpperCase();
    let calculatedCrypto = parseFloat(String(rawCrypto ?? ''));
    let numericFiat = parseFloat(String(rawFiat ?? ''));

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      if (Number.isFinite(numericFiat) && numericFiat > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));
    if (!Number.isFinite(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Invalid fiat amount.' }, { status: 400 });
    }

    // 3. Validate the selected payment method against the advertisement.
    let paymentMethods: string[] = [];
    if (Array.isArray(ad.payment_methods)) {
      paymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string' && ad.payment_methods.trim()) {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        paymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        paymentMethods = [ad.payment_methods];
      }
    }
    paymentMethods = paymentMethods.filter((method: unknown): method is string => typeof method === 'string' && method.trim().length > 0).map((method) => method.trim());
    if (paymentMethods.length === 0) paymentMethods = ['Bank Transfer'];
    const requestedPaymentMethod = typeof customPaymentMethod === 'string' ? customPaymentMethod.trim() : '';
    if (paymentMethods.length > 1 && !requestedPaymentMethod) {
      return NextResponse.json({ error: 'Select a payment method for this advertisement.' }, { status: 400 });
    }
    const resolvedPaymentMethod = requestedPaymentMethod
      ? paymentMethods.find((method) => method.toLowerCase() === requestedPaymentMethod.toLowerCase())
      : paymentMethods[0];
    if (!resolvedPaymentMethod) {
      return NextResponse.json({ error: 'Selected payment method is not supported by this advertisement.' }, { status: 400 });
    }

    const adIdentifier = String(ad.id || ad.public_ad_id || adId);

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
    });

    if (rpcError) {
      console.error('[POST /api/trades] RPC initiate_trade_with_escrow error:', rpcError);
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
    const publicId = rpcResult.public_id || tradeRef;
    const sellerId = rpcResult.seller_id || ad.user_id;
    const buyerId = rpcResult.buyer_id || user.id;

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
    console.error('Trade creation API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
