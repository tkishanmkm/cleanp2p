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

    await supabase
      .from('p2p_ads')
      .update({ active: isActive, status: newStatus })
      .eq('id', adId);

    await supabase
      .from('ads')
      .update({ status: newStatus })
      .eq('id', adId);

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to toggle ad status' }, { status: 500 });
  }
}
