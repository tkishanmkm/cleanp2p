import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';


export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ tradeId: string; fileId: string }> }
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
    const adminSupabase = getSupabaseAdminClient();

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
    // Profile role fields are server-managed and not readable to client roles.
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('role, is_banned, is_suspended, is_on_hold')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || !profile || profile.is_banned || profile.is_suspended || profile.is_on_hold) {
      return NextResponse.json({ error: 'Unable to verify attachment access' }, { status: 503 });
    }

    const isParticipant = trade.buyer_id === userId || trade.seller_id === userId;
    const isAdmin = profile?.role === 'admin' || profile?.role === 'moderator';

    if (!isParticipant && !isAdmin) {
      return NextResponse.json({ error: '403 Forbidden: Access denied' }, { status: 403 });
    }

    // 3. Fetch file details
    // Metadata is read with service role only after the route has proven
    // that the caller is a participant or active administrator for this trade.
    const { data: file, error: fileError } = await adminSupabase
      .from('trade_files')
      .select('object_key, is_external_link, external_url, uploaded_by')
      .eq('id', fileId)
      .eq('trade_id', tradeId)
      .maybeSingle();

    if (fileError) {
      return NextResponse.json({ error: 'Unable to verify attachment metadata' }, { status: 503 });
    }

    if (!file) {
      return NextResponse.json({ error: 'File record not found' }, { status: 404 });
    }

    if (file.is_external_link) {
      // Revalidate legacy rows too; do not turn this endpoint into an open redirect.
      let safeExternalUrl: URL;
      try {
        safeExternalUrl = new URL(file.external_url || '');
      } catch {
        return NextResponse.json({ error: 'Invalid external attachment URL' }, { status: 400 });
      }
      const allowedHosts = new Set(['dropbox.com', 'www.dropbox.com', 'drive.google.com', 'onedrive.live.com', 'www.onedrive.live.com']);
      if (safeExternalUrl.protocol !== 'https:' || !allowedHosts.has(safeExternalUrl.hostname.toLowerCase()) || safeExternalUrl.username || safeExternalUrl.password) {
        return NextResponse.json({ error: 'External attachment host is not allowed' }, { status: 400 });
      }
      return NextResponse.redirect(safeExternalUrl.toString());
    }

    if (!file.object_key || file.object_key.includes('..') || file.object_key.includes('\\') || !file.object_key.startsWith(`trades/${tradeId}/`)) {
      return NextResponse.json({ error: 'Invalid attachment storage key' }, { status: 400 });
    }

    // Private trade objects must never receive direct, signed B2 URLs.
    // The authenticated proxy enforces trade participation and decrypts the object.
    const proxyUrl = new URL(
      `/api/trade/media?key=${encodeURIComponent(file.object_key)}&download=true`,
      req.url
    );
    return NextResponse.redirect(proxyUrl, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error: any) {
    console.error('Error in trade file access:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
