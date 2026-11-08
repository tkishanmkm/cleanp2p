import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { findAdById } from '@/lib/ad-lookup';
import { setAdStatusAtomically } from '@/lib/ad-status';
import { updateAdContentAtomically } from '@/lib/ad-content';
import { checkNewTradeEligibility } from '@/lib/account-action-guard';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

// GET: Fetch public ad details with the seller's approved public trader profile.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const id = (resolvedParams.id || '').trim();

    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Fetch ad by id, public_ad_id, public_id, or ad_id using universal resolver
    const resolved = await findAdById(id);
    const ad = resolved?.ad || null;

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found' }, { status: 404 });
    }

    const adStatus = String(ad.status || '').trim().toUpperCase();
    const isPubliclyActive =
      ad.active === true &&
      ad.is_active === true &&
      ad.is_deleted !== true &&
      adStatus === 'ACTIVE';

    if (!isPubliclyActive) {
      const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
      const viewerClient = bearerToken ? createBearerClient(bearerToken) : await createClient();
      let viewer: any = null;
      if (bearerToken) {
        const tokenAuth = await viewerClient.auth.getUser(bearerToken);
        viewer = tokenAuth.data?.user || null;
      }
      if (!viewer) {
        const cookieAuth = await viewerClient.auth.getUser();
        viewer = cookieAuth.data?.user || null;
      }
      const isOwner = Boolean(viewer?.id && viewer.id === (ad.user_id || ad.userId));
      const adminAuth = await verifyServerAdmin(request);
      if (!isOwner && !adminAuth.authorized) {
        return NextResponse.json({ error: 'Advertisement not found' }, { status: 404 });
      }
    }

    const creatorId = ad.user_id || ad.userId;
    let creatorProfile: any = null;

    if (creatorId) {
      const { data: prof } = await supabaseAdmin
        .from('public_profiles')
        .select('id, username, display_name, avatar_url, photo_url, country, feedback_score, positive_feedback, negative_feedback, completed_trades, total_completed_trades, avg_release_time_mins, avg_release_minutes, avg_release_time, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, created_at, is_verified, merchant_tier, is_online')
        .eq('id', creatorId)
        .maybeSingle();
      if (prof) {
        creatorProfile = prof;
      }
    }

    // Fallback: If not found by id, try matching by username/display name
    if (!creatorProfile && ad.user_display_name) {
      const { data: prof } = await supabaseAdmin
        .from('public_profiles')
        .select('id, username, display_name, avatar_url, photo_url, country, feedback_score, positive_feedback, negative_feedback, completed_trades, total_completed_trades, avg_release_time_mins, avg_release_minutes, avg_release_time, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, created_at, is_verified, merchant_tier, is_online')
        .ilike('username', ad.user_display_name)
        .maybeSingle();
      if (prof) {
        creatorProfile = prof;
      }
    }

    // Trader wallet balances are private financial data. Public ad limits come
    // from the persisted advertisement and are enforced again by the escrow RPC.

    // STRICT USERNAME ENFORCEMENT: lowercase letters, numbers, dot, underscore only
    const username = creatorProfile?.username || ad.user_display_name || 'trader';
    const isOnline = creatorProfile?.is_online === true;

    return NextResponse.json({
      ad: {
        ...ad,
        user: {
          id: creatorId,
          username,
          avatar_url: creatorProfile?.avatar_url || creatorProfile?.photo_url || null,
          photo_url: creatorProfile?.avatar_url || creatorProfile?.photo_url || null,
          created_at: creatorProfile?.created_at || ad.created_at,
          is_online: isOnline,
          // Exact presence timestamps are private and excluded from public trader APIs.
          last_seen_at: null,
          last_active: null,
          completed_trades: creatorProfile?.completed_trades ?? 0,
          positive_feedback: creatorProfile?.positive_feedback ?? 0,
          negative_feedback: creatorProfile?.negative_feedback ?? 0,
          avg_release_time: creatorProfile?.avg_release_time || null,
          avg_release_minutes: creatorProfile?.avg_release_minutes || null,
          avg_pay_time: creatorProfile?.avg_pay_time || null,
          avg_payment_minutes: creatorProfile?.avg_payment_minutes || null,
        },

      },
    });
  } catch (err: any) {
    console.error('Error in GET /api/p2p/ads/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Edit ad details or toggle status (ACTIVE / OFFLINE)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    // Use a verified request cookie session or an explicitly supplied bearer token.
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const supabase = bearerToken ? createBearerClient(bearerToken) : await createClient();

    let user = null;
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const { assertUserNotEmergencyFrozen } = await import('@/lib/user-freeze');
      await assertUserNotEmergencyFrozen(user.id);
    } catch (freezeErr: any) {
      return NextResponse.json(
        { error: freezeErr.message || 'Your account is under an emergency security freeze.', code: 'USER_EMERGENCY_FROZEN' },
        { status: 403 }
      );
    }

    // Resolve ad across ads / p2p_ads using universal resolver
    const resolved = await findAdById(id);
    const existingAd = resolved?.ad || null;

    if (!existingAd) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const adOwnerId = existingAd.user_id || existingAd.userId || existingAd.seller_id || existingAd.creator_id;
    if (!adOwnerId) {
      return NextResponse.json(
        { error: 'Advertisement owner could not be verified.', code: 'AD_OWNER_UNRESOLVED' },
        { status: 409 }
      );
    }
    if (String(adOwnerId) !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden. You do not own this advertisement.' }, { status: 403 });
    }

    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'A valid advertisement update object is required.' }, { status: 400 });
    }

    // Sanitize payload data types
    const body: Record<string, any> = { ...rawBody };
    delete body.user_id;
    delete body.userId;

    if (body.price !== undefined && body.price !== null && body.price !== '') body.price = Number(body.price);
    if (body.margin !== undefined && body.margin !== null && body.margin !== '') {
      body.rate_percent = Number(body.margin);
      body.price_margin = Number(body.margin);
      delete body.margin;
    }
    if (body.rate_percent !== undefined && body.rate_percent !== null && body.rate_percent !== '') {
      body.rate_percent = Number(body.rate_percent);
    }
    if (body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== '') body.min_amount = Number(body.min_amount);
    if (body.max_amount !== undefined && body.max_amount !== null && body.max_amount !== '') body.max_amount = Number(body.max_amount);
    if (body.min_limit !== undefined && body.min_limit !== null && body.min_limit !== '') body.min_limit = Number(body.min_limit);
    if (body.max_limit !== undefined && body.max_limit !== null && body.max_limit !== '') body.max_limit = Number(body.max_limit);

    const supabaseAdmin = getSupabaseAdminClient();

    const hasStatus = body.status !== undefined || body.active !== undefined || body.is_active !== undefined;
    let newStatus: string | undefined;
    let isActive: boolean | undefined;

    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'The active field must be a boolean.' }, { status: 400 });
    }
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      return NextResponse.json({ error: 'The is_active field must be a boolean.' }, { status: 400 });
    }
    if (body.active !== undefined && body.is_active !== undefined && body.active !== body.is_active) {
      return NextResponse.json({ error: 'Conflicting advertisement status fields were supplied.' }, { status: 400 });
    }
    if (body.status !== undefined && (body.active !== undefined || body.is_active !== undefined)) {
      const statusValue = typeof body.status === 'string' ? body.status.toUpperCase().trim() : '';
      const statusActive = statusValue === 'ACTIVE';
      if (!['ACTIVE', 'INACTIVE'].includes(statusValue) ||
          statusActive !== (body.active ?? body.is_active)) {
        return NextResponse.json({ error: 'The status and active fields conflict or contain an unsupported value.' }, { status: 400 });
      }
    }

    if (hasStatus) {
      if (body.active !== undefined || body.is_active !== undefined) {
        isActive = body.active ?? body.is_active;
        newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
      } else if (typeof body.status === 'string') {
        newStatus = body.status.toUpperCase().trim();
        isActive = newStatus === 'ACTIVE';
      } else {
        return NextResponse.json({ error: 'A valid advertisement status is required.' }, { status: 400 });
      }
    }

    const existingDirection = String(existingAd.trade_type || existingAd.ad_type || existingAd.type || '').toUpperCase();
    const requestedDirection = [body.trade_type, body.ad_type, body.type, body.side, body.direction]
      .find((value) => typeof value === 'string' && value.trim())?.trim().toUpperCase();
    const hasNonStatusEdits = Object.keys(body).some(
      (key) => !['status', 'active', 'is_active'].includes(key)
    );

    if (hasStatus && hasNonStatusEdits) {
      const currentStatus = String(
        existingAd.status || (existingAd.active === true && existingAd.is_active !== false ? 'ACTIVE' : 'INACTIVE')
      ).toUpperCase().trim();
      const currentIsActive =
        existingAd.active === true &&
        existingAd.is_active !== false &&
        !['DELETED', 'PAUSED', 'HIDDEN', 'DRAFT', 'INACTIVE'].includes(currentStatus);
      const statusIsUnchanged =
        body.active !== undefined || body.is_active !== undefined
          ? isActive === currentIsActive
          : newStatus === currentStatus;

      // The edit form sends its current active flag with other listing fields.
      // Ignore that unchanged flag, but never mix a real status transition with
      // separate non-transactional listing edits.
      if (!statusIsUnchanged) {
        return NextResponse.json(
          { error: 'Change advertisement status separately before editing its other details.', code: 'SEPARATE_AD_STATUS_CHANGE_REQUIRED' },
          { status: 409 }
        );
      }

      delete body.status;
      delete body.active;
      delete body.is_active;
      newStatus = undefined;
      isActive = undefined;
    } else if (hasStatus) {
      if (!['ACTIVE', 'INACTIVE'].includes(newStatus || '')) {
        return NextResponse.json({ error: 'Advertisement owners may only activate or deactivate their own listings.' }, { status: 403 });
      }

      if (isActive === true && existingDirection === 'SELL') {
        return NextResponse.json(
          {
            success: false,
            error: 'SELL advertisements cannot be activated until their crypto inventory is reserved atomically.',
            code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
          },
          { status: 503 }
        );
      }

      if (isActive === true) {
        const eligibility = await checkNewTradeEligibility(user.id);
        if (!eligibility.allowed) {
          return NextResponse.json({ error: "Restricted accounts cannot activate advertisements.", code: eligibility.code }, { status: eligibility.statusCode });
        }
      }

      const statusUpdate = await setAdStatusAtomically(
        supabaseAdmin,
        existingAd,
        id,
        { id: user.id, email: user.email, isAdmin: false },
        newStatus as 'ACTIVE' | 'INACTIVE'
      );

      if (!statusUpdate.ok) {
        return NextResponse.json(
          { success: false, code: statusUpdate.code, error: statusUpdate.error },
          { status: statusUpdate.statusCode }
        );
      }

      return NextResponse.json({
        success: true,
        data: { ...existingAd, status: statusUpdate.status, active: statusUpdate.status === 'ACTIVE', is_active: statusUpdate.status === 'ACTIVE' },
      });
    }

    if (
      requestedDirection === 'SELL' ||
      (existingDirection === 'SELL' && hasNonStatusEdits)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'SELL advertisements cannot be activated, edited or converted until atomic crypto inventory reservation is enabled.',
          code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
        },
        { status: 503 }
      );
    }

    const contentPatch: Record<string, unknown> = {};

    if (body.price !== undefined) {
      if (!Number.isFinite(body.price) || body.price <= 0 || body.price >= 1e18) {
        return NextResponse.json({ error: 'Price must be a finite positive number below 1e18.' }, { status: 400 });
      }
      contentPatch.price = body.price;
    }
    const minLimit = body.min_limit ?? body.min_amount;
    const maxLimit = body.max_limit ?? body.max_amount;
    if (minLimit !== undefined) {
      if (!Number.isFinite(minLimit) || minLimit <= 0 || minLimit >= 1e18) {
        return NextResponse.json({ error: 'Minimum trade limit must be positive and below 1e18.' }, { status: 400 });
      }
      contentPatch.min_limit = minLimit;
    }
    if (maxLimit !== undefined) {
      if (!Number.isFinite(maxLimit) || maxLimit <= 0 || maxLimit >= 1e18) {
        return NextResponse.json({ error: 'Maximum trade limit must be positive and below 1e18.' }, { status: 400 });
      }
      contentPatch.max_limit = maxLimit;
    }
    if (minLimit !== undefined || maxLimit !== undefined) {
      const effectiveMin = minLimit ?? Number(existingAd.min_limit ?? existingAd.min_amount ?? 10);
      const effectiveMax = maxLimit ?? Number(existingAd.max_limit ?? existingAd.max_amount ?? 1000);
      if (!Number.isFinite(effectiveMin) || !Number.isFinite(effectiveMax) || effectiveMin <= 0 || effectiveMax < effectiveMin) {
        return NextResponse.json({ error: 'Maximum trade limit must be greater than or equal to minimum trade limit.' }, { status: 400 });
      }
    }

    if (body.rate_percent !== undefined) {
      if (!Number.isFinite(body.rate_percent) || body.rate_percent < -50 || body.rate_percent > 50) {
        return NextResponse.json({ error: 'Pricing margin must be between -50% and +50%.' }, { status: 400 });
      }
      contentPatch.margin = body.rate_percent;
    }
    const pricingInput = body.pricing_type ?? body.rate_type;
    if (pricingInput !== undefined) {
      const normalizedPricing = String(pricingInput).toUpperCase().trim();
      const mappedPricing = normalizedPricing === 'FIXED' ? 'FIXED'
        : (normalizedPricing === 'FLOAT' || normalizedPricing === 'MARKET' ? 'FLOAT' : null);
      if (!mappedPricing) {
        return NextResponse.json({ error: 'Pricing type must be FIXED or FLOAT.' }, { status: 400 });
      }
      contentPatch.pricing_type = mappedPricing;
    }

    const currentPricingType = existingAd.pricing_type !== undefined && existingAd.pricing_type !== null
      ? (String(existingAd.pricing_type).toUpperCase() === 'FIXED' ? 'FIXED' : 'FLOAT')
      : (String(existingAd.rate_type || '').toLowerCase() === 'fixed' || existingAd.is_fixed === true
        ? 'FIXED'
        : 'FLOAT');
    const nextPricingType = (contentPatch.pricing_type as string | undefined) || currentPricingType;
    const currentPrice = Number(existingAd.price ?? existingAd.unit_price ?? existingAd.fixed_rate ?? 0);
    const nextPrice = body.price !== undefined ? body.price : currentPrice;
    const fixedPricingChanged = nextPricingType === 'FIXED' &&
      (currentPricingType !== 'FIXED' || Math.abs(nextPrice - currentPrice) > 1e-8);
    if (fixedPricingChanged) {
      if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
        return NextResponse.json({ error: 'A valid fixed price is required.' }, { status: 400 });
      }
      const asset = String(existingAd.asset_symbol || existingAd.crypto_currency || existingAd.coin || 'USDT').toUpperCase();
      const fiat = String(existingAd.fiat_symbol || existingAd.fiat_currency || 'USD').toUpperCase();
      const { data: marketRow, error: marketError } = await supabaseAdmin
        .from('crypto_market_prices')
        .select('price_in_fiat')
        .eq('asset_symbol', asset)
        .eq('fiat_symbol', fiat)
        .maybeSingle();
      if (marketError || !marketRow || !Number.isFinite(Number(marketRow.price_in_fiat)) || Number(marketRow.price_in_fiat) <= 0) {
        return NextResponse.json(
          { error: `Market reference price is unavailable for ${asset}/${fiat}.`, code: 'MARKET_PRICE_UNAVAILABLE' },
          { status: 503 }
        );
      }
      const referencePrice = Number(marketRow.price_in_fiat);
      if (nextPrice < referencePrice * 0.5 || nextPrice > referencePrice * 1.5) {
        return NextResponse.json(
          { error: `Fixed price must be within ±50% of the reference market price (${(referencePrice * 0.5).toFixed(2)} - ${(referencePrice * 1.5).toFixed(2)} ${fiat}).` },
          { status: 400 }
        );
      }
    }

    const rawMethods = body.payment_methods ?? body.paymentMethods;
    if (rawMethods !== undefined) {
      const methodValues = Array.isArray(rawMethods) ? rawMethods : (typeof rawMethods === 'string' ? [rawMethods] : null);
      if (!methodValues || methodValues.length < 1 || methodValues.length > 20 ||
          methodValues.some((method: unknown) => typeof method !== 'string' || !method.trim() || method.trim().length > 80)) {
        return NextResponse.json({ error: 'Provide between 1 and 20 valid payment methods.' }, { status: 400 });
      }
      contentPatch.payment_methods = Array.from(new Set(methodValues.map((method: string) => method.trim())));
    }

    if (body.terms_conditions !== undefined || body.terms !== undefined) {
      const termsValue = body.terms_conditions !== undefined ? body.terms_conditions : body.terms;
      if (typeof termsValue !== 'string' || termsValue.length > 2000) {
        return NextResponse.json({ error: 'Advertisement terms must be text of at most 2000 characters.' }, { status: 400 });
      }
      contentPatch.terms = termsValue;
    }
    if (body.offer_label !== undefined || body.label !== undefined) {
      const labelValue = body.offer_label !== undefined ? body.offer_label : body.label;
      if (typeof labelValue !== 'string' || labelValue.length > 120) {
        return NextResponse.json({ error: 'Offer label must be text of at most 120 characters.' }, { status: 400 });
      }
      contentPatch.offer_label = labelValue;
    }
    const tags = body.offer_tags ?? body.tags ?? body.ad_tags;
    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag: unknown) => typeof tag !== 'string' || tag.trim().length > 50)) {
        return NextResponse.json({ error: 'Provide no more than 20 tags, each 50 characters or fewer.' }, { status: 400 });
      }
      contentPatch.tags = tags.map((tag: string) => tag.trim());
    }

    const paymentWindowInput = body.payment_window ?? body.payment_window_minutes;
    if (paymentWindowInput !== undefined) {
      const paymentWindow = Number(paymentWindowInput);
      if (!Number.isInteger(paymentWindow) || paymentWindow < 30 || paymentWindow > 1440) {
        return NextResponse.json({ error: 'Payment window must be a whole number between 30 and 1440 minutes.' }, { status: 400 });
      }
      contentPatch.payment_window = paymentWindow;
    }

    if (body.require_full_name_verified !== undefined) {
      if (typeof body.require_full_name_verified !== 'boolean') {
        return NextResponse.json({ error: 'require_full_name_verified must be a boolean.' }, { status: 400 });
      }
      contentPatch.require_full_name_verified = body.require_full_name_verified;
    }
    if (body.require_verified_users !== undefined) {
      if (typeof body.require_verified_users !== 'boolean') {
        return NextResponse.json({ error: 'require_verified_users must be a boolean.' }, { status: 400 });
      }
      contentPatch.require_verified_users = body.require_verified_users;
    }

    if (body.min_completed_trades !== undefined) {
      const minimumTrades = Number(body.min_completed_trades);
      if (!Number.isInteger(minimumTrades) || minimumTrades < 0 || minimumTrades > 1000000) {
        return NextResponse.json({ error: 'Minimum completed trades must be a whole number from 0 to 1000000.' }, { status: 400 });
      }
      contentPatch.min_completed_trades = minimumTrades;
    }
    if (requestedDirection !== undefined) contentPatch.direction = requestedDirection;
    if (body.auto_reply !== undefined) {
      if (typeof body.auto_reply !== 'string' || body.auto_reply.length > 2000) {
        return NextResponse.json({ error: 'Auto reply must be text of at most 2000 characters.' }, { status: 400 });
      }
      contentPatch.auto_reply = body.auto_reply;
    }

    if (Object.keys(contentPatch).length === 0) {
      return NextResponse.json({ error: 'No editable advertisement fields were supplied.' }, { status: 400 });
    }

    const contentUpdate = await updateAdContentAtomically(
      supabaseAdmin,
      existingAd,
      id,
      { id: user.id, email: user.email, isAdmin: false },
      contentPatch
    );
    if (!contentUpdate.ok) {
      return NextResponse.json(
        { success: false, code: contentUpdate.code, error: contentUpdate.error },
        { status: contentUpdate.statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      data: { ...existingAd, ...contentPatch },
    });
  } catch (err: any) {
    console.error('Error updating ad:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Remove an ad
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    // Use a verified request cookie session or an explicitly supplied bearer token.
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const supabase = bearerToken ? createBearerClient(bearerToken) : await createClient();

    let user = null;
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve ad across ads / p2p_ads using universal resolver
    const resolved = await findAdById(id);
    const existingAd = resolved?.ad || null;

    if (!existingAd) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const adOwnerId = existingAd.user_id || existingAd.userId || existingAd.seller_id || existingAd.creator_id;
    if (!adOwnerId) {
      return NextResponse.json(
        { error: 'Advertisement owner could not be verified.', code: 'AD_OWNER_UNRESOLVED' },
        { status: 409 }
      );
    }
    if (String(adOwnerId) !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden. You do not own this advertisement.' }, { status: 403 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Keep the historical ad rows and trade references; atomically make both
    // listing representations unavailable through the trusted status RPC.
    const deletion = await setAdStatusAtomically(
      supabaseAdmin,
      existingAd,
      id,
      { id: user.id, email: user.email, isAdmin: false },
      'DELETED'
    );

    if (!deletion.ok) {
      return NextResponse.json(
        { success: false, code: deletion.code, error: deletion.error },
        { status: deletion.statusCode }
      );
    }

    return NextResponse.json({ success: true, message: 'Ad deleted successfully.' });
  } catch (err: any) {
    console.error('Error deleting ad:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
