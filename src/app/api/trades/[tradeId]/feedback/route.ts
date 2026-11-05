import { NextResponse } from 'next/server';
import { createClient, createBearerClient } from '@/utils/supabase/server';

export async function POST(
  req: Request,
  context: { params: Promise<{ tradeId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams.tradeId;

    let supabase = await createClient();
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      supabase = createBearerClient(token);
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required' }, { status: 400 });
    }
    const { isPositive, comment } = body;
    if (typeof isPositive !== 'boolean') {
      return NextResponse.json({ error: 'Feedback rating must be a boolean value' }, { status: 400 });
    }
    if (typeof comment !== 'string' || comment.trim().length === 0 || comment.trim().length > 2000) {
      return NextResponse.json({ error: 'Feedback comment must be 2000 characters or fewer' }, { status: 400 });
    }
    const cleanComment = comment.trim();

    // 1. Fetch trade and authorize
    const { data: trade, error: tradeErr } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id, status, escrow_status, completed_at, released_at')
      .eq('id', tradeId)
      .single();

    if (tradeErr || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const rawStatus = String(trade.status || '').toLowerCase();
    const rawEscrowStatus = String(trade.escrow_status || '').toUpperCase();
    const isCompleted =
      ['completed', 'released'].includes(rawStatus) ||
      ['COMPLETED', 'RELEASED'].includes(rawEscrowStatus) ||
      Boolean(trade.completed_at || trade.released_at);

    if (!isCompleted) {
      return NextResponse.json({ error: 'Feedback only allowed for completed trades' }, { status: 400 });
    }

    if (user.id !== trade.buyer_id && user.id !== trade.seller_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const reviewerId = user.id;
    const revieweeId = reviewerId === trade.buyer_id ? trade.seller_id : trade.buyer_id;

    if (reviewerId === revieweeId) {
      return NextResponse.json({ error: 'Cannot submit feedback for yourself' }, { status: 400 });
    }

    // The deployed schema stores review rows in public.feedbacks. The old
    // trade_feedback table is not present in the production database.
    const { data: existingFeedback, error: existingFeedbackError } = await supabase
      .from('feedbacks')
      .select('id')
      .eq('trade_id', tradeId)
      .eq('reviewer_id', reviewerId)
      .maybeSingle();

    if (existingFeedbackError) {
      console.error('[TRADE_FEEDBACK] Existing feedback lookup failed.', { code: existingFeedbackError.code || null });
      return NextResponse.json({ error: 'Unable to verify whether feedback already exists.' }, { status: 503 });
    }
    if (existingFeedback) {
      return NextResponse.json({ error: 'Feedback already submitted for this trade' }, { status: 409 });
    }

    // RLS independently verifies the completed trade and reviewer/reviewee pair.
    const { error: fbErr } = await supabase.from('feedbacks').insert({
      trade_id: tradeId,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      is_positive: isPositive,
      comment: cleanComment,
    });

    if (fbErr) {
      console.error('[TRADE_FEEDBACK] Feedback insert failed.', { code: fbErr.code || null });
      return NextResponse.json({ error: 'Unable to save feedback.' }, { status: 400 });
    }

    // Keep the message schema aligned with the deployed trade_messages table.
    const message = `${isPositive ? 'Positive' : 'Negative'} feedback submitted.`;
    const { error: messageError } = await supabase.from('trade_messages').insert({
      trade_id: tradeId,
      sender_id: user.id,
      message,
    });
    if (messageError) {
      // Feedback is already committed; chat notification is best-effort.
      console.warn('[TRADE_FEEDBACK] Notice could not be posted.', { code: messageError.code || null });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Feedback error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
