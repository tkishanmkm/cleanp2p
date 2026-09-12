import { getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const body = await request.json();
    const admin = getSupabaseAdminClient();

    const newStatus = body.status || 'ACTIVE';
    const isActive = newStatus === 'ACTIVE';

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(adId);

    if (isUuid) {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', adId);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', adId);
    } else {
      await admin
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus, updated_at: new Date().toISOString() })
        .or(`public_ad_id.eq.${adId},public_id.eq.${adId}`);

      await admin
        .from('ads')
        .update({ status: newStatus, is_active: isActive, updated_at: new Date().toISOString() })
        .or(`public_id.eq.${adId},public_ad_id.eq.${adId}`);
    }

    try {
      revalidatePath('/my-ads');
      revalidatePath('/buy');
      revalidatePath('/sell');
    } catch {}

    return NextResponse.json({ success: true, status: newStatus, active: isActive });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to toggle ad status' }, { status: 500 });
  }
}
