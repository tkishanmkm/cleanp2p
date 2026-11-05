import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const { username } = rawParams;
    const cleanUsername = (username || '').replace(/^@/, '');

    const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(cleanUsername);

    // 1. Query public profile / profiles table
    let profile: any = null;
    const PUBLIC_PROFILE_COLUMNS = 'id, username, display_name, avatar_url, photo_url, country, is_verified, is_online, is_trading_eligible, created_at, total_completed_trades, completed_trades, trade_volume, total_volume_usd, avg_payment_minutes, avg_release_minutes, positive_feedback, negative_feedback, feedback_score, merchant_tier';
    let query = supabaseAdmin.from('public_profiles').select(PUBLIC_PROFILE_COLUMNS);
    if (isUuid) {
      // Treat UUID-shaped input strictly as an ID; do not interpolate it into
      // a PostgREST OR filter where user-controlled syntax could alter the query.
      query = query.eq('id', cleanUsername);
    } else {
      query = query.ilike('username', cleanUsername);
    }
    const { data: directProfile, error } = await query.maybeSingle();

    if (directProfile && !error) {
      profile = directProfile;
    } else if (error) {
      console.error('[PUBLIC_PROFILE] Public profile lookup failed:', error.code || 'unknown');
      return NextResponse.json({ error: 'Unable to load public profile' }, { status: 503 });
    }

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Public profile data may expose public badges only, never internal KYC workflow state.
    // A public verification badge is a single, explicitly approved boolean.
    // Do not expose internal email/KYC workflow columns in public profile responses.
    const isEmailVerified = false;
    const isIdVerified = profile.is_verified === true;

    // 3. Feedback statistics from both deployed review stores. The obsolete
    // trade_feedback relation is not present in production.
    let feedbacks: any[] = [];
    try {
      const [canonicalResult, legacyResult] = await Promise.all([
        supabaseAdmin
          .from('feedbacks')
          .select('id, trade_id, reviewer_id, reviewee_id, is_positive')
          .eq('reviewee_id', profile.id)
          .limit(500),
        supabaseAdmin
          .from('feedback')
          .select('id, trade_id, from_user, to_user, rating, is_positive')
          .eq('to_user', profile.id)
          .limit(500),
      ]);

      const canonicalRows = Array.isArray(canonicalResult.data) ? canonicalResult.data : [];
      const legacyRows = Array.isArray(legacyResult.data) ? legacyResult.data : [];
      const uniqueReviews = new Map<string, any>();
      for (const row of canonicalRows) {
        const key = row.trade_id && row.reviewer_id ? `${row.trade_id}:${row.reviewer_id}` : `feedbacks:${row.id}`;
        uniqueReviews.set(key, row);
      }
      for (const row of legacyRows) {
        const key = row.trade_id && row.from_user ? `${row.trade_id}:${row.from_user}` : `feedback:${row.id}`;
        if (!uniqueReviews.has(key)) {
          uniqueReviews.set(key, {
            ...row,
            is_positive: row.is_positive ?? String(row.rating || '').toLowerCase() === 'positive',
          });
        }
      }
      feedbacks = Array.from(uniqueReviews.values());
      if (canonicalResult.error || legacyResult.error) {
        console.warn('[PUBLIC_PROFILE] A feedback source was unavailable.', {
          canonicalCode: canonicalResult.error?.code || null,
          legacyCode: legacyResult.error?.code || null,
        });
      }
    } catch (feedbackError) {
      console.warn('[PUBLIC_PROFILE] Feedback statistics could not be loaded.', feedbackError);
      feedbacks = [];
    }

    const totalFeedback = feedbacks.length;
    const positiveFeedback = feedbacks.filter((f) => f.is_positive === true || f.is_positive === 'true' || (f.rating || '').toUpperCase() === 'POSITIVE').length;
    const negativeFeedback = feedbacks.filter((f) => f.is_positive === false || f.is_positive === 'false' || (f.rating || '').toUpperCase() === 'NEGATIVE').length;
    const positiveRatio = totalFeedback > 0 ? ((positiveFeedback / totalFeedback) * 100).toFixed(1) : '100.0';

    return NextResponse.json({
      id: profile.id,
      username: `@${(profile.username || cleanUsername).replace(/^@/, '')}`,
      display_name: profile.display_name || null,
      avatar_url: profile.avatar_url || profile.photo_url || null,
      photo_url: profile.photo_url || profile.avatar_url || null,
      country: profile.country || 'US',
      is_email_verified: isEmailVerified,
      is_id_verified: isIdVerified,
      last_seen: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
      last_seen_at: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
      last_active: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
      is_online: profile.is_online ?? false,
      joined_at: profile.created_at || null,
      stats: {
        completed_trades: profile.completed_trades || 0,
        total_trade_volume: profile.total_trade_volume || profile.trade_volume || 0,
        avg_payment_minutes: profile.avg_payment_minutes || 0,
        avg_release_minutes: profile.avg_release_minutes || 0,
        positive_feedback_count: positiveFeedback,
        negative_feedback_count: negativeFeedback,
        positive_feedback_pct: `${positiveRatio}%`,
        total_feedback_count: totalFeedback,
      },
    });
  } catch (error) {
    console.error('Error fetching public user profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
