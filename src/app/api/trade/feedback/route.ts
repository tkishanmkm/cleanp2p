import { NextRequest, NextResponse } from 'next/server';
import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

type CanonicalFeedbackRow = {
  id: string;
  trade_id: string;
  reviewer_id: string;
  reviewee_id: string;
  is_positive: boolean;
  comment: string | null;
  created_at: string;
};

function legacyFeedbackShape(row: CanonicalFeedbackRow, fromUsername: string | null) {
  return {
    id: row.id,
    trade_id: row.trade_id,
    from_user: row.reviewer_id,
    from_username: fromUsername || 'Trader',
    to_user: row.reviewee_id,
    rating: row.is_positive ? 'positive' : 'negative',
    is_positive: row.is_positive,
    comment: row.comment || '',
    created_at: row.created_at,
  };
}

async function getAuthenticatedClient(req: Request) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!match || !match[1].trim() || match[1].trim().length > 8192) {
      throw new Error('Invalid bearer authorization header.');
    }
    return createBearerClient(match[1].trim());
  }
  return createClient();
}

function validTradeId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tradeId = searchParams.get('tradeId');
    if (!validTradeId(tradeId)) {
      return NextResponse.json({ error: 'A valid tradeId is required.' }, { status: 400 });
    }

    const supabase = await getAuthenticatedClient(req);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();
    const { data: trade, error: tradeError } = await admin
      .from('trades')
      .select('id,buyer_id,seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeError) {
      console.error('[TRADE_FEEDBACK] Trade access lookup failed.', { code: tradeError.code || null });
      return NextResponse.json({ error: 'Unable to verify trade access.' }, { status: 503 });
    }
    if (!trade || (user.id !== trade.buyer_id && user.id !== trade.seller_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // feedbacks is the only active review store. The URL userId parameter is
    // intentionally ignored; the authenticated user determines visibility.
    const { data: rows, error: feedbackError } = await admin
      .from('feedbacks')
      .select('id,trade_id,reviewer_id,reviewee_id,is_positive,comment,created_at')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });

    if (feedbackError) {
      console.error('[TRADE_FEEDBACK] Canonical feedback read failed.', { code: feedbackError.code || null });
      return NextResponse.json({ error: 'Unable to load trade feedback.' }, { status: 503 });
    }

    const feedbackRows = Array.isArray(rows) ? rows as CanonicalFeedbackRow[] : [];
    const reviewerIds = Array.from(new Set(feedbackRows.map((row) => row.reviewer_id).filter(Boolean)));
    const reviewerNames = new Map<string, string | null>();
    if (reviewerIds.length > 0) {
      const { data: profiles, error: reviewerError } = await admin
        .from('public_profiles')
        .select('id,username')
        .in('id', reviewerIds);
      if (reviewerError) {
        console.error('[TRADE_FEEDBACK] Reviewer label lookup failed.', { code: reviewerError.code || null });
      }
      for (const profile of profiles || []) {
        reviewerNames.set(profile.id, profile.username || null);
      }
    }

    let feedback: ReturnType<typeof legacyFeedbackShape> | null = null;
    let receivedFeedback: ReturnType<typeof legacyFeedbackShape> | null = null;
    for (const row of feedbackRows) {
      const mapped = legacyFeedbackShape(row, reviewerNames.get(row.reviewer_id) || null);
      if (row.reviewer_id === user.id) feedback = mapped;
      if (row.reviewee_id === user.id) receivedFeedback = mapped;
    }

    return NextResponse.json({ feedback, receivedFeedback }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: unknown) {
    console.error('[TRADE_FEEDBACK] Read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Unable to load trade feedback.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await getAuthenticatedClient(req);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const tradeId = body.tradeId;
    const rating = body.rating;
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (!validTradeId(tradeId)) {
      return NextResponse.json({ error: 'A valid tradeId is required.' }, { status: 400 });
    }
    if (rating !== 'positive' && rating !== 'negative') {
      return NextResponse.json({ error: 'Valid rating (positive or negative) is required.' }, { status: 400 });
    }
    if (!comment || comment.length > 2000) {
      return NextResponse.json({ error: 'Feedback comment must be between 1 and 2000 characters.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { data: trade, error: tradeError } = await admin
      .from('trades')
      .select('id,buyer_id,seller_id,status,escrow_status,completed_at,released_at,trade_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeError) {
      console.error('[TRADE_FEEDBACK] Trade lookup failed.', { code: tradeError.code || null });
      return NextResponse.json({ error: 'Unable to verify trade before feedback.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    }

    const buyerId = trade.buyer_id;
    const sellerId = trade.seller_id;
    if (user.id !== buyerId && user.id !== sellerId) {
      return NextResponse.json({ error: 'You are not a participant in this trade.' }, { status: 403 });
    }

    const rawStatus = String(trade.status || '').trim().toLowerCase();
    const rawEscrowStatus = String(trade.escrow_status || '').trim().toUpperCase();
    const completed = ['completed', 'released'].includes(rawStatus) ||
      ['COMPLETED', 'RELEASED'].includes(rawEscrowStatus) ||
      Boolean(trade.completed_at || trade.released_at);

    if (!completed) {
      return NextResponse.json({ error: 'Feedback can only be submitted for completed or released trades.' }, { status: 400 });
    }

    const expectedCounterpartId = user.id === buyerId ? sellerId : buyerId;
    if (!expectedCounterpartId || expectedCounterpartId === user.id) {
      return NextResponse.json({ error: 'Trade counterparty could not be verified.' }, { status: 409 });
    }
    if (body.counterpartId !== undefined && body.counterpartId !== null &&
        body.counterpartId !== expectedCounterpartId) {
      return NextResponse.json({ error: 'Feedback recipient must be the other participant in this trade.' }, { status: 403 });
    }

    const { data: existing, error: existingError } = await admin
      .from('feedbacks')
      .select('id')
      .eq('trade_id', tradeId)
      .eq('reviewer_id', user.id)
      .maybeSingle();

    if (existingError) {
      console.error('[TRADE_FEEDBACK] Duplicate lookup failed.', { code: existingError.code || null });
      return NextResponse.json({ error: 'Unable to verify whether feedback already exists.' }, { status: 503 });
    }
    if (existing) {
      return NextResponse.json({ error: 'You have already submitted feedback for this trade. Each participant may submit one review.' }, { status: 409 });
    }

    // Use the caller's authenticated Supabase client. The database INSERT
    // policy independently verifies completion and the exact counterparty.
    const { data: inserted, error: insertError } = await supabase
      .from('feedbacks')
      .insert({
        trade_id: tradeId,
        reviewer_id: user.id,
        reviewee_id: expectedCounterpartId,
        is_positive: rating === 'positive',
        comment,
      })
      .select('id,trade_id,reviewer_id,reviewee_id,is_positive,comment,created_at')
      .single();

    if (insertError || !inserted) {
      if (insertError?.code === '23505') {
        return NextResponse.json({ error: 'You have already submitted feedback for this trade.' }, { status: 409 });
      }
      console.error('[TRADE_FEEDBACK] Canonical feedback insert failed.', { code: insertError?.code || null });
      return NextResponse.json({ error: 'Unable to save feedback.' }, { status: 400 });
    }

    const { data: reviewer } = await admin
      .from('public_profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    const savedFeedback = legacyFeedbackShape(
      inserted as CanonicalFeedbackRow,
      reviewer?.username || user.user_metadata?.username || user.email?.split('@')[0] || null
    );

    // A chat notice is best-effort and cannot roll back the canonical review.
    const { error: messageError } = await supabase.from('trade_messages').insert({
      trade_id: tradeId,
      sender_id: user.id,
      message: `${rating === 'positive' ? 'Positive' : 'Negative'} feedback submitted.`,
    });
    if (messageError) {
      console.warn('[TRADE_FEEDBACK] Chat notice could not be posted.', { code: messageError.code || null });
    }

    return NextResponse.json({ success: true, feedback: savedFeedback }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: unknown) {
    console.error('[TRADE_FEEDBACK] Submit failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Failed to submit feedback.' }, { status: 500 });
  }
}
