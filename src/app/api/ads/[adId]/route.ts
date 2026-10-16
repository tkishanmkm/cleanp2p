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
  if (!lastActive) return 'Unknown';
  const lastActiveMs = Date.parse(lastActive);
  if (!Number.isFinite(lastActiveMs) || lastActiveMs > Date.now()) return 'Unknown';
  const diffMinutes = Math.floor((Date.now() - lastActiveMs) / (1000 * 60));
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
    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const resolved = await findAdById(adId);
    let ad = resolved?.ad || null;

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Fetch user profile for presence and trader info using admin client
    const admin = getSupabaseAdminClient();
    let presence = 'Unknown';
    let profileData: any = null;
    const adOwnerUserId = ad.user_id || ad.userId || ad.seller_id || ad.creator_id || ad.user?.id;

    // Admin-backed lookup bypasses RLS, so do not expose inactive/deleted ads
    // publicly. Owners and authorized administrators may still retrieve them.
    const unavailableAd =
      ad.active === false ||
      ad.is_active === false ||
      ad.is_deleted === true ||
      ['INACTIVE', 'DELETED'].includes(String(ad.status || '').toUpperCase());
    if (unavailableAd) {
      const supabase = await createClient();
      const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
      let requester = null;
      if (bearerToken) {
        const tokenAuth = await supabase.auth.getUser(bearerToken);
        requester = tokenAuth.data?.user || null;
      }
      if (!requester) {
        const cookieAuth = await supabase.auth.getUser();
        requester = cookieAuth.data?.user || null;
      }
      const isOwner = Boolean(requester && adOwnerUserId && requester.id === String(adOwnerUserId));
      const adminAuth = await verifyServerAdmin(request);
      if (!isOwner && !adminAuth.authorized) {
        return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
      }
    }

    if (adOwnerUserId) {
      try {
        const { data: profile } = await admin
          .from('profiles')
          .select('id, username, avatar_url, photo_url, created_at, completed_trades, positive_feedback, negative_feedback, avg_release_time, avg_release_minutes, avg_pay_time, avg_payment_minutes, last_seen, last_seen_at')
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
    const rawMarginPercent = Number(ad.rate_percent ?? ad.margin_percent ?? ad.margin ?? 0);
    const marginPercent = Number.isFinite(rawMarginPercent) ? rawMarginPercent : 0;
    const rawAvailableAmount = Number(ad.available_amount ?? ad.total_amount ?? ad.max_amount);
    const availableAmount =
      Number.isFinite(rawAvailableAmount) && rawAvailableAmount >= 0 ? rawAvailableAmount : null;
    let paymentMethods: unknown[] = [];
    if (Array.isArray(ad.payment_methods)) {
      paymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsedPaymentMethods = JSON.parse(ad.payment_methods);
        if (Array.isArray(parsedPaymentMethods)) paymentMethods = parsedPaymentMethods;
      } catch {
        // Ignore malformed legacy metadata instead of failing the public ad read.
        paymentMethods = [];
      }
    }

    paymentMethods = paymentMethods
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item.length > 0 && item.length <= 80)
      .slice(0, 20);

    const rawTags = Array.isArray(ad.tags)
      ? ad.tags
      : Array.isArray(ad.offer_tags)
      ? ad.offer_tags
      : Array.isArray(ad.ad_tags)
      ? ad.ad_tags
      : [];
    const tags = [...new Set(
      rawTags
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((item: string) => item.trim())
        .filter((item: string) => item.length > 0 && item.length <= 80)
    )].slice(0, 50);

    const normalizeCountryList = (value: unknown): string[] =>
      Array.isArray(value)
        ? [...new Set(
            value
              .filter((item: unknown): item is string => typeof item === 'string')
              .map((item: string) => item.trim().toUpperCase())
              .filter((item: string) => item.length > 0 && item.length <= 80)
          )].slice(0, 50)
        : [];
    const targetedCountries = normalizeCountryList(ad.targeted_countries);
    const blockedCountries = normalizeCountryList(ad.blocked_countries);
    const rawPaymentWindow = Number(ad.payment_window ?? ad.payment_window_minutes ?? 30);
    const paymentWindow =
      Number.isSafeInteger(rawPaymentWindow) && rawPaymentWindow >= 30 && rawPaymentWindow <= 1440
        ? rawPaymentWindow
        : 30;
    const rawMinTrades = Number(ad.min_completed_trades ?? 0);
    const minTrades =
      Number.isSafeInteger(rawMinTrades) && rawMinTrades >= 0 && rawMinTrades <= 1000000
        ? rawMinTrades
        : 0;
    const requireFullName = ad.require_full_name_verified === true;
    const requireVerified = ad.require_verified_users === true;

    const firstNonEmptyString = (...values: unknown[]): string | null => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim().toUpperCase();
        }
      }
      return null;
    };
    const assetSym = firstNonEmptyString(
      ad.asset_symbol, ad.crypto_symbol, ad.crypto_currency, ad.crypto, ad.asset, ad.coin
    ) ?? 'USDT';

    const fiatSym = firstNonEmptyString(
      ad.fiat_symbol, ad.fiat_currency, ad.fiatCurrency, ad.fiat, ad.currency
    ) ?? 'USD';

    // Include the canonical trade_type field for rows that do not carry legacy type aliases.
    const rawAdType = firstNonEmptyString(ad.trade_type, ad.ad_type, ad.type);
    const adType = rawAdType === 'BUY' || rawAdType === 'SELL' ? rawAdType : 'SELL';
    const rawTerms = typeof ad.terms === 'string' ? ad.terms : '';
    const rawTermsConditions = typeof ad.terms_conditions === 'string' ? ad.terms_conditions : '';
    const terms = rawTerms.trim().slice(0, 5000);
    const termsConditions = (rawTermsConditions || rawTerms).trim().slice(0, 5000);
    const offerLabel = typeof ad.offer_label === 'string' ? ad.offer_label.trim().slice(0, 120) : '';
    const safeAd = { ...ad };
    for (const sensitiveKey of [
      'private_key', 'secret_key', 'mnemonic', 'seed_phrase', 'api_key',
      'access_token', 'refresh_token', 'password', 'service_role_key',
    ]) {
      delete safeAd[sensitiveKey];
    }

    const formatted = {
      ...safeAd,
      id: ad.id,
      userId: adOwnerUserId,
      type: adType,
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
      price: Number.isFinite(priceVal) && priceVal > 0 ? priceVal : null,
      pricing_type: (String(ad.rate_type ?? '').toUpperCase() === 'FIXED' || String(ad.pricing_type ?? '').toUpperCase() === 'FIXED' || ad.is_fixed === true) ? 'FIXED' : 'FLOAT',
      rate_type: (String(ad.rate_type ?? '').toUpperCase() === 'FIXED' || String(ad.pricing_type ?? '').toUpperCase() === 'FIXED' || ad.is_fixed === true) ? 'fixed' : 'market',
      is_fixed: Boolean(String(ad.rate_type ?? '').toUpperCase() === 'FIXED' || String(ad.pricing_type ?? '').toUpperCase() === 'FIXED' || ad.is_fixed === true),
      margin_percent: marginPercent,
      rate_percent: marginPercent,
      margin: marginPercent,
      status: (ad.active !== false && ad.is_active !== false && !['INACTIVE', 'DELETED'].includes(String(ad.status || '').toUpperCase()) && ad.is_deleted !== true) ? 'ACTIVE' : 'INACTIVE',
      min_limit: Number.isFinite(Number(ad.min_limit ?? ad.min_amount)) && Number(ad.min_limit ?? ad.min_amount) > 0 ? Number(ad.min_limit ?? ad.min_amount) : null,
      max_limit: Number.isFinite(Number(ad.max_limit ?? ad.max_amount)) && Number(ad.max_limit ?? ad.max_amount) > 0 ? Number(ad.max_limit ?? ad.max_amount) : null,
      min_amount: Number.isFinite(Number(ad.min_amount ?? ad.min_limit)) && Number(ad.min_amount ?? ad.min_limit) > 0 ? Number(ad.min_amount ?? ad.min_limit) : null,
      max_amount: Number.isFinite(Number(ad.max_amount ?? ad.max_limit)) && Number(ad.max_amount ?? ad.max_limit) > 0 ? Number(ad.max_amount ?? ad.max_limit) : null,
      available_amount: availableAmount,
      payment_methods: paymentMethods,
      offer_tags: tags,
      tags: tags,
      terms_conditions: termsConditions,
      terms: terms || termsConditions,
      offer_label: offerLabel,
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
      } : {
        id: adOwnerUserId,
        username: ad.user_display_name || 'Trader',
        completed_trades: 0,
        positive_feedback: 0,
        negative_feedback: 0,
      },
      // Legacy compatibility
      adType: adType.toLowerCase(),
      rateType: (String(ad.rate_type ?? '').toUpperCase() === 'FIXED' || String(ad.pricing_type ?? '').toUpperCase() === 'FIXED' || ad.is_fixed === true) ? 'fixed' : 'market',
      fixedRate: Number.isFinite(Number(ad.fixed_rate ?? ad.price)) &&
        Number(ad.fixed_rate ?? ad.price) > 0
          ? Number(ad.fixed_rate ?? ad.price)
          : null,
      ratePercent: marginPercent,
      minAmount: Number.isFinite(Number(ad.min_amount ?? ad.min_limit)) && Number(ad.min_amount ?? ad.min_limit) > 0 ? Number(ad.min_amount ?? ad.min_limit) : null,
      maxAmount: Number.isFinite(Number(ad.max_amount ?? ad.max_limit)) && Number(ad.max_amount ?? ad.max_limit) > 0 ? Number(ad.max_amount ?? ad.max_limit) : null,
      paymentMethods: paymentMethods,
      offerLabel,
    };

    return NextResponse.json({
      ...formatted,
      ad: formatted,
    });
  } catch (err: any) {
    console.error('Error in /api/ads/[adId] GET:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while retrieving the advertisement.' },
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

    // 3. Authorization Check: Ensure authenticated user is the ad owner or an authorized administrator.
    // Resolve admin status before checking ownership; never trust request body or ad metadata for admin privileges.
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;
    const adOwnerId = existingAd.user_id || existingAd.userId || existingAd.seller_id || existingAd.creator_id;
    const isOwner = Boolean(adOwnerId && String(adOwnerId) === String(user.id));

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
      const { data: p2pUpdated, error: p2pUpdateError } = await admin
        .from('p2p_ads')
        .update({ status: 'DELETED', active: false, updated_at: new Date().toISOString() })
        .eq('id', p2pAdsRow.id)
        .select('id, status');

      if (!p2pUpdateError && p2pUpdated && p2pUpdated.length > 0) {
        p2pMutated = true;
      } else {
        console.error('[DELETE /api/ads/[adId]] p2p_ads soft-delete failed:', p2pUpdateError?.message);
      }
    }

    if (adsRow) {
      const { data: adsUpdatedRows, error: adsUpdateError } = await admin
        .from('ads')
        .update({ status: 'DELETED', active: false, is_active: false, updated_at: new Date().toISOString() })
        .eq('id', adsRow.id)
        .select('id, status');

      if (!adsUpdateError && adsUpdatedRows && adsUpdatedRows.length > 0) {
        adsMutated = true;
      } else {
        console.warn('[DELETE /api/ads/[adId]] Legacy ads soft-delete failed:', adsUpdateError?.message);
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement record not found.' }, { status: 404 });
    }

    // At least one existing row must be successfully soft-deleted. If both
    // canonical and legacy rows exist, a partial mutation is reported as failure
    // so operators can reconcile the two records rather than claiming full success.
    const existingRowCount = Number(Boolean(p2pAdsRow)) + Number(Boolean(adsRow));
    const successfulMutationCount = Number(p2pMutated) + Number(adsMutated);
    const overallDeleteSuccess = successfulMutationCount > 0 && (
      existingRowCount === 1 || successfulMutationCount === existingRowCount
    );

    if (!overallDeleteSuccess) {
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
    return NextResponse.json({ error: 'An unexpected error occurred while deleting the advertisement.' }, { status: 500 });
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
    const adOwnerId = existingAd.user_id || existingAd.userId || existingAd.seller_id || existingAd.creator_id;
    const isOwner = Boolean(adOwnerId && String(adOwnerId) === String(user.id));
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to modify this advertisement.' },
        { status: 403 }
      );
    }

    // 4. Parse & Strictly Validate Allowlisted Fields
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

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

    if (body.active !== undefined && body.status !== undefined) {
      const normalizedStatus = String(body.status).toUpperCase().trim();
      const statusImpliesActive = normalizedStatus === 'ACTIVE';
      if (!['ACTIVE', 'INACTIVE', 'DELETED'].includes(normalizedStatus) ||
          body.active !== statusImpliesActive) {
        return NextResponse.json(
          { error: 'active and status fields must describe the same supported state.' },
          { status: 400 }
        );
      }
    }

    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'active must be a boolean.' }, { status: 400 });
      }
      isActive = body.active;
      newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
    } else if (body.status !== undefined) {
      if (typeof body.status !== 'string') {
        return NextResponse.json({ error: 'status must be a string.' }, { status: 400 });
      }
      const requestedStatus = body.status.toUpperCase().trim();
      if (!['ACTIVE', 'INACTIVE', 'DELETED'].includes(requestedStatus)) {
        return NextResponse.json({ error: 'Unsupported advertisement status.' }, { status: 400 });
      }
      
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

    const existingStatus = String(existingAd.status ?? '').toUpperCase();
    const isAlreadyDeleted =
      existingAd.is_deleted === true ||
      existingStatus === 'DELETED';
    if (isAlreadyDeleted && newStatus === 'ACTIVE') {
      return NextResponse.json(
        { error: 'Deleted advertisements cannot be reactivated. Create a new advertisement instead.' },
        { status: 409 }
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
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p2pAdsRow.id)
        .select('id');

      if (!p2pErr && p2pRes && p2pRes.length > 0) {
        p2pMutated = true;
      } else {
        console.error('[PATCH /api/ads/[adId]] Canonical p2p_ads update failed:', p2pErr?.message);
      }
    }

    if (adsRow) {
      try {
        const { data: adsRes, error: adsErr } = await admin
          .from('ads')
          .update({
            active: isActive,
            is_active: isActive,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', adsRow.id)
          .select('id');

        if (!adsErr && adsRes && adsRes.length > 0) {
          adsMutated = true;
        } else {
          console.warn('[PATCH /api/ads/[adId]] Legacy ads table mirror update warning:', adsErr?.message);
        }
      } catch (legacyErr: any) {
        console.warn('[PATCH /api/ads/[adId]] Legacy ads table update exception:', legacyErr?.message);
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // If both representations exist, require both writes to succeed so a partial
    // update cannot silently leave public status inconsistent across tables.
    const existingRowCount = Number(Boolean(p2pAdsRow)) + Number(Boolean(adsRow));
    const successfulUpdateCount = Number(p2pMutated) + Number(adsMutated);
    const overallSuccess = successfulUpdateCount > 0 && (
      existingRowCount === 1 || successfulUpdateCount === existingRowCount
    );

    if (!overallSuccess) {
      console.error('[PATCH /api/ads/[adId]] Failed canonical row status update:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
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
    return NextResponse.json({ error: 'An unexpected error occurred while updating advertisement status.' }, { status: 500 });
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

    // Verify authentication/administrator status before resolving an ad with the
    // privileged client, avoiding unauthenticated existence probing.
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized;
    if (!user && !isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to edit your advertisement.' },
        { status: 401 }
      );
    }

    // 2. Resolve the Ad Record across tables only after authentication.
    const resolved = await findAdById(adId);
    const existingAd = resolved?.ad || null;
    const targetTable = resolved?.tableName || null;

    if (!existingAd || !targetTable) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check: Ensure authenticated user is the ad owner or authorized admin
    const adOwnerId = existingAd.user_id || existingAd.userId;
    const isOwner = Boolean(user && adOwnerId && String(adOwnerId) === String(user.id));

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to edit this advertisement.' },
        { status: 403 }
      );
    }

    // 4. Parse & Sanitize Edit Payload
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

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

    const numericEditFields = [
      'price', 'unit_price', 'min_amount', 'min_limit',
      'max_amount', 'max_limit', 'margin', 'rate_percent',
    ];
    for (const field of numericEditFields) {
      const value = body[field];
      if (value !== undefined && value !== null && value !== '' &&
          typeof value !== 'number' && typeof value !== 'string') {
        return NextResponse.json({ error: `${field} must be a number.` }, { status: 400 });
      }
    }

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

    // Reject NaN and Infinity explicitly; comparisons with NaN are false and
    // would otherwise let malformed numeric strings pass validation.
    if (price !== undefined && (!Number.isFinite(price) || price <= 0)) {
      return NextResponse.json({ error: 'Price must be a finite number greater than 0.' }, { status: 400 });
    }
    if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
      return NextResponse.json({ error: 'Unit price must be a finite number greater than 0.' }, { status: 400 });
    }
    if (minAmount !== undefined && (!Number.isFinite(minAmount) || minAmount <= 0)) {
      return NextResponse.json({ error: 'Minimum limit must be a finite number greater than 0.' }, { status: 400 });
    }
    if (maxAmount !== undefined && (!Number.isFinite(maxAmount) || maxAmount <= 0)) {
      return NextResponse.json({ error: 'Maximum limit must be a finite number greater than 0.' }, { status: 400 });
    }
    const existingMinAmount = Number(existingAd.min_amount ?? existingAd.min_limit);
    const existingMaxAmount = Number(existingAd.max_amount ?? existingAd.max_limit ?? existingAd.available_amount);
    const effectiveMinAmount = minAmount ?? (Number.isFinite(existingMinAmount) && existingMinAmount > 0 ? existingMinAmount : undefined);
    const effectiveMaxAmount = maxAmount ?? (Number.isFinite(existingMaxAmount) && existingMaxAmount > 0 ? existingMaxAmount : undefined);
    if (effectiveMinAmount !== undefined && effectiveMaxAmount !== undefined && effectiveMaxAmount < effectiveMinAmount) {
      return NextResponse.json({ error: 'Maximum limit must be greater than or equal to minimum limit.' }, { status: 400 });
    }
    if (margin !== undefined && !Number.isFinite(margin)) {
      return NextResponse.json({ error: 'Margin must be a finite number.' }, { status: 400 });
    }

    const rawPaymentMethods = body.payment_methods ?? body.paymentMethods;
    if (rawPaymentMethods !== undefined && !Array.isArray(rawPaymentMethods)) {
      return NextResponse.json({ error: 'Payment methods must be provided as a list.' }, { status: 400 });
    }
    const paymentMethods = Array.isArray(rawPaymentMethods) ? rawPaymentMethods : undefined;
    const rawPaymentWindow = body.payment_window ?? body.payment_window_minutes ?? body.paymentWindow;
    const parsedPaymentWindow = rawPaymentWindow !== undefined && rawPaymentWindow !== null && rawPaymentWindow !== ''
      ? Number(rawPaymentWindow)
      : undefined;
    if (parsedPaymentWindow !== undefined && (!Number.isFinite(parsedPaymentWindow) || !Number.isInteger(parsedPaymentWindow) || parsedPaymentWindow < 30 || parsedPaymentWindow > 1440)) {
      return NextResponse.json({ error: 'Payment window must be a whole number between 30 and 1440 minutes.' }, { status: 400 });
    }
    const paymentWindow = parsedPaymentWindow;

    const termsText = body.terms !== undefined
      ? body.terms
      : (body.terms_conditions !== undefined ? body.terms_conditions : undefined);
    const offerLabel = body.offer_label !== undefined
      ? body.offer_label
      : (body.offerLabel !== undefined ? body.offerLabel : undefined);
    const rawTagsValue = body.tags ?? body.offer_tags ?? body.ad_tags;
    if (rawTagsValue !== undefined && !Array.isArray(rawTagsValue)) {
      return NextResponse.json({ error: 'Advertisement tags must be provided as a list.' }, { status: 400 });
    }
    const rawTags = Array.isArray(rawTagsValue) ? rawTagsValue : undefined;

    // Bound user-controlled ad metadata before writing it to the database.
    if (paymentMethods !== undefined && (paymentMethods.length > 20 || paymentMethods.some((method: unknown) => typeof method !== 'string' || method.trim().length === 0 || method.length > 80))) {
      return NextResponse.json({ error: 'Provide at most 20 valid payment methods, each no longer than 80 characters.' }, { status: 400 });
    }
    if (termsText !== undefined && termsText !== null &&
        (typeof termsText !== 'string' || termsText.length > 10000)) {
      return NextResponse.json({ error: 'Advertisement terms must be text of 10,000 characters or fewer.' }, { status: 400 });
    }
    if (offerLabel !== undefined && offerLabel !== null &&
        (typeof offerLabel !== 'string' || offerLabel.length > 120)) {
      return NextResponse.json({ error: 'Advertisement label must be text of 120 characters or fewer.' }, { status: 400 });
    }
    if (rawTags !== undefined && (rawTags.length > 30 || rawTags.some((tag: unknown) => typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 50))) {
      return NextResponse.json({ error: 'Provide at most 30 valid tags, each no longer than 50 characters.' }, { status: 400 });
    }

    const pricingModeWasProvided = body.rate_type !== undefined || body.pricing_type !== undefined || body.is_fixed !== undefined;
    const existingIsFixed = String(existingAd.rate_type || '').toLowerCase() === 'fixed'
      || String(existingAd.pricing_type || '').toUpperCase() === 'FIXED'
      || existingAd.is_fixed === true;
    if (body.require_full_name_verified !== undefined && typeof body.require_full_name_verified !== 'boolean') {
      return NextResponse.json({ error: 'require_full_name_verified must be a boolean.' }, { status: 400 });
    }
    if (body.require_verified_users !== undefined && typeof body.require_verified_users !== 'boolean') {
      return NextResponse.json({ error: 'require_verified_users must be a boolean.' }, { status: 400 });
    }
    let minCompletedTrades: number | undefined;
    if (body.min_completed_trades !== undefined) {
      minCompletedTrades = Number(body.min_completed_trades);
      if (!Number.isSafeInteger(minCompletedTrades) || minCompletedTrades < 0 || minCompletedTrades > 1000000) {
        return NextResponse.json({ error: 'min_completed_trades must be a whole number between 0 and 1,000,000.' }, { status: 400 });
      }
    }

    const validRateTypes = ['fixed', 'market', 'float', 'floating'];
    const validPricingTypes = ['FIXED', 'FLOAT', 'MARKET', 'DYNAMIC'];
    if (body.rate_type !== undefined && !validRateTypes.includes(String(body.rate_type).toLowerCase())) {
      return NextResponse.json({ error: 'Unsupported rate_type.' }, { status: 400 });
    }
    if (body.pricing_type !== undefined && !validPricingTypes.includes(String(body.pricing_type).toUpperCase())) {
      return NextResponse.json({ error: 'Unsupported pricing_type.' }, { status: 400 });
    }
    if (body.is_fixed !== undefined && typeof body.is_fixed !== 'boolean') {
      return NextResponse.json({ error: 'is_fixed must be a boolean.' }, { status: 400 });
    }

    const isFixed = pricingModeWasProvided
      ? (body.rate_type !== undefined
          ? String(body.rate_type).toLowerCase() === 'fixed'
          : body.pricing_type !== undefined
            ? String(body.pricing_type).toUpperCase() === 'FIXED'
            : body.is_fixed === true)
      : existingIsFixed;
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
      if (!Number.isFinite(effectiveEditPrice) || effectiveEditPrice <= 0) {
        return NextResponse.json({ error: 'Valid fixed price is required for fixed-rate ads.' }, { status: 400 });
      }

      const { data: marketRow, error: marketError } = await admin
        .from('crypto_market_prices')
        .select('price_in_fiat, updated_at')
        .eq('asset_symbol', effectiveAsset)
        .eq('fiat_symbol', effectiveFiat)
        .maybeSingle();

      const refPrice = Number(marketRow?.price_in_fiat);
      if (marketError || !marketRow || !Number.isFinite(refPrice) || refPrice <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${effectiveAsset}/${effectiveFiat}. Please try again later.` },
          { status: 400 }
        );
      }
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
      if (body.require_full_name_verified !== undefined) p2pPayload.require_full_name_verified = body.require_full_name_verified;
      if (body.require_verified_users !== undefined) p2pPayload.require_verified_users = body.require_verified_users;
      if (minCompletedTrades !== undefined) p2pPayload.min_completed_trades = minCompletedTrades;
      if (paymentWindow !== undefined) {
        p2pPayload.payment_window = paymentWindow;
        p2pPayload.payment_window_minutes = paymentWindow;
        p2pPayload.payment_time_limit = paymentWindow;
      }

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
        if (paymentWindow !== undefined) adsPayload.payment_window = paymentWindow;

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

    // If both representations exist, require both writes to succeed. A partial
    // update leaves divergent ad records and must be surfaced for reconciliation.
    const existingRowCount = Number(Boolean(p2pAdsRow)) + Number(Boolean(adsRow));
    const successfulUpdateCount = Number(p2pUpdated) + Number(adsUpdated);
    const overallSuccess = successfulUpdateCount > 0 && (
      existingRowCount === 1 || successfulUpdateCount === existingRowCount
    );

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
        ...(paymentWindow !== undefined ? { payment_window: paymentWindow } : {}),
        offer_label: offerLabel,
        tags: rawTags,
        price: price,
        min_limit: minAmount,
        max_limit: maxAmount,
      }
    });
  } catch (err: any) {
    console.error('Error in PUT /api/ads/[adId]:', err);
    return NextResponse.json({ error: 'An unexpected error occurred while editing the advertisement.' }, { status: 500 });
  }
}
