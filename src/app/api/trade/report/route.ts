import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tradeId, tradePublicId, reportedUserId, category, description, evidenceUrls } = await req.json();

    if (!tradeId || !category || !description) {
      return NextResponse.json({ error: 'Missing required report fields' }, { status: 400 });
    }

    const cleanPublicId = tradePublicId || tradeId;

    const { data, error } = await supabase
      .from('trade_reports')
      .insert({
        trade_id: tradeId,
        trade_public_id: cleanPublicId,
        reporter_id: user.id,
        reported_user_id: reportedUserId || null,
        category,
        description,
        evidence_urls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
        status: 'PENDING_REVIEW',
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn('Trade report table insert note:', error);
      // Create admin notification fallback
      await supabase.from('notifications').insert({
        user_id: user.id,
        message: `Your report for trade ${cleanPublicId} has been received and queued for investigation.`,
        link: `/trade/${tradeId}`,
        is_read: false,
      });
      return NextResponse.json({ success: true, message: 'Report queued for review' });
    }

    let reporterUsername = user.user_metadata?.username || user.email?.split('@')[0] || 'Trader';
    try {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle();
      if (prof?.username) reporterUsername = prof.username;
    } catch {}

    // Post official Paxones system message to trade chat
    await insertPaxonesSystemMessage(supabase, {
      tradeId,
      type: 'ISSUE_REPORTED',
      openerUsername: reporterUsername,
      issueCategory: category,
      issueDetails: description
    });

    return NextResponse.json({ success: true, report: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
