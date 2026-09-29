import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { generateTradeId } from '@/lib/id-generator';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: Request) {
  try {
    let supabase = await createClient();
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    console.log('[DEBUG] Auth getUser result:', { user: user?.id, error: authError });

    if (authError || !user) {
      return NextResponse.json({ 
        error: 'Unauthorized. Please sign in.',
        debug: { authError, userId: user?.id }
      }, { status: 401 });
    }

    const body = await req.json();
    const adId = body.adId || body.ad_id;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const rawCrypto = body.cryptoAmount ?? body.crypto_amount;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const customPrice = body.price || body.rate;
    const customFiatCurrency = body.fiatCurrency || body.fiat_currency;
    const tradeRef = body.tradeRef || body.trade_ref || generateTradeId();
    const idempotencyKey =
      body.idempotencyKey ||
      body.idempotency_key ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      null;

    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(adId);

    // 1. Fetch Ad safely to read metadata
    let ad: any = null;
    console.log('[DEBUG] Auth User ID:', user?.id);
    
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

    // 2. Prevent trading with own ad
    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    // 3. Resolve numerical amounts with exact precision
    const rawPrice = customPrice ?? ad.fixed_rate ?? ad.price;
    const unitPrice = Number(rawPrice);
    if (!rawPrice || isNaN(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 400 }
      );
    }
    let calculatedCrypto = parseFloat(rawCrypto);
    let numericFiat = parseFloat(rawFiat);

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

    // 4. Resolve Payment Method & Currency
    let rawPaymentMethods: any[] = [];
    if (Array.isArray(ad.payment_methods)) {
      rawPaymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        rawPaymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        rawPaymentMethods = [ad.payment_methods];
      }
    } else if (ad.payment_method) {
      rawPaymentMethods = [ad.payment_method];
    } else {
      rawPaymentMethods = ['Bank Transfer'];
    }

    const paymentMethods: string[] = rawPaymentMethods.filter((m: any) => typeof m === 'string' && m.trim().length > 0);

    let resolvedPaymentMethod = '';
    const trimmedCustom = typeof customPaymentMethod === 'string' ? customPaymentMethod.trim() : '';

    if (paymentMethods.length > 1) {
      if (!trimmedCustom) {
        return NextResponse.json({ error: 'Please select a payment method for this advertisement.' }, { status: 400 });
      }
      const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedCustom.toLowerCase());
      if (!matched) {
        return NextResponse.json({ error: `Selected payment method "${trimmedCustom}" is not supported by this advertisement.` }, { status: 400 });
      }
      resolvedPaymentMethod = matched;
    } else if (paymentMethods.length === 1) {
      if (trimmedCustom) {
        const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedCustom.toLowerCase());
        if (!matched) {
          return NextResponse.json({ error: `Selected payment method "${trimmedCustom}" is not supported by this advertisement.` }, { status: 400 });
        }
        resolvedPaymentMethod = matched;
      } else {
        resolvedPaymentMethod = paymentMethods[0];
      }
    } else {
      resolvedPaymentMethod = trimmedCustom || 'Bank Transfer';
    }

    const resolvedFiatCurrency = customFiatCurrency || ad.fiat_currency || ad.fiat || 'USD';
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || adId);

    // 5. Call Canonical Atomic Database RPC
    console.log('[DEBUG] Calling initiate_trade_with_escrow RPC with user ID:', user?.id);
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
      console.error('[trades/initiate] RPC initiate_trade_with_escrow error:', rpcError);
      return NextResponse.json(
        {
          success: false,
          code: rpcError.code === 'P0001' ? 'ESCROW_ERROR' : 'RPC_ERROR',
          error: rpcError.message || 'Failed to initiate trade with escrow.',
        },
        { status: 400 }
      );
    }

    if (!rpcResult || rpcResult.success === false) {
      return NextResponse.json(
        {
          success: false,
          code: 'ESCROW_FAILED',
          error: rpcResult?.message || 'Failed to initiate trade with escrow.',
        },
        { status: 400 }
      );
    }

    const tradeId = rpcResult.trade_id;
    const publicId = rpcResult.public_id || tradeRef;

    if (tradeId && resolvedPaymentMethod) {
      const adminClient = getSupabaseAdminClient();
      await adminClient
        .from('trades')
        .update({ payment_method: resolvedPaymentMethod })
        .eq('id', tradeId);
    }

    return NextResponse.json({
      success: true,
      tradeId: tradeId,
      id: tradeId,
      publicId: publicId,
      message: 'Trade initiated successfully. Escrow locked.',
      data: rpcResult,
      trade: rpcResult,
    });
  } catch (err: any) {
    console.error('Error initiating trade:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
