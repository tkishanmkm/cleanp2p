import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function formatPresence(lastActive?: string | null): string {
  if (!lastActive) return 'Online';
  const diffMs = Date.now() - new Date(lastActive).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  if (diffMinutes < 5) return 'Online';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return 'Offline';
}

export async function GET(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const supabase = await createClient();

    // Query Supabase p2p_ads table
    let { data: ad, error } = await supabase
      .from('p2p_ads')
      .select('*')
      .or(`id.eq.${adId},public_ad_id.eq.${adId}`)
      .maybeSingle();

    if (!ad) {
      const { data: fallbackAd } = await supabase
        .from('ads')
        .select('*')
        .eq('id', adId)
        .maybeSingle();
      ad = fallbackAd;
    }

    if (!ad) {
      // Fallback dummy ad object for mock/dev previews
      const fallbackObj = {
        id: adId,
        userId: 'trader_1',
        type: 'SELL',
        asset: 'BTC',
        fiat_currency: 'USD',
        price: 64250,
        pricing_type: 'FLOAT' as const,
        margin_percent: 1.5,
        status: 'ACTIVE' as const,
        min_limit: 100,
        max_limit: 5000,
        available_amount: 0.5,
        payment_methods: ['Bank Transfer', 'Wise', 'PayPal'],
        offer_tags: ['Fast release', 'No third party', 'Instant verification'],
        terms_conditions: 'Please make payment from your own verified account only. Release takes less than 5 minutes once payment is verified.',
        trader_presence: 'Online',
        // backward compatibility
        adType: 'sell',
        crypto: 'BTC',
        fiatCurrency: 'USD',
        rateType: 'floating',
        ratePercent: 1.5,
        minAmount: 100,
        maxAmount: 5000,
        offerLabel: 'Fast & Secure Release',
        terms: 'Please make payment from your own verified account only.',
        tags: ['Fast release', 'No third party'],
      };
      return NextResponse.json({ ...fallbackObj, ad: fallbackObj });
    }

    // Fetch user profile for presence
    let presence = 'Online';
    if (ad.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('last_active')
        .eq('id', ad.user_id)
        .maybeSingle();
      if (profile?.last_active) {
        presence = formatPresence(profile.last_active);
      }
    }

    const priceVal = Number(ad.price ?? ad.fixed_rate ?? 0);
    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];

    const tags = Array.isArray(ad.tags)
      ? ad.tags
      : Array.isArray(ad.offer_tags)
      ? ad.offer_tags
      : [];

    const formatted = {
      id: ad.id,
      userId: ad.user_id,
      type: (ad.type || ad.ad_type || 'SELL').toUpperCase(),
      asset: ad.crypto || ad.asset || ad.coin || 'BTC',
      fiat_currency: ad.fiat_currency || ad.fiat || 'USD',
      price: priceVal || 1000,
      pricing_type: (ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED') ? 'FIXED' : 'FLOAT',
      margin_percent: Number(ad.rate_percent ?? ad.margin_percent ?? 0),
      status: (ad.active !== false && ad.status !== 'INACTIVE') ? 'ACTIVE' : 'INACTIVE',
      min_limit: Number(ad.min_limit ?? ad.min_amount ?? 100),
      max_limit: Number(ad.max_limit ?? ad.max_amount ?? 5000),
      available_amount: Number(ad.available_amount ?? ad.total_amount ?? ad.max_amount ?? 1),
      payment_methods: paymentMethods,
      offer_tags: tags,
      terms_conditions: ad.terms_conditions || ad.terms || '',
      trader_presence: presence,
      // Legacy compatibility
      adType: (ad.ad_type || ad.type || 'sell').toLowerCase(),
      crypto: ad.crypto || 'BTC',
      fiatCurrency: ad.fiat_currency || 'USD',
      rateType: ad.rate_type === 'fixed' ? 'fixed' : 'floating',
      fixedRate: ad.fixed_rate,
      ratePercent: Number(ad.rate_percent || 0),
      minAmount: Number(ad.min_amount || 100),
      maxAmount: Number(ad.max_amount || 5000),
      paymentMethods: paymentMethods,
      offerLabel: ad.offer_label,
      terms: ad.terms || '',
      tags: tags,
    };

    return NextResponse.json({
      ...formatted,
      ad: formatted,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch ad' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const supabase = await createClient();

    // Soft delete or mark inactive
    await supabase
      .from('p2p_ads')
      .update({ active: false, status: 'INACTIVE' })
      .eq('id', adId);

    await supabase
      .from('ads')
      .update({ status: 'INACTIVE' })
      .eq('id', adId);

    return NextResponse.json({ success: true, message: 'Ad deleted successfully.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to delete ad' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const body = await request.json();
    const supabase = await createClient();

    const newStatus = body.status;
    const isActive = newStatus === 'ACTIVE';

    await supabase
      .from('p2p_ads')
      .update({ active: isActive, status: newStatus })
      .eq('id', adId);

    await supabase
      .from('ads')
      .update({ status: newStatus })
      .eq('id', adId);

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update ad' }, { status: 500 });
  }
}
