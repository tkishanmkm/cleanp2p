import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function POST(
  req: Request,
  context: { params: { tradeId: string } | Promise<{ tradeId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams?.tradeId;
    if (typeof tradeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) {
      return NextResponse.json({ error: 'A valid trade ID is required.' }, { status: 400 });
    }

    let supabase = await createClient();
    const authHeader = req.headers.get('authorization');
    if (authHeader !== null) {
      const bearerMatch = /^Bearer\\s+(.+)$/i.exec(authHeader.trim());
      if (!bearerMatch) {
        return NextResponse.json({ error: 'Authorization header is invalid.' }, { status: 401 });
      }
      const token = bearerMatch[1].trim();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Feedback bearer auth is not configured.');
        return NextResponse.json({ error: 'Authentication is temporarily unavailable.' }, { status: 500 });
      }
      supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      const contentLength = req.headers.get('content-length');
      if (contentLength !== null) {
        const parsedLength = Number(contentLength);
        if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > 16 * 1024) {
          return NextResponse.json({ error: 'Request body exceeds the 16 KB limit.' }, { status: 413 });
        }
      }
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 16 * 1024) {
        return NextResponse.json({ error: 'Request body exceeds the 16 KB limit.' }, { status: 413 });
      }
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const { isPositive, comment } = body as Record<string, unknown>;
    if (typeof isPositive !== 'boolean') {
      return NextResponse.json({ error: 'isPositive must be a boolean.' }, { status: 400 });
    }
    if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 1000)) {
      return NextResponse.json({ error: 'Feedback comment must be 1,000 characters or fewer.' }, { status: 400 });
    }
    const normalizedComment = typeof comment === 'string'
      ? comment.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim()
      : '';

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

    // 2. Check for duplicate feedback (idempotency)
    const { data: existingFeedback } = await supabase
      .from('trade_feedback')
      .select('id')
      .eq('trade_id', tradeId)
      .eq('reviewer_id', reviewerId)
      .single();

    if (existingFeedback) {
      return NextResponse.json({ error: 'Feedback already submitted for this trade' }, { status: 400 });
    }

    // 3. Insert feedback
    const { error: fbErr } = await supabase.from('trade_feedback').insert({
      trade_id: tradeId,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      is_positive: isPositive,
      comment: normalizedComment
    });

    if (fbErr) throw fbErr;

    // 4. Create system message
    const message = `${isPositive ? 'Positive' : 'Negative'} feedback submitted.`;
    await supabase.from('trade_messages').insert({
      trade_id: tradeId,
      message_type: 'SYSTEM',
      content: message
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Feedback request failed:', err instanceof Error ? err.name : 'UnknownError');
    return NextResponse.json({ error: 'Unable to submit feedback right now.' }, { status: 500 });
  }
}
