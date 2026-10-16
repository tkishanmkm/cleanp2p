import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const { tradeId, tradePublicId, reportedUserId, category, description, evidenceUrls } = body as Record<string, unknown>;
    if (typeof tradeId !== 'string' || tradeId.trim().length === 0 || tradeId.length > 128 ||
        typeof category !== 'string' || category.trim().length === 0 || category.length > 100 ||
        typeof description !== 'string' || description.trim().length === 0 || description.length > 10000) {
      return NextResponse.json({ error: 'Trade ID, category, or description is invalid or too long.' }, { status: 400 });
    }
    if (tradePublicId !== undefined && tradePublicId !== null &&
        (typeof tradePublicId !== 'string' || tradePublicId.trim().length === 0 || tradePublicId.length > 128)) {
      return NextResponse.json({ error: 'Trade public ID is invalid.' }, { status: 400 });
    }
    if (reportedUserId !== undefined && reportedUserId !== null &&
        (typeof reportedUserId !== 'string' || reportedUserId.trim().length === 0 || reportedUserId.length > 128)) {
      return NextResponse.json({ error: 'Reported user ID is invalid.' }, { status: 400 });
    }
    if (evidenceUrls !== undefined && (!Array.isArray(evidenceUrls) || evidenceUrls.length > 20 ||
        evidenceUrls.some((url: unknown) => typeof url !== 'string' || url.length > 2048))) {
      return NextResponse.json({ error: 'Evidence must be a list of at most 20 valid URL strings.' }, { status: 400 });
    }
    if (Array.isArray(evidenceUrls) && evidenceUrls.some((url: unknown) => {
      if (typeof url !== 'string') return true;
      try {
        const parsed = new URL(url);
        return !['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname;
      } catch {
        return true;
      }
    })) {
      return NextResponse.json({ error: 'Each evidence item must be a valid HTTP or HTTPS URL.' }, { status: 400 });
    }

    const cleanTradeId = tradeId.trim();
    const cleanPublicId = typeof tradePublicId === 'string' ? tradePublicId.trim() : cleanTradeId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTradeId);
    let tradeQuery = supabase.from('trades').select('id, trade_id, buyer_id, seller_id');
    tradeQuery = isUuid
      ? tradeQuery.or(`id.eq.${cleanTradeId},trade_id.eq.${cleanTradeId}`)
      : tradeQuery.eq('trade_id', cleanTradeId);
    const { data: trade, error: tradeLookupError } = await tradeQuery.maybeSingle();
    if (tradeLookupError) {
      console.error('Trade report authorization lookup failed:', tradeLookupError.code || 'UNKNOWN');
      return NextResponse.json({ error: 'Unable to verify trade access right now.' }, { status: 500 });
    }
    if (!trade || (trade.buyer_id !== user.id && trade.seller_id !== user.id)) {
      return NextResponse.json({ error: 'Only participants in this trade can submit a report.' }, { status: 403 });
    }
    const otherParticipantId = trade.buyer_id === user.id ? trade.seller_id : trade.buyer_id;
    if (typeof reportedUserId === 'string' && reportedUserId.trim() !== otherParticipantId) {
      return NextResponse.json({ error: 'Reported user must be the other participant in this trade.' }, { status: 400 });
    }

    // Authenticated users intentionally cannot write audit/report tables directly.
    // Use the server-only service client only after verifying trade participation above.
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient
      .from('trade_reports')
      .insert({
        trade_id: trade.id,
        trade_public_id: cleanPublicId,
        reporter_id: user.id,
        reported_user_id: otherParticipantId,
        category: category.trim(),
        description: description.trim(),
        evidence_urls: Array.isArray(evidenceUrls) ? evidenceUrls.map((url: string) => url.trim()) : [],
        status: 'PENDING_REVIEW',
      })
      .select()
      .maybeSingle();

    if (error || !data) {
      // Do not claim the report was queued when the authoritative record was not saved.
      console.error('Trade report insert failed:', error?.code || 'NO_ROW_RETURNED');
      return NextResponse.json({ error: 'Unable to submit report right now. Please try again later.' }, { status: 500 });
    }

    let reporterUsername = user.user_metadata?.username || user.email?.split('@')[0] || 'Trader';
    try {
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle();
      if (prof?.username) reporterUsername = prof.username;
    } catch {}

    // The report record is authoritative. A chat-message failure must not make
    // clients believe the report itself failed and encourage duplicate submissions.
    try {
      await insertPaxonesSystemMessage(adminClient, {
        tradeId: trade.id,
        type: 'ISSUE_REPORTED',
        openerUsername: reporterUsername,
        issueCategory: category.trim(),
        issueDetails: description.trim()
      });
    } catch (messageError) {
      console.error('Trade report saved but system message failed:', messageError);
    }

    return NextResponse.json({ success: true, report: data });
  } catch (error: any) {
    console.error('Trade report submission failed:', error);
    return NextResponse.json({ error: 'Unable to submit report right now. Please try again later.' }, { status: 500 });
  }
}
