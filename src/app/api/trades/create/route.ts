import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

    const body = await req.json();
    const { ad_id, fiat_amount, crypto_amount } = body;

    if (!ad_id) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const numericFiat = parseFloat(fiat_amount);
    if (isNaN(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Invalid fiat amount.' }, { status: 400 });
    }

    // 1. Fetch Ad
    let { data: ad } = await supabase
      .from('p2p_ads')
      .select('*')
      .or(`id.eq.${ad_id},public_ad_id.eq.${ad_id}`)
      .maybeSingle();

    if (!ad) {
      const { data: fallbackAd } = await supabase
        .from('ads')
        .select('*')
        .eq('id', ad_id)
        .maybeSingle();
      ad = fallbackAd;
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

    // 3. Verify min/max limits
    const minLimit = Number(ad.min_amount ?? ad.min_limit ?? 0);
    const maxLimit = Number(ad.max_amount ?? ad.max_limit ?? Infinity);
    if (numericFiat < minLimit || numericFiat > maxLimit) {
      return NextResponse.json(
        { error: `Amount must be between ${minLimit} and ${maxLimit} ${ad.fiat_currency || 'USD'}` },
        { status: 400 }
      );
    }

    const isSellAd = (ad.type || ad.ad_type || 'SELL').toUpperCase() === 'SELL';
    // If ad is SELL, the creator is seller, current user is buyer
    // If ad is BUY, the creator is buyer, current user is seller
    const buyerId = isSellAd ? user.id : ad.user_id;
    const sellerId = isSellAd ? ad.user_id : user.id;

    const unitPrice = Number(ad.fixed_rate ?? ad.price ?? 1);
    const calculatedCrypto = parseFloat(crypto_amount) || (unitPrice > 0 ? numericFiat / unitPrice : 0);

    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const paymentMethod = paymentMethods[0] || 'Bank Transfer';

    const shortId = 'TRD-' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 4. Insert Trade into database
    let tradeResult: any = null;

    // Full schema attempt
    const { data: insertedTrade, error: insertError } = await supabase
      .from('trades')
      .insert({
        ad_id: ad.id,
        trade_id: shortId,
        buyer_id: buyerId,
        seller_id: sellerId,
        crypto: ad.crypto || ad.asset || 'BTC',
        amount: calculatedCrypto,
        fiat_currency: ad.fiat_currency || ad.fiat || 'USD',
        fiat_amount: numericFiat,
        amount_usd: numericFiat,
        price: unitPrice,
        payment_method: paymentMethod,
        status: 'pending',
      })
      .select('*')
      .single();

    if (insertError) {
      console.warn('Full trade insertion failed, trying compatible schema fallback:', insertError);
      const { data: fallbackTrade, error: fallbackError } = await supabase
        .from('trades')
        .insert({
          buyer_id: buyerId,
          seller_id: sellerId,
          amount_usd: numericFiat,
          status: 'pending',
        })
        .select('*')
        .single();

      if (fallbackError) {
        throw fallbackError;
      }
      tradeResult = fallbackTrade;
    } else {
      tradeResult = insertedTrade;
    }

    if (!tradeResult || !tradeResult.id) {
      throw new Error('Failed to create trade record.');
    }

    return NextResponse.json({
      success: true,
      trade_id: tradeResult.id,
      id: tradeResult.id,
      trade: tradeResult,
    });
  } catch (err: any) {
    console.error('Error creating trade:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to initiate trade.' },
      { status: 500 }
    );
  }
}
