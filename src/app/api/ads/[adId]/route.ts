import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const supabase = await createClient();

    // Query Supabase p2p_ads table
    const { data: ad, error } = await supabase
      .from('p2p_ads')
      .select('*')
      .eq('id', adId)
      .single();

    if (error || !ad) {
      // Return a structured fallback object if not found
      return NextResponse.json({
        id: adId,
        userId: 'trader_1',
        adType: 'sell',
        crypto: 'BTC',
        fiatCurrency: 'USD',
        rateType: 'floating',
        ratePercent: 0,
        minAmount: 100,
        maxAmount: 5000,
        paymentMethods: ['Bank Transfer', 'Wise', 'PayPal'],
        offerLabel: 'Fast & Secure Release',
        terms: 'Please make payment from your own verified account only. No third party.',
        tags: ['Fast release', 'No third party'],
      });
    }

    return NextResponse.json({
      id: ad.id,
      userId: ad.user_id,
      adType: ad.ad_type || 'sell',
      crypto: ad.crypto || 'BTC',
      fiatCurrency: ad.fiat_currency || 'USD',
      rateType: ad.rate_type === 'fixed' ? 'fixed' : 'floating',
      fixedRate: ad.fixed_rate,
      ratePercent: ad.rate_percent || 0,
      minAmount: Number(ad.min_amount || 100),
      maxAmount: Number(ad.max_amount || 5000),
      paymentMethods: ad.payment_methods || ['Bank Transfer'],
      offerLabel: ad.offer_label,
      terms: ad.terms || '',
      tags: ad.tags || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch ad' },
      { status: 500 }
    );
  }
}
