import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateTradeId } from '@/lib/id-generator';

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

    const body = await req.json();
    const adId = body.adId || body.ad_id;
    const rawCrypto = body.cryptoAmount ?? body.crypto_amount;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const customRate = body.rate || body.price;
    const customFiat = body.fiatCurrency || body.fiat_currency;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const tradeRef = body.tradeRef || body.trade_ref || generateTradeId();
    const idempotencyKey =
      body.idempotencyKey ||
      body.idempotency_key ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      null;

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

    // 2. Resolve unit price & amounts
    const unitPrice = Number(customRate ?? ad.fixed_rate ?? ad.price ?? 1);
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

    // 3. Resolve Payment Method & Currency
    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const resolvedPaymentMethod = customPaymentMethod || paymentMethods[0] || 'Bank Transfer';
    const resolvedFiatCurrency = customFiat || ad.fiat_currency || ad.fiat || 'USD';
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || adId);

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

    return NextResponse.json({
      success: true,
      trade: rpcResult,
      trade_id: tradeId,
      id: tradeId,
      public_id: rpcResult.public_id || tradeRef,
    });
  } catch (err: any) {
    console.error('Trade creation API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
