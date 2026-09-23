import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateTradeId } from '@/lib/id-generator';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized request' },
        { status: 401 }
      );
    }

    // 2. Parse Payload
    const body = await request.json();
    const adId = body.orderId || body.order_id || body.adId || body.ad_id;
    const rawCrypto = body.amount ?? body.cryptoAmount ?? body.crypto_amount;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const customPrice = body.price ?? body.rate;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const customFiatCurrency = body.fiatCurrency || body.fiat_currency;
    const tradeRef = body.tradeRef || body.trade_ref || generateTradeId();
    const idempotencyKey =
      body.idempotencyKey ||
      body.idempotency_key ||
      request.headers.get('x-idempotency-key') ||
      request.headers.get('idempotency-key') ||
      null;

    if (!adId) {
      return NextResponse.json(
        { success: false, error: 'Valid ad or order identifier is required' },
        { status: 400 }
      );
    }

    const isIdUUID = isValidUUID(adId);

    // 3. Fetch Ad safely to read metadata & pricing
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},public_id.eq.${adId},id.eq.${adId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', adId).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_id.eq.${adId},public_ad_id.eq.${adId}`).maybeSingle();
        if (primaryAd) ad = primaryAd;
      }
    }

    if (!ad) {
      return NextResponse.json(
        { success: false, error: 'Advertisement not found.' },
        { status: 404 }
      );
    }

    if (ad.user_id === user.id) {
      return NextResponse.json(
        { success: false, error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    // 4. Resolve exact numerical amounts
    const unitPrice = Number(customPrice ?? ad.fixed_rate ?? ad.price ?? 1);
    let calculatedCrypto = parseFloat(rawCrypto);
    let numericFiat = parseFloat(rawFiat);

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      if (!isNaN(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid positive crypto amount is required' },
        { status: 400 }
      );
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));

    // 5. Resolve Payment Method & Currency
    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const resolvedPaymentMethod = customPaymentMethod || paymentMethods[0] || 'Bank Transfer';
    const resolvedFiatCurrency = customFiatCurrency || ad.fiat_currency || ad.fiat || 'USD';
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || adId);

    // 6. Execute Atomic Database RPC (Locks Escrow & Creates Trade)
    const { data, error } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: tradeRef,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('[POST /api/p2p/trade/initiate] RPC initiate_trade_with_escrow error:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    if (!data || data.success === false) {
      return NextResponse.json(
        { success: false, error: data?.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    // 7. Return Created Trade Details
    return NextResponse.json({
      success: true,
      tradeId: data?.trade_id ?? data?.id,
      id: data?.trade_id ?? data?.id,
      publicId: data?.public_id || tradeRef,
      fiatAmount: data?.fiat_amount ?? numericFiat,
      data,
    });
  } catch (err: any) {
    console.error('Error initiating p2p trade:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
