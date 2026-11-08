import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { findAdById, resolveBothTargetRows } from '@/lib/ad-lookup';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = (rawParams.adId || '').trim();
    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    // 1. Authenticate exactly one credential source. An explicit Bearer token
    // must not fall back to a different browser-cookie identity.
    const authHeader = request.headers.get('authorization');
    let user: any = null;
    let authError: any = null;

    if (authHeader !== null) {
      const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
      const bearerToken = bearerMatch?.[1]?.trim() || null;
      if (!bearerToken) {
        return NextResponse.json({ error: 'Invalid authorization header.' }, { status: 401 });
      }

      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user || null;
      authError = tokenAuth.error;
    } else {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user || null;
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

    if (!existingAd || resolved?.tableName === 'offers') {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check
    const adOwnerId = existingAd.user_id || existingAd.userId || existingAd.seller_id || existingAd.creator_id;
    const isOwner = adOwnerId && String(adOwnerId) === String(user.id);
    const adminAuth = await verifyServerAdmin(request);
    const isAdmin = adminAuth.authorized && adminAuth.supportAdmin !== true && adminAuth.supportReadOnly !== true;

    if (!isOwner && !isAdmin) {
      if (adminAuth.authorized && (adminAuth.supportAdmin === true || adminAuth.supportReadOnly === true)) {
        return NextResponse.json(
          { success: false, code: 'FULL_ADMIN_REQUIRED', error: 'A full administrator grant is required to change another user advertisement.' },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to modify this advertisement.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid advertisement status payload.' }, { status: 400 });
    }
    const newStatus = body.status ? String(body.status).toUpperCase().trim() : (body.active === true ? 'ACTIVE' : 'INACTIVE');
    const isActive = newStatus === 'ACTIVE';
    if (!['ACTIVE', 'INACTIVE', 'PAUSED', 'HIDDEN', 'DRAFT'].includes(newStatus)) {
      return NextResponse.json({ error: 'Invalid advertisement status.' }, { status: 400 });
    }

    // Platform restrictions block activation, but owners must always be able
    // to pause/deactivate an existing ad while new-ad creation is disabled.
    if (!isAdmin && isActive) {
      try {
        const { assertPlatformControlAllowed } = await import('@/lib/platform-guard');
        await assertPlatformControlAllowed('new_ad', { userId: user.id });
      } catch (guardError: any) {
        return NextResponse.json(
          {
            success: false,
            code: guardError?.code || 'PLATFORM_AD_CONTROL_BLOCKED',
            error: guardError?.message || 'Advertisement activation is temporarily unavailable.',
          },
          { status: Number.isInteger(guardError?.status) ? guardError.status : 503 }
        );
      }
    }

    const existingDirection = String(existingAd.trade_type || existingAd.ad_type || existingAd.type || '').toUpperCase();
    if (isActive && existingDirection === 'SELL') {
      return NextResponse.json(
        {
          success: false,
          error: 'SELL advertisements cannot be activated until their crypto inventory is reserved atomically.',
          code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
        },
        { status: 503 }
      );
    }

    if (isOwner && isActive) {
      const { data: ownerProfile, error: ownerProfileError } = await admin
        .from('profiles')
        .select('is_banned, is_restricted, is_suspended, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
        .eq('id', user.id)
        .maybeSingle();
      if (ownerProfileError || !ownerProfile) {
        return NextResponse.json({ error: 'Account eligibility could not be verified.' }, { status: 503 });
      }
      const profileStatus = String(ownerProfile.status || '').trim().toLowerCase();
      const accountStatus = String(ownerProfile.account_status || '').trim().toUpperCase();
      if (ownerProfile.is_banned === true || ownerProfile.is_restricted === true ||
          ownerProfile.is_suspended === true || ownerProfile.is_on_hold === true ||
          ownerProfile.is_emergency_frozen === true || ownerProfile.is_minor_restricted === true ||
          ['banned', 'restricted', 'suspended', 'deleted', 'inactive', 'on_hold', 'hold'].includes(profileStatus) ||
          ['BANNED', 'RESTRICTED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING', 'DELETED', 'INACTIVE', 'FROZEN', 'CLOSED'].includes(accountStatus)) {
        return NextResponse.json({ error: 'Restricted accounts cannot activate advertisements.', code: 'ACCOUNT_AD_ACCESS_BLOCKED' }, { status: 403 });
      }
    }

    // 4. Resolve both rows before invoking the single transactional status RPC.
    const { p2pAdsRow, adsRow, lookupErrors, ownerMismatches } =
      await resolveBothTargetRows(existingAd, adId, admin);

    if (ownerMismatches.p2p_ads || ownerMismatches.ads) {
      console.error('[PATCH /api/ads/[adId]/toggle] Identifier resolved to a different owner:', ownerMismatches);
      return NextResponse.json(
        {
          success: false,
          code: 'AD_IDENTIFIER_OWNER_MISMATCH',
          error: 'The advertisement identifier did not resolve to one consistent owner. No status update was attempted.',
        },
        { status: 409 }
      );
    }

    // A failed lookup is not proof that a mirror does not exist. Do not update
    // one representation when the other table could not be checked reliably.
    if (lookupErrors.p2p_ads || lookupErrors.ads) {
      console.error('[PATCH /api/ads/[adId]/toggle] Canonical/legacy row resolution failed:', lookupErrors);
      return NextResponse.json(
        {
          success: false,
          code: 'AD_MIRROR_LOOKUP_FAILED',
          error: 'Advertisement records could not be checked safely. No status update was attempted.',
        },
        { status: 503 }
      );
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const { data: statusResult, error: statusError } = await admin.rpc(
      'set_ad_status_atomic_authorized',
      {
        p_actor_id: user.id,
        p_actor_email: user.email || null,
        p_p2p_ad_id: p2pAdsRow?.id || null,
        p_legacy_ad_id: adsRow?.id || null,
        p_status: newStatus,
      }
    );

    if (statusError || !statusResult || statusResult.success !== true ||
        statusResult.status !== newStatus ||
        (adOwnerId && String(statusResult.owner_id) !== String(adOwnerId)) ||
        statusResult.canonical_updated !== Boolean(p2pAdsRow) ||
        statusResult.legacy_updated !== Boolean(adsRow) ||
        (!isOwner && statusResult.audit_logged !== true)) {
      console.error('[PATCH /api/ads/[adId]/toggle] Atomic status RPC failed:', {
        code: statusError?.code || null,
        canonicalRowResolved: Boolean(p2pAdsRow),
        legacyRowResolved: Boolean(adsRow),
      });

      const missingRpc = statusError?.code === 'PGRST202' || statusError?.code === '42883';
      const inventoryBlocked = statusError?.code === '23514';
      const mirrorMismatch = statusError?.code === '22023';
      const status = statusError?.code === '42501' ? 403
        : statusError?.code === 'P0002' ? 404
        : inventoryBlocked || mirrorMismatch ? 409
        : 503;

      return NextResponse.json(
        {
          success: false,
          code: inventoryBlocked ? 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'
            : mirrorMismatch ? 'AD_MIRROR_IDENTITY_MISMATCH'
            : missingRpc ? 'ATOMIC_AD_STATUS_RPC_NOT_INSTALLED'
            : 'ATOMIC_AD_STATUS_UPDATE_FAILED',
          error: inventoryBlocked
            ? 'SELL advertisements cannot be activated until their crypto inventory is reserved atomically.'
            : mirrorMismatch
              ? 'The canonical and legacy advertisement records failed their identity consistency check.'
              : missingRpc
                ? 'The approved atomic advertisement status migration must be applied before this operation is available.'
                : 'Advertisement status and its legacy mirror could not be updated atomically.',
        },
        { status }
      );
    }

    try {
      revalidatePath('/my-ads');
      revalidatePath('/buy');
      revalidatePath('/sell');
      revalidatePath(`/ad/${adId}`);
      revalidatePath(`/ads/${adId}`);
    } catch {}

    return NextResponse.json({
      success: true,
      status: newStatus,
      active: isActive,
      canonicalUpdated: statusResult.canonical_updated === true,
      legacyMirrorUpdated: statusResult.legacy_updated === true,
      auditLogged: statusResult.audit_logged === true,
    });
  } catch (err: any) {
    console.error('[PATCH /api/ads/[adId]/toggle] Unexpected status-change failure:', err);
    return NextResponse.json({ error: 'The advertisement status could not be updated.' }, { status: 500 });
  }
}
