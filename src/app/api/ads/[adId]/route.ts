import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { findAdById } from '@/lib/ad-lookup';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { FIAT_CURRENCIES } from '@/lib/currencies';

export const dynamic = 'force-dynamic';

const VALID_SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'LTC'];

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
    const adId = (rawParams.adId || '').trim();

    const resolved = await findAdById(adId);
    let ad = resolved?.ad || null;

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Fetch user profile for presence and trader info using admin client
    const admin = getSupabaseAdminClient();
    let presence = 'Online';
    let profileData: any = null;
    const adOwnerUserId = ad.user_id || ad.userId || ad.seller_id || ad.creator_id || ad.user?.id;
    if (adOwnerUserId) {
      try {
        const { data: profile } = await admin
          .from('profiles')
          .select('*')
          .eq('id', adOwnerUserId)
          .maybeSingle();
        if (profile) {
          profileData = profile;
          const lastSeen = profile.last_seen || profile.last_seen_at || profile.last_active;
          if (lastSeen) {
            presence = formatPresence(lastSeen);
          }
        }
      } catch (profileErr) {
        console.warn('Failed to fetch profile in ad GET:', profileErr);
      }
    }

    const priceVal = Number(ad.price ?? ad.unit_price ?? ad.fixed_rate ?? 0);
    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];

    const tags = Array.isArray(ad.tags)
      ? ad.tags
      : Array.isArray(ad.offer_tags)
      ? ad.offer_tags
      : Array.isArray(ad.ad_tags)
      ? ad.ad_tags
      : [];

    const targetedCountries = Array.isArray(ad.targeted_countries) ? ad.targeted_countries : [];
    const blockedCountries = Array.isArray(ad.blocked_countries) ? ad.blocked_countries : [];
    const paymentWindow = Number(ad.payment_window ?? ad.payment_window_minutes ?? 30);
    const minTrades = Number(ad.min_completed_trades ?? 0);
    const requireFullName = Boolean(ad.require_full_name_verified);
    const requireVerified = Boolean(ad.require_verified_users);

    const assetSym = (
      ad.asset_symbol ||
      ad.crypto_symbol ||
      ad.crypto_currency ||
      ad.crypto ||
      ad.asset ||
      ad.coin ||
      'USDT'
    ).toUpperCase();

    const fiatSym = (
      ad.fiat_symbol ||
      ad.fiat_currency ||
      ad.fiatCurrency ||
      ad.fiat ||
      ad.currency ||
      'USD'
    ).toUpperCase();

    const formatted = {
      ...ad,
      id: ad.id,
      userId: adOwnerUserId,
      type: (ad.type || ad.ad_type || 'SELL').toUpperCase(),
      asset: assetSym,
      asset_symbol: assetSym,
      crypto: assetSym,
      crypto_symbol: assetSym,
      crypto_currency: assetSym,
      coin: assetSym,
      fiat_currency: fiatSym,
      fiat_symbol: fiatSym,
      fiatCurrency: fiatSym,
      fiat: fiatSym,
      currency: fiatSym,
      price: priceVal || 1000,
      pricing_type: (ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' || ad.is_fixed) ? 'FIXED' : 'FLOAT',
      rate_type: (ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' || ad.is_fixed) ? 'fixed' : 'market',
      is_fixed: Boolean(ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' || ad.is_fixed),
      margin_percent: Number(ad.rate_percent ?? ad.margin_percent ?? ad.margin ?? 0),
      rate_percent: Number(ad.rate_percent ?? ad.margin_percent ?? ad.margin ?? 0),
      margin: Number(ad.rate_percent ?? ad.margin_percent ?? ad.margin ?? 0),
      status: (ad.active !== false && ad.status !== 'INACTIVE') ? 'ACTIVE' : 'INACTIVE',
      min_limit: Number(ad.min_limit ?? ad.min_amount ?? 10),
      max_limit: Number(ad.max_limit ?? ad.max_amount ?? 1000),
      min_amount: Number(ad.min_amount ?? ad.min_limit ?? 10),
      max_amount: Number(ad.max_amount ?? ad.max_limit ?? 1000),
      available_amount: Number(ad.available_amount ?? ad.total_amount ?? ad.max_amount ?? 1),
      payment_methods: paymentMethods,
      offer_tags: tags,
      tags: tags,
      terms_conditions: ad.terms_conditions || ad.terms || '',
      terms: ad.terms || ad.terms_conditions || '',
      offer_label: ad.offer_label || '',
      payment_window: paymentWindow,
      payment_window_minutes: paymentWindow,
      targeted_countries: targetedCountries,
      blocked_countries: blockedCountries,
      min_completed_trades: minTrades,
      require_full_name_verified: requireFullName,
      require_verified_users: requireVerified,
      trader_presence: presence,
      user: profileData ? {
        id: profileData.id,
        username: profileData.username || ad.user_display_name || 'Trader',
        avatar_url: profileData.avatar_url || profileData.photo_url,
        photo_url: profileData.avatar_url || profileData.photo_url,
        created_at: profileData.created_at,
        completed_trades: profileData.completed_trades || 0,
        positive_feedback: profileData.positive_feedback || 0,
        negative_feedback: profileData.negative_feedback || 0,
        avg_release_time: profileData.avg_release_time || 'N/A',
        avg_release_minutes: profileData.avg_release_minutes,
        avg_pay_time: profileData.avg_pay_time || 'N/A',
        avg_payment_minutes: profileData.avg_payment_minutes,
        last_seen: profileData.last_seen || profileData.last_seen_at || profileData.last_active,
        last_seen_at: profileData.last_seen_at || profileData.last_seen || profileData.last_active,
      } : {
        id: adOwnerUserId,
        username: ad.user_display_name || 'Trader',
        completed_trades: 0,
        positive_feedback: 0,
        negative_feedback: 0,
      },
      // Legacy compatibility
      adType: (ad.ad_type || ad.type || 'sell').toLowerCase(),
      rateType: (ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' || ad.is_fixed) ? 'fixed' : 'market',
      fixedRate: ad.fixed_rate ?? ad.price,
      ratePercent: Number(ad.rate_percent || ad.margin || 0),
      minAmount: Number(ad.min_amount || ad.min_limit || 10),
      maxAmount: Number(ad.max_amount || ad.max_limit || 1000),
      paymentMethods: paymentMethods,
      offerLabel: ad.offer_label || '',
    };

    return NextResponse.json({
      ...formatted,
      ad: formatted,
    });
  } catch (err: any) {
    console.error('Error in /api/ads/[adId] GET:', err);
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
    const adId = (rawParams.adId || '').trim();
    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    // 1. Authenticate Requesting User
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user: any = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to manage your advertisement.' },
        { status: 401 }
      );
    }

    // 2. Resolve Target Advertisement
    const resolved = await findAdById(adId);
    const existingAd = resolved?.ad || null;
    const targetTable = resolved?.tableName || null;

    if (!existingAd || !targetTable) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check: Ensure authenticated user is the ad owner or an authorized administrator
    const adOwnerId = existingAd.user_id || existingAd.userId;
    const isOwner = adOwnerId && String(adOwnerId) === String(user.id);
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to delete this advertisement.' },
        { status: 403 }
      );
    }

    // 4. Perform Soft-Delete & Deletion on resolved target ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingAd.id || adId);
    const targetId = existingAd.id || adId;

    if (isUuid) {
      await admin.from('p2p_ads').update({ status: 'DELETED', active: false, updated_at: new Date().toISOString() }).eq('id', targetId);
      await admin.from('ads').update({ status: 'DELETED', is_active: false, updated_at: new Date().toISOString() }).eq('id', targetId);
      await admin.from('p2p_ads').delete().eq('id', targetId);
      await admin.from('ads').delete().eq('id', targetId);
    } else {
      await admin.from('p2p_ads').update({ status: 'DELETED', active: false, updated_at: new Date().toISOString() }).or(`public_ad_id.eq.${targetId},public_id.eq.${targetId}`);
      await admin.from('ads').update({ status: 'DELETED', is_active: false, updated_at: new Date().toISOString() }).or(`public_id.eq.${targetId},public_ad_id.eq.${targetId}`);
      await admin.from('p2p_ads').delete().or(`public_ad_id.eq.${targetId},public_id.eq.${targetId}`);
      await admin.from('ads').delete().or(`public_id.eq.${targetId},public_ad_id.eq.${targetId}`);
    }

    try {
      revalidatePath('/my-ads');
      revalidatePath('/buy');
      revalidatePath('/sell');
      revalidatePath(`/ad/${adId}`);
      revalidatePath(`/ads/${adId}`);
    } catch {}

    return NextResponse.json({ success: true, message: 'Ad deleted successfully.' });
  } catch (err: any) {
    console.error('Error in DELETE /api/ads/[adId]:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete ad' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = (rawParams.adId || '').trim();
    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    // 1. Authenticate Requesting User
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user: any = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to update advertisement status.' },
        { status: 401 }
      );
    }

    // 2. Resolve Target Advertisement
    const resolved = await findAdById(adId);
    const existingAd = resolved?.ad || null;
    const targetTable = resolved?.tableName || null;

    if (!existingAd || !targetTable) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check: Ensure authenticated user is the ad owner or an authorized administrator
    const adOwnerId = existingAd.user_id || existingAd.userId;
    const isOwner = adOwnerId && String(adOwnerId) === String(user.id);
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to modify this advertisement.' },
        { status: 403 }
      );
    }

    // 4. Parse & Strictly Validate Allowlisted Fields
    const body = await request.json();

    // Never trust client-supplied identity fields in PATCH body
    delete body.user_id;
    delete body.userId;
    delete body.owner_id;
    delete body.seller_id;
    delete body.creator_id;
    delete body.is_admin;
    delete body.admin;
    delete body.role;

    let isActive: boolean;
    let newStatus: string;

    if (body.active !== undefined) {
      isActive = Boolean(body.active);
      newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
    } else if (body.status !== undefined) {
      const requestedStatus = String(body.status).toUpperCase().trim();
      
      // Ordinary users can only set status to ACTIVE or INACTIVE
      if (!isAdmin && requestedStatus !== 'ACTIVE' && requestedStatus !== 'INACTIVE') {
        return NextResponse.json(
          { error: 'Forbidden: Ordinary users may only set advertisement status to ACTIVE or INACTIVE.' },
          { status: 403 }
        );
      }
      newStatus = requestedStatus;
      isActive = newStatus === 'ACTIVE';
    } else {
      return NextResponse.json(
        { error: 'Missing active or status field in PATCH request.' },
        { status: 400 }
      );
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingAd.id || adId);
    const targetId = existingAd.id || adId;

    if (isUuid) {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', targetId);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', targetId);
    } else {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .or(`public_ad_id.eq.${targetId},public_id.eq.${targetId}`);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .or(`public_id.eq.${targetId},public_ad_id.eq.${targetId}`);
    }

    try {
      revalidatePath('/my-ads');
      revalidatePath('/buy');
      revalidatePath('/sell');
      revalidatePath(`/ad/${adId}`);
      revalidatePath(`/ads/${adId}`);
    } catch {}

    return NextResponse.json({ success: true, status: newStatus, active: isActive });
  } catch (err: any) {
    console.error('Error in PATCH /api/ads/[adId]:', err);
    return NextResponse.json({ error: err.message || 'Failed to update ad' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = (rawParams.adId || '').trim();
    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    // 1. Authenticate Requesting User
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user: any = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    // 2. Resolve the Ad Record across tables (ads, p2p_ads, offers)
    const resolved = await findAdById(adId);
    const existingAd = resolved?.ad || null;
    const targetTable = resolved?.tableName || null;

    if (!existingAd || !targetTable) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check: Ensure authenticated user is the ad owner or authorized admin
    const adOwnerId = existingAd.user_id || existingAd.userId;
    const isOwner = adOwnerId && String(adOwnerId) === String(user?.id);
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;

    if (!user && !isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to edit your advertisement.' },
        { status: 401 }
      );
    }

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to edit this advertisement.' },
        { status: 403 }
      );
    }

    // 4. Parse & Sanitize Edit Payload
    const body = await request.json();

    // Strip client-controlled identity and administrative fields to prevent spoofing
    delete body.user_id;
    delete body.userId;
    delete body.owner_id;
    delete body.seller_id;
    delete body.creator_id;
    delete body.is_admin;
    delete body.admin;
    delete body.role;
    delete body.verification_status;
    delete body.is_verified;

    const price = body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : undefined;
    const unitPrice = body.unit_price !== undefined && body.unit_price !== null && body.unit_price !== '' ? Number(body.unit_price) : price;
    const minAmount = body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== '' 
      ? Number(body.min_amount) 
      : (body.min_limit !== undefined && body.min_limit !== null && body.min_limit !== '' ? Number(body.min_limit) : undefined);
    const maxAmount = body.max_amount !== undefined && body.max_amount !== null && body.max_amount !== '' 
      ? Number(body.max_amount) 
      : (body.max_limit !== undefined && body.max_limit !== null && body.max_limit !== '' ? Number(body.max_limit) : undefined);
    const margin = body.margin !== undefined && body.margin !== null && body.margin !== '' 
      ? Number(body.margin) 
      : (body.rate_percent !== undefined && body.rate_percent !== null && body.rate_percent !== '' ? Number(body.rate_percent) : undefined);

    if (price !== undefined && price <= 0) {
      return NextResponse.json({ error: 'Price must be greater than 0.' }, { status: 400 });
    }
    if (minAmount !== undefined && minAmount <= 0) {
      return NextResponse.json({ error: 'Minimum limit must be greater than 0.' }, { status: 400 });
    }
    if (minAmount !== undefined && maxAmount !== undefined && maxAmount < minAmount) {
      return NextResponse.json({ error: 'Maximum limit must be greater than or equal to minimum limit.' }, { status: 400 });
    }

    const paymentMethods = Array.isArray(body.payment_methods) 
      ? body.payment_methods 
      : (Array.isArray(body.paymentMethods) ? body.paymentMethods : undefined);
    const paymentWindow = body.payment_window ? Math.max(30, parseInt(String(body.payment_window), 10) || 30) : 30;

    const termsText = body.terms !== undefined 
      ? String(body.terms) 
      : (body.terms_conditions !== undefined ? String(body.terms_conditions) : undefined);
    const offerLabel = body.offer_label !== undefined 
      ? String(body.offer_label) 
      : (body.offerLabel !== undefined ? String(body.offerLabel) : undefined);
    const rawTags = Array.isArray(body.tags) 
      ? body.tags 
      : (Array.isArray(body.offer_tags) ? body.offer_tags : (Array.isArray(body.ad_tags) ? body.ad_tags : undefined));

    const isFixed = body.rate_type === 'fixed' || body.pricing_type === 'FIXED' || Boolean(body.is_fixed);
    const pricingType = isFixed ? 'FIXED' : 'FLOAT';
    const rateType = isFixed ? 'fixed' : 'market';

    const directionFromPayload = resolveTradeType(body);

    const timestamp = new Date().toISOString();

    const updatedAsset = body.asset || body.asset_symbol || body.crypto || body.crypto_symbol || body.coin;
    const updatedFiat = body.fiat || body.fiat_symbol || body.fiat_currency || body.fiatCurrency || body.currency;

    // Validate crypto asset if updated
    if (updatedAsset) {
      const normAsset = String(updatedAsset).toUpperCase().trim();
      if (!VALID_SUPPORTED_ASSETS.includes(normAsset)) {
        return NextResponse.json(
          { error: `Unsupported cryptocurrency '${normAsset}'. Supported assets are: ${VALID_SUPPORTED_ASSETS.join(', ')}.` },
          { status: 400 }
        );
      }
    }

    // Validate fiat currency if updated
    if (updatedFiat) {
      const normFiat = String(updatedFiat).toUpperCase().trim();
      const isValidFiat = FIAT_CURRENCIES.some(f => f.code.toUpperCase() === normFiat);
      if (!isValidFiat) {
        return NextResponse.json(
          { error: `Unsupported fiat currency '${normFiat}'.` },
          { status: 400 }
        );
      }
    }

    // 5. Build Table-Specific Payloads & Execute Exact Update on Resolved Primary ID
    let updatedRow: any = null;
    let updateError: any = null;

    if (targetTable === 'ads' || targetTable === 'offers') {
      const adsPayload: Record<string, any> = {
        updated_at: timestamp,
      };
      if (updatedAsset) {
        adsPayload.asset = String(updatedAsset).toUpperCase();
        adsPayload.asset_symbol = String(updatedAsset).toUpperCase();
      }
      if (updatedFiat) {
        adsPayload.fiat = String(updatedFiat).toUpperCase();
        adsPayload.fiat_symbol = String(updatedFiat).toUpperCase();
        adsPayload.fiat_currency = String(updatedFiat).toUpperCase();
      }
      if (price !== undefined) adsPayload.price = price;
      if (minAmount !== undefined) adsPayload.min_limit = minAmount;
      if (maxAmount !== undefined) {
        adsPayload.max_limit = maxAmount;
        adsPayload.total_amount = maxAmount;
      }
      if (paymentMethods !== undefined) adsPayload.payment_methods = paymentMethods;
      if (termsText !== undefined) adsPayload.terms = termsText;
      if (offerLabel !== undefined) {
        adsPayload.offer_label = offerLabel;
        adsPayload.label = offerLabel;
      }
      if (rawTags !== undefined) {
        adsPayload.tags = rawTags;
        adsPayload.ad_tags = rawTags;
      }
      if (directionFromPayload) {
        adsPayload.trade_type = directionFromPayload;
        adsPayload.type = directionFromPayload;
      }
      adsPayload.payment_window = paymentWindow;

      const { data, error } = await admin
        .from(targetTable)
        .update(adsPayload)
        .eq('id', existingAd.id)
        .select();

      if (error) {
        updateError = error;
      } else if (data && data.length > 0) {
        updatedRow = data[0];
      }
    } else if (targetTable === 'p2p_ads') {
      const p2pPayload: Record<string, any> = {
        updated_at: timestamp,
      };
      if (updatedAsset) {
        p2pPayload.asset = String(updatedAsset).toUpperCase();
        p2pPayload.asset_symbol = String(updatedAsset).toUpperCase();
        p2pPayload.crypto = String(updatedAsset).toUpperCase();
      }
      if (updatedFiat) {
        p2pPayload.fiat = String(updatedFiat).toUpperCase();
        p2pPayload.fiat_symbol = String(updatedFiat).toUpperCase();
        p2pPayload.fiat_currency = String(updatedFiat).toUpperCase();
      }
      if (price !== undefined) {
        p2pPayload.price = price;
        p2pPayload.unit_price = unitPrice ?? price;
        if (isFixed) p2pPayload.fixed_rate = price;
      }
      if (minAmount !== undefined) {
        p2pPayload.min_amount = minAmount;
        p2pPayload.min_limit = minAmount;
      }
      if (maxAmount !== undefined) {
        p2pPayload.max_amount = maxAmount;
        p2pPayload.max_limit = maxAmount;
        p2pPayload.available_amount = maxAmount;
      }
      if (margin !== undefined) {
        p2pPayload.rate_percent = margin;
        p2pPayload.price_margin = margin;
        p2pPayload.price_margin_percent = margin;
      }
      p2pPayload.pricing_type = pricingType;
      p2pPayload.rate_type = rateType;
      if (paymentMethods !== undefined) p2pPayload.payment_methods = paymentMethods;
      if (termsText !== undefined) p2pPayload.terms_conditions = termsText;
      if (offerLabel !== undefined) p2pPayload.offer_label = offerLabel;
      if (rawTags !== undefined) p2pPayload.offer_tags = rawTags;
      if (directionFromPayload) {
        p2pPayload.trade_type = directionFromPayload;
        p2pPayload.type = directionFromPayload;
      }
      if (body.require_full_name_verified !== undefined) p2pPayload.require_full_name_verified = Boolean(body.require_full_name_verified);
      if (body.require_verified_users !== undefined) p2pPayload.require_verified_users = Boolean(body.require_verified_users);
      if (body.min_completed_trades !== undefined) p2pPayload.min_completed_trades = parseInt(String(body.min_completed_trades), 10) || 0;
      p2pPayload.payment_window = paymentWindow;
      p2pPayload.payment_window_minutes = paymentWindow;
      p2pPayload.payment_time_limit = paymentWindow;

      const { data, error } = await admin
        .from('p2p_ads')
        .update(p2pPayload)
        .eq('id', existingAd.id)
        .select();

      if (error) {
        updateError = error;
      } else if (data && data.length > 0) {
        updatedRow = data[0];
      }
    }

    // 6. Verify Rows Affected
    if (updateError) {
      console.error('[PUT /api/ads/[adId]] Database update error:', updateError);
      return NextResponse.json(
        { error: updateError.message || 'Database error occurred while updating advertisement.' },
        { status: 400 }
      );
    }

    if (!updatedRow) {
      console.error('[PUT /api/ads/[adId]] Zero rows updated for ad:', existingAd.id);
      return NextResponse.json(
        { error: 'Update failed: no advertisement record was modified.' },
        { status: 500 }
      );
    }

    // 7. Invalidate Caches
    try {
      revalidatePath('/my-ads');
      revalidatePath('/buy');
      revalidatePath('/sell');
      revalidatePath(`/ad/${adId}`);
      revalidatePath(`/ads/${adId}`);
      revalidatePath(`/ads/edit/${adId}`);
      if (existingAd.id !== adId) {
        revalidatePath(`/ad/${existingAd.id}`);
        revalidatePath(`/ads/${existingAd.id}`);
      }
    } catch {}

    return NextResponse.json({ 
      success: true, 
      message: 'Ad updated successfully',
      data: updatedRow,
      updatedFields: {
        terms: termsText,
        payment_window: paymentWindow,
        offer_label: offerLabel,
        tags: rawTags,
        price: price,
        min_limit: minAmount,
        max_limit: maxAmount,
      }
    });
  } catch (err: any) {
    console.error('Error in PUT /api/ads/[adId]:', err);
    return NextResponse.json({ error: err.message || 'Failed to update ad' }, { status: 500 });
  }
}
