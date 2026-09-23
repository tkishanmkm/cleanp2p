import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { generateTradeId } from '@/lib/id-generator';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      adId,
      cryptoAmount,
      fiatAmount,
      paymentMethod,
      price,
      fiatCurrency,
      tradeRef,
      idempotencyKey,
    } = body;

    const resolvedIdempotencyKey =
      idempotencyKey ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      null;

    if (!adId || !cryptoAmount || Number(cryptoAmount) <= 0) {
      return NextResponse.json({ error: 'Invalid order parameters. adId and positive cryptoAmount are required.' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(adId);

    // 1. Fetch Ad safely to read metadata & verification rules
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
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    if (ad) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      const hasFullName = Boolean(
        profile?.full_name?.trim() ||
        profile?.display_name?.trim() ||
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim()
      );
      const isKycVerified = Boolean(
        profile?.is_verified ||
        profile?.kyc_status === 'approved' ||
        profile?.kyc_status === 'verified'
      );

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
    }

    // 2. Resolve calculation & authoritative inputs
    const unitPrice = Number(price ?? ad.fixed_rate ?? ad.price ?? 1);
    let calculatedCrypto = parseFloat(cryptoAmount);
    let numericFiat = parseFloat(fiatAmount);

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

    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const resolvedPaymentMethod = paymentMethod || paymentMethods[0] || 'Bank Transfer';
    const resolvedFiatCurrency = fiatCurrency || ad.fiat_currency || ad.fiat || 'USD';
    const shortRef = tradeRef || generateTradeId();
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || adId);

    // 3. Call Atomic Database RPC initiate_trade_with_escrow
    const { data, error } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: shortRef,
      p_idempotency_key: resolvedIdempotencyKey,
    });

    if (error) {
      console.error('[POST /api/p2p/orders/create] RPC error:', error);
      return NextResponse.json({ error: error.message || 'Failed to initiate trade with escrow.' }, { status: 400 });
    }

    if (!data || data.success === false) {
      return NextResponse.json({ error: data?.message || 'Failed to initiate trade with escrow.' }, { status: 400 });
    }

    const tradeId = data?.trade_id ?? data?.id;
    return NextResponse.json({
      success: true,
      tradeId,
      id: tradeId,
      publicId: data?.public_id || shortRef,
      data,
    }, { status: 201 });
  } catch (err: any) {
    console.error('Error creating order trade:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
