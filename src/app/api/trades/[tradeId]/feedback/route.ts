import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function POST(
  req: Request,
  context: { params: { tradeId: string } | Promise<{ tradeId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams.tradeId;

    let supabase = await createClient();
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { isPositive, comment } = body;

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
      is_positive: !!isPositive,
      comment: comment || ''
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
  } catch (err: any) {
    console.error('Feedback error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
