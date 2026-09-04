import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getPresignedDownloadUrl } from '@/lib/b2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: { tradeId: string; fileId: string } | Promise<{ tradeId: string; fileId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const { tradeId, fileId } = rawParams;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // 1. Fetch trade participant records (check p2p_trades or trades)
    let { data: trade } = await supabase
      .from('p2p_trades')
      .select('buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (!trade) {
      const { data: altTrade } = await supabase
        .from('trades')
        .select('buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      trade = altTrade;
    }

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // 2. Fetch requester's profile role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const isParticipant = trade.buyer_id === userId || trade.seller_id === userId;
    const isAdmin = profile?.role === 'admin' || profile?.role === 'moderator';

    if (!isParticipant && !isAdmin) {
      return NextResponse.json({ error: '403 Forbidden: Access denied' }, { status: 403 });
    }

    // 3. Fetch file details
    const { data: file } = await supabase
      .from('trade_files')
      .select('object_key, is_external_link, external_url')
      .eq('id', fileId)
      .eq('trade_id', tradeId)
      .maybeSingle();

    if (!file) {
      return NextResponse.json({ error: 'File record not found' }, { status: 404 });
    }

    if (file.is_external_link) {
      return NextResponse.redirect(file.external_url!);
    }

    // 4. Generate signed B2 access link
    const signedUrl = await getPresignedDownloadUrl(file.object_key, 600);
    return NextResponse.redirect(signedUrl);
  } catch (error: any) {
    console.error('Error in trade file access:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
