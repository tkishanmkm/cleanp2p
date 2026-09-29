import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { findAdById } from '@/lib/ad-lookup';
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

    const body = await request.json();
    const newStatus = body.status ? String(body.status).toUpperCase().trim() : (body.active ? 'ACTIVE' : 'INACTIVE');
    const isActive = newStatus === 'ACTIVE';

    const targetUuid = existingAd.id || adId;
    const targetPublicId = existingAd.public_ad_id || existingAd.public_id || existingAd.ad_id || adId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUuid);

    if (isUuid) {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, is_active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', targetUuid);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', targetUuid);
    } else {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, is_active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .or(`public_ad_id.eq.${targetPublicId},public_id.eq.${targetPublicId},ad_id.eq.${targetPublicId}`);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .or(`public_id.eq.${targetPublicId},public_ad_id.eq.${targetPublicId},ad_id.eq.${targetPublicId}`);
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
