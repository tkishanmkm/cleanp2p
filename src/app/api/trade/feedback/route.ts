import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tradeId = searchParams.get('tradeId');
    const userId = searchParams.get('userId');

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const targetUserId = userId || user?.id;

    if (!targetUserId) {
      return NextResponse.json({ feedback: null });
    }

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('feedback')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('from_user', targetUserId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('Feedback query error:', error);
    }

    return NextResponse.json({ feedback: data || null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const { tradeId, rating, comment, counterpartId } = body;

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });
    }

    if (!rating || !['positive', 'negative'].includes(rating)) {
      return NextResponse.json({ error: 'Valid rating (positive or negative) is required' }, { status: 400 });
    }

    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return NextResponse.json({ error: 'Feedback comment is required' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // 1. Fetch trade details to verify participants
    const { data: trade, error: tradeErr } = await admin
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeErr || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const buyerId = trade.buyer_id || trade.buyerId;
    const sellerId = trade.seller_id || trade.sellerId;

    if (user.id !== buyerId && user.id !== sellerId) {
      return NextResponse.json({ error: 'You are not a participant in this trade' }, { status: 403 });
    }

    const effectiveCounterpartId = counterpartId || (user.id === buyerId ? sellerId : buyerId);

    // Get current user's username
    const { data: userProfile } = await admin
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    const fromUsername = userProfile?.username || user.user_metadata?.username || user.email?.split('@')[0] || 'Trader';

    // 2. Check if feedback already exists for this trade + from_user
    const { data: existingFeedback } = await admin
      .from('feedback')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('from_user', user.id)
      .maybeSingle();

    let savedFeedback: any = null;
    const isPositive = rating === 'positive';

    if (existingFeedback?.id) {
      // First attempt update with standard columns
      const { data: updated, error: updateErr } = await admin
        .from('feedback')
        .update({
          rating,
          is_positive: isPositive,
          comment: comment.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingFeedback.id)
        .select()
        .maybeSingle();

      if (updateErr) {
        // If error mentions column is_positive, fallback to update without is_positive
        if (updateErr.message?.includes('is_positive') || (updateErr as any)?.code === 'PGRST204') {
          const { data: fbFallback, error: fallbackErr } = await admin
            .from('feedback')
            .update({
              rating,
              comment: comment.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingFeedback.id)
            .select()
            .single();
          if (fallbackErr) throw fallbackErr;
          savedFeedback = fbFallback;
        } else {
          throw updateErr;
        }
      } else {
        savedFeedback = updated;
      }
    } else {
      const { data: inserted, error: insertErr } = await admin
        .from('feedback')
        .insert({
          trade_id: tradeId,
          from_user: user.id,
          from_username: fromUsername,
          to_user: effectiveCounterpartId,
          rating,
          is_positive: isPositive,
          comment: comment.trim(),
          created_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle();

      if (insertErr) {
        // If error mentions column is_positive, fallback to insert without is_positive
        if (insertErr.message?.includes('is_positive') || (insertErr as any)?.code === 'PGRST204') {
          const { data: fbFallback, error: fallbackErr } = await admin
            .from('feedback')
            .insert({
              trade_id: tradeId,
              from_user: user.id,
              from_username: fromUsername,
              to_user: effectiveCounterpartId,
              rating,
              comment: comment.trim(),
              created_at: new Date().toISOString(),
            })
            .select()
            .single();
          if (fallbackErr) throw fallbackErr;
          savedFeedback = fbFallback;
        } else {
          throw insertErr;
        }
      } else {
        savedFeedback = inserted;
      }
    }

    // 3. Update counterparty's profile stats (positive_feedback, negative_feedback, feedback_score)
    const { data: allFb } = await admin
      .from('feedback')
      .select('rating, is_positive')
      .eq('to_user', effectiveCounterpartId);

    if (allFb) {
      const posCount = allFb.filter((f) => f.is_positive === true || f.is_positive === 'true' || f.rating === 'positive').length;
      const negCount = allFb.filter((f) => f.is_positive === false || f.is_positive === 'false' || f.rating === 'negative').length;
      const total = posCount + negCount;
      const score = total > 0 ? Math.round((posCount / total) * 100) : 100;

      await admin
        .from('profiles')
        .update({
          positive_feedback: posCount,
          negative_feedback: negCount,
          feedback_score: score,
          updated_at: new Date().toISOString(),
        })
        .eq('id', effectiveCounterpartId);
    }

    // 4. Post automated system message into trade chat
    const ratingEmoji = rating === 'positive' ? '👍 Positive' : '👎 Negative';
    const systemChatMessage = `@${fromUsername} left ${rating} feedback for this trade.\nRating: ${ratingEmoji}\nReview: "${comment.trim()}"`;

    try {
      await admin.from('trade_messages').insert({
        trade_id: tradeId,
        sender_id: 'system',
        sender_username: 'Paxones System',
        message: systemChatMessage,
        is_system: true,
        is_moderator: false,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Notice posting feedback system message:', e);
    }

    // 5. Insert notification for counterpart
    const publicTradeRef = trade.trade_id || tradeId.substring(0, 8);
    try {
      await admin.from('notifications').insert({
        user_id: effectiveCounterpartId,
        message: `@${fromUsername} left you ${rating} feedback for trade #${publicTradeRef}: "${comment.trim().substring(0, 50)}${comment.length > 50 ? '...' : ''}"`,
        link: `/trade/${tradeId}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Notice sending feedback notification:', e);
    }

    return NextResponse.json({
      success: true,
      feedback: savedFeedback,
    });
  } catch (error: any) {
    console.error('Feedback submit error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
