import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { findAdById, resolveBothTargetRows } from '@/lib/ad-lookup';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

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
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    const bearerToken = bearerMatch?.[1]?.trim();

    let user: any = null;
    let authError: any = null;

    if (authHeader !== null) {
      if (!bearerToken) {
        return NextResponse.json({ error: 'Invalid authorization header.', code: 'INVALID_AUTHORIZATION' }, { status: 401 });
      }
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    } else {
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
      try {
        const { assertUserNotEmergencyFrozen } = await import('@/lib/user-freeze');
        await assertUserNotEmergencyFrozen(user.id);
      } catch (freezeErr: any) {
        return NextResponse.json(
          { error: freezeErr.message || 'Your account is under an emergency security freeze.', code: 'USER_EMERGENCY_FROZEN' },
          { status: 403 }
        );
      }
      const { assertPlatformControlAllowed } = await import('@/lib/platform-guard');
      await assertPlatformControlAllowed('new_ad', { userId: user.id });
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return NextResponse.json({ error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE' }, { status: 413 });
    }

    let bodyText: string;
    try {
      bodyText = await request.text();
    } catch {
      return NextResponse.json({ error: 'Unable to read request body.', code: 'INVALID_BODY' }, { status: 400 });
    }
    if (bodyText.length > 4096) {
      return NextResponse.json({ error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE' }, { status: 413 });
    }
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.', code: 'INVALID_BODY' }, { status: 400 });
    }
    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'The active field must be a boolean.', code: 'INVALID_AD_STATUS' }, { status: 400 });
    }
    if (body.status !== undefined && (typeof body.status !== 'string' || !['ACTIVE', 'INACTIVE'].includes(body.status.toUpperCase().trim()))) {
      return NextResponse.json({ error: 'Status must be ACTIVE or INACTIVE.', code: 'INVALID_AD_STATUS' }, { status: 400 });
    }
    if (body.status !== undefined && body.active !== undefined &&
        body.status.toUpperCase().trim() !== (body.active ? 'ACTIVE' : 'INACTIVE')) {
      return NextResponse.json({ error: 'The active and status fields must describe the same state.', code: 'CONFLICTING_AD_STATUS' }, { status: 400 });
    }
    if (body.status === undefined && body.active === undefined) {
      return NextResponse.json({ error: 'Missing active or status field.', code: 'INVALID_AD_STATUS' }, { status: 400 });
    }
    const newStatus = body.status !== undefined ? body.status.toUpperCase().trim() : (body.active ? 'ACTIVE' : 'INACTIVE');
    if (!isAdmin && !['ACTIVE', 'INACTIVE'].includes(newStatus)) {
      return NextResponse.json({ error: 'Status must be ACTIVE or INACTIVE.', code: 'INVALID_AD_STATUS' }, { status: 400 });
    }
    const isActive = newStatus === 'ACTIVE';

    // 4. Independently resolve both target rows
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
