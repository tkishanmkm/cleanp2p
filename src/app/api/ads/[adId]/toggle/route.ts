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

    if (!existingAd) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 3. Authorization Check
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

    if (!isAdmin) {
      const { assertPlatformControlAllowed } = await import('@/lib/platform-guard');
      await assertPlatformControlAllowed('new_ad', { userId: user.id });
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
        .select('is_banned, is_restricted, is_suspended, status, account_status')
        .eq('id', user.id)
        .maybeSingle();
      if (ownerProfileError || !ownerProfile) {
        return NextResponse.json({ error: 'Account eligibility could not be verified.' }, { status: 503 });
      }
      const profileStatus = String(ownerProfile.status || '').trim().toLowerCase();
      const accountStatus = String(ownerProfile.account_status || '').trim().toUpperCase();
      if (ownerProfile.is_banned === true || ownerProfile.is_restricted === true || ownerProfile.is_suspended === true ||
          ['banned', 'restricted', 'suspended', 'deleted', 'on_hold', 'hold'].includes(profileStatus) ||
          ['BANNED', 'RESTRICTED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING', 'DELETED'].includes(accountStatus)) {
        return NextResponse.json({ error: 'Restricted accounts cannot activate advertisements.', code: 'ACCOUNT_AD_ACCESS_BLOCKED' }, { status: 403 });
      }
    }

    // 4. Independently resolve both target rows
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
        })
        .eq('id', p2pAdsRow.id)
        .select('id');

      if (!p2pErr && p2pRes && p2pRes.length > 0) {
        p2pMutated = true;
      } else {
        console.error('[PATCH /api/ads/[adId]/toggle] Canonical p2p_ads update failed:', p2pErr?.message);
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
          console.warn('[PATCH /api/ads/[adId]/toggle] Legacy ads mirror update warning:', adsErr?.message);
        }
      } catch (legacyErr: any) {
        console.warn('[PATCH /api/ads/[adId]/toggle] Legacy ads update exception:', legacyErr?.message);
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Canonical p2p_ads is authoritative. If p2pAdsRow exists, canonical p2p update must succeed.
    // If only legacy adsRow exists, ads update must succeed.
    const overallSuccess = p2pAdsRow ? p2pMutated : adsMutated;

    if (!overallSuccess) {
      console.error('[PATCH /api/ads/[adId]/toggle] Failed canonical row status update:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
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
    return NextResponse.json({ error: err.message || 'Failed to toggle ad status' }, { status: 500 });
  }
}
