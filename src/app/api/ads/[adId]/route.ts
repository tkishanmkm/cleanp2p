import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { findAdById, resolveBothTargetRows } from '@/lib/ad-lookup';
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

    // 4. Perform Soft-Delete & Deletion on independently resolved target IDs
    const { p2pAdsRow, adsRow } = await resolveBothTargetRows(existingAd, adId, admin);

    let p2pMutated = false;
    let adsMutated = false;

    if (p2pAdsRow) {
      await admin
        .from('p2p_ads')
        .update({ status: 'DELETED', active: false, is_active: false, updated_at: new Date().toISOString() })
        .eq('id', p2pAdsRow.id);

      const { data: p2pDel, error: p2pErr } = await admin
        .from('p2p_ads')
        .delete()
        .eq('id', p2pAdsRow.id)
        .select('id');

      if (!p2pErr && p2pDel && p2pDel.length > 0) {
        p2pMutated = true;
      } else {
        const { data: p2pCheck } = await admin
          .from('p2p_ads')
          .select('status')
          .eq('id', p2pAdsRow.id)
          .maybeSingle();
        if (p2pCheck && p2pCheck.status === 'DELETED') {
          p2pMutated = true;
        }
      }
    }

    if (adsRow) {
      await admin
        .from('ads')
        .update({ status: 'DELETED', is_active: false, updated_at: new Date().toISOString() })
        .eq('id', adsRow.id);

      const { data: adsDel, error: adsErr } = await admin
        .from('ads')
        .delete()
        .eq('id', adsRow.id)
        .select('id');

      if (!adsErr && adsDel && adsDel.length > 0) {
        adsMutated = true;
      } else {
        const { data: adsCheck } = await admin
          .from('ads')
          .select('status')
          .eq('id', adsRow.id)
          .maybeSingle();
        if (adsCheck && adsCheck.status === 'DELETED') {
          adsMutated = true;
        }
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement record not found.' }, { status: 404 });
    }

    if ((p2pAdsRow && !p2pMutated) || (adsRow && !adsMutated)) {
      console.error('[DELETE /api/ads/[adId]] Failed row mutation:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
      return NextResponse.json({ error: 'Failed to delete advertisement record.' }, { status: 500 });
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

    // 5. Independently resolve both target rows
    const { p2pAdsRow, adsRow } = await resolveBothTargetRows(existingAd, adId, admin);

    let p2pMutated = false;
    let adsMutated = false;

    if (p2pAdsRow) {
      const { data: p2pRes, error: p2pErr } = await admin
        .from('p2p_ads')
        .update({
          active: isActive,
          is_active: isActive,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p2pAdsRow.id)
        .select('id');

      if (!p2pErr && p2pRes && p2pRes.length > 0) {
        p2pMutated = true;
      }
    }

    if (adsRow) {
      const { data: adsRes, error: adsErr } = await admin
        .from('ads')
        .update({
          is_active: isActive,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', adsRow.id)
        .select('id');

      if (!adsErr && adsRes && adsRes.length > 0) {
        adsMutated = true;
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    if ((p2pAdsRow && !p2pMutated) || (adsRow && !adsMutated)) {
      console.error('[PATCH /api/ads/[adId]] Failed row status update:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
      return NextResponse.json({ error: 'Failed to update advertisement status.' }, { status: 500 });
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

    // Authoritative Server-Side ±50% Reference Market Price Validation for Edited Ads
    const effectiveAsset = String(updatedAsset || existingAd.asset_symbol || existingAd.asset || existingAd.crypto || 'USDT').toUpperCase().trim();
    const effectiveFiat = String(updatedFiat || existingAd.fiat_symbol || existingAd.fiat_currency || existingAd.fiat || 'USD').toUpperCase().trim();

    if (isFixed) {
      const effectiveEditPrice = price !== undefined ? price : Number(existingAd.price ?? existingAd.unit_price ?? 0);
      if (effectiveEditPrice <= 0) {
        return NextResponse.json({ error: 'Valid fixed price is required for fixed-rate ads.' }, { status: 400 });
      }

      const { data: marketRow, error: marketError } = await admin
        .from('crypto_market_prices')
        .select('price_in_fiat, updated_at')
        .eq('asset_symbol', effectiveAsset)
        .eq('fiat_symbol', effectiveFiat)
        .maybeSingle();

      if (marketError || !marketRow || !marketRow.price_in_fiat || Number(marketRow.price_in_fiat) <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${effectiveAsset}/${effectiveFiat}. Please try again later.` },
          { status: 400 }
        );
      }

      const refPrice = Number(marketRow.price_in_fiat);
      const minAllowedPrice = refPrice * 0.50;
      const maxAllowedPrice = refPrice * 1.50;

      if (effectiveEditPrice < minAllowedPrice || effectiveEditPrice > maxAllowedPrice) {
        return NextResponse.json(
          {
            error: `Fixed price must be within ±50% of the reference market price (${minAllowedPrice.toFixed(2)} - ${maxAllowedPrice.toFixed(2)} ${effectiveFiat}).`,
          },
          { status: 400 }
        );
      }
    } else if (margin !== undefined) {
      if (margin < -50 || margin > 50) {
        return NextResponse.json(
          { error: 'Margin percentage for dynamic pricing must be between -50% and +50%.' },
          { status: 400 }
        );
      }
    }

    // 5. Build Table-Specific Payloads & Execute Update on Target Rows
    const { p2pAdsRow, adsRow } = await resolveBothTargetRows(existingAd, adId, admin);

    let p2pUpdated = false;
    let adsUpdated = false;
    let lastUpdatedRow: any = null;

    // 5a. Update Canonical p2p_ads Table (Authoritative)
    if (p2pAdsRow) {
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
        .eq('id', p2pAdsRow.id)
        .select();

      if (!error && data && data.length > 0) {
        p2pUpdated = true;
        lastUpdatedRow = data[0];
      } else if (error) {
        console.error('[PUT /api/ads/[adId]] Canonical p2p_ads update error:', error);
      }
    }

    // 5b. Update Legacy ads Table Mirror (Strictly limited to supported columns)
    if (adsRow) {
      try {
        const adsPayload: Record<string, any> = {
          updated_at: timestamp,
        };
        if (price !== undefined) adsPayload.price = price;
        if (minAmount !== undefined) adsPayload.min_limit = minAmount;
        if (maxAmount !== undefined) adsPayload.max_limit = maxAmount;
        if (paymentMethods !== undefined) adsPayload.payment_methods = paymentMethods;
        if (termsText !== undefined) adsPayload.terms = termsText;
        if (directionFromPayload) adsPayload.type = directionFromPayload;
        adsPayload.payment_window = paymentWindow;

        const { data, error } = await admin
          .from('ads')
          .update(adsPayload)
          .eq('id', adsRow.id)
          .select('id');

        if (!error && data && data.length > 0) {
          adsUpdated = true;
          if (!lastUpdatedRow) lastUpdatedRow = data[0];
        } else if (error) {
          console.warn('[PUT /api/ads/[adId]] Legacy ads mirror update warning (ignored for canonical result):', error.message);
        }
      } catch (legacyErr: any) {
        console.warn('[PUT /api/ads/[adId]] Legacy ads update exception (ignored for canonical result):', legacyErr?.message);
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Authoritative Success Check:
    // If canonical p2p_ads row exists, canonical update MUST succeed.
    // If only legacy ads row exists, legacy update MUST succeed.
    const overallSuccess = p2pAdsRow ? p2pUpdated : adsUpdated;

    if (!overallSuccess) {
      console.error('[PUT /api/ads/[adId]] Canonical advertisement record update failed:', {
        p2pAdsRowId: p2pAdsRow?.id,
        p2pUpdated,
        adsRowId: adsRow?.id,
        adsUpdated,
      });
      return NextResponse.json(
        { error: 'Update failed: no advertisement record was modified.' },
        { status: 500 }
      );
    }

    const updatedRow = lastUpdatedRow;

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
