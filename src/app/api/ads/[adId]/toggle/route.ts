import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: { adId: string } | Promise<{ adId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const adId = rawParams.adId;
    const body = await request.json();
    const supabase = await createClient();

    const newStatus = body.status || 'ACTIVE';
    const isActive = newStatus === 'ACTIVE';

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(adId);

    if (isUuid) {
      await supabase
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus })
        .eq('id', adId);

      await supabase
        .from('ads')
        .update({ status: newStatus, is_active: isActive })
        .eq('id', adId);
    } else {
      await supabase
        .from('p2p_ads')
        .update({ active: isActive, status: newStatus })
        .or(`public_ad_id.eq.${adId},public_id.eq.${adId},id.eq.${adId}`);

      await supabase
        .from('ads')
        .update({ status: newStatus, is_active: isActive })
        .or(`public_id.eq.${adId},public_ad_id.eq.${adId}`);
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to toggle ad status' }, { status: 500 });
  }
}
