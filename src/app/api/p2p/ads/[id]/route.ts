import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { findAdById, resolveBothTargetRows } from '@/lib/ad-lookup';
import { setAdStatusAtomically } from '@/lib/ad-status';
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
    if (body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== '') body.min_amount = Number(body.min_amount);
    if (body.max_amount !== undefined && body.max_amount !== null && body.max_amount !== '') body.max_amount = Number(body.max_amount);
    if (body.min_limit !== undefined && body.min_limit !== null && body.min_limit !== '') body.min_limit = Number(body.min_limit);
    if (body.max_limit !== undefined && body.max_limit !== null && body.max_limit !== '') body.max_limit = Number(body.max_limit);

    const supabaseAdmin = getSupabaseAdminClient();

    const resolvedRows = await resolveBothTargetRows(existingAd, id, supabaseAdmin);
    if (resolvedRows.lookupErrors.p2p_ads || resolvedRows.lookupErrors.ads) {
      return NextResponse.json(
        { success: false, code: 'AD_MIRROR_LOOKUP_FAILED', error: 'Advertisement records could not be checked safely. No edit was attempted.' },
        { status: 503 }
      );
    }
    if (resolvedRows.ownerMismatches.p2p_ads || resolvedRows.ownerMismatches.ads) {
      return NextResponse.json(
        { success: false, code: 'AD_IDENTIFIER_OWNER_MISMATCH', error: 'Advertisement records did not resolve to one consistent owner. No edit was attempted.' },
        { status: 409 }
      );
    }

    const { p2pAdsRow, adsRow } = resolvedRows;
    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    let p2pMutated = false;
    let adsMutated = false;
    let updatedResult: any = null;

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
    const requestedDirection = [body.trade_type, body.ad_type, body.type, body.side]
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

    if (p2pAdsRow) {
      // Explicit allowlisted update payload for canonical public.p2p_ads
      const p2pPayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (body.price !== undefined) {
        p2pPayload.price = body.price;
        p2pPayload.unit_price = body.price;
      }
      if (body.min_limit !== undefined || body.min_amount !== undefined) {
        const minL = body.min_limit ?? body.min_amount;
        p2pPayload.min_limit = minL;
        p2pPayload.min_amount = minL;
      }
      if (body.max_limit !== undefined || body.max_amount !== undefined) {
        const maxL = body.max_limit ?? body.max_amount;
        p2pPayload.max_limit = maxL;
        p2pPayload.max_amount = maxL;
        p2pPayload.available_amount = maxL;
      }
      if (body.rate_percent !== undefined) {
        p2pPayload.rate_percent = body.rate_percent;
        p2pPayload.price_margin = body.rate_percent;
      }
      if (body.pricing_type !== undefined) p2pPayload.pricing_type = body.pricing_type;
      if (body.rate_type !== undefined) p2pPayload.rate_type = body.rate_type;
      if (body.payment_methods !== undefined) p2pPayload.payment_methods = body.payment_methods;
      if (body.terms_conditions !== undefined || body.terms !== undefined) p2pPayload.terms_conditions = body.terms_conditions || body.terms;
      if (body.offer_label !== undefined || body.label !== undefined) p2pPayload.offer_label = body.offer_label || body.label;
      if (body.offer_tags !== undefined || body.tags !== undefined) p2pPayload.offer_tags = body.offer_tags || body.tags;
      if (body.payment_window !== undefined || body.payment_window_minutes !== undefined) {
        const pw = Number(body.payment_window ?? body.payment_window_minutes);
        p2pPayload.payment_window = pw;
        p2pPayload.payment_window_minutes = pw;
        p2pPayload.payment_time_limit = pw;
      }
      if (body.require_full_name_verified !== undefined) p2pPayload.require_full_name_verified = Boolean(body.require_full_name_verified);
      if (body.require_verified_users !== undefined) p2pPayload.require_verified_users = Boolean(body.require_verified_users);
      if (body.min_completed_trades !== undefined) p2pPayload.min_completed_trades = parseInt(String(body.min_completed_trades), 10) || 0;

      // Ensure is_active NEVER reaches p2p_ads
      delete p2pPayload.is_active;

      const { data: p2pRes, error: p2pErr } = await supabaseAdmin
        .from('p2p_ads')
        .update(p2pPayload)
        .eq('id', p2pAdsRow.id)
        .select()
        .maybeSingle();

      if (!p2pErr && p2pRes) {
        p2pMutated = true;
        updatedResult = p2pRes;
      } else {
        console.error('[PATCH /api/p2p/ads/[id]] Canonical p2p_ads update failed:', p2pErr?.message);
      }
    }

    if (p2pAdsRow && !p2pMutated) {
      return NextResponse.json(
        { success: false, code: 'CANONICAL_AD_UPDATE_FAILED', error: 'The canonical advertisement could not be updated. The legacy mirror was not changed.' },
        { status: 503 }
      );
    }

    if (adsRow) {
      try {
        const adsPayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (body.price !== undefined) adsPayload.price = body.price;
        if (body.min_limit !== undefined || body.min_amount !== undefined) adsPayload.min_limit = body.min_limit ?? body.min_amount;
        if (body.max_limit !== undefined || body.max_amount !== undefined) adsPayload.max_limit = body.max_limit ?? body.max_amount;
        if (body.payment_methods !== undefined) adsPayload.payment_methods = body.payment_methods;
        if (body.terms_conditions !== undefined || body.terms !== undefined) adsPayload.terms = body.terms_conditions || body.terms;
        if (body.offer_label !== undefined || body.label !== undefined) adsPayload.offer_label = body.offer_label || body.label;

        const { data: adsRes, error: adsErr } = await supabaseAdmin
          .from('ads')
          .update(adsPayload)
          .eq('id', adsRow.id)
          .select()
          .maybeSingle();

        if (!adsErr && adsRes) {
          adsMutated = true;
          if (!updatedResult) updatedResult = adsRes;
        } else {
          console.error('[PATCH /api/p2p/ads/[id]] Legacy ads mirror update failed after canonical update:', adsErr?.code || 'unknown');
        }
      } catch (legacyErr: any) {
        console.error('[PATCH /api/p2p/ads/[id]] Legacy ads update exception after canonical update:', legacyErr?.message);
      }
    }

    if (adsRow && !adsMutated) {
      return NextResponse.json(
        { success: false, code: 'AD_MIRROR_UPDATE_FAILED', error: 'The canonical advertisement may have updated, but its legacy mirror failed. Reconcile the listing before retrying.' },
        { status: 503 }
      );
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Canonical p2p_ads is authoritative. If p2pAdsRow exists, canonical p2p update must succeed.
    // If only legacy adsRow exists, ads update must succeed.
    const overallSuccess =
      (!p2pAdsRow || p2pMutated) &&
      (!adsRow || adsMutated) &&
      Boolean(p2pAdsRow || adsRow);

    if (!overallSuccess) {
      console.error('[PATCH /api/p2p/ads/[id]] Target update failed:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
      return NextResponse.json({ error: 'Failed to update advertisement.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updatedResult || existingAd });
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
