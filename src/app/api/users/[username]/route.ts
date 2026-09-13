import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> | { username: string } }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const { username } = rawParams;
    const cleanUsername = (username || '').replace(/^@/, '');

    const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(cleanUsername);

    // 1. Query public profile / profiles table
    let profile: any = null;
    let query = supabaseAdmin.from('profiles').select('*');
    if (isUuid) {
      query = query.or(`id.eq.${cleanUsername},username.ilike.${cleanUsername}`);
    } else {
      query = query.ilike('username', cleanUsername);
    }
    const { data: directProfile, error } = await query.maybeSingle();

    if (directProfile && !error) {
      profile = directProfile;
    } else {
      const { data: pubProfile } = await supabaseAdmin
        .from('public_profiles')
        .select('*')
        .or(isUuid ? `id.eq.${cleanUsername},username.ilike.${cleanUsername}` : `username.ilike.${cleanUsername}`)
        .maybeSingle();

      if (pubProfile) {
        profile = pubProfile;
      }
    }

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Verification flags
    const isEmailVerified = Boolean(
      profile.is_email_verified ||
      profile.email_verified ||
      profile.email_confirmed_at ||
      (profile.email && !profile.email.includes('placeholder'))
    );

    const kycStatus = (profile.kyc_status || profile.identity_status || '').toUpperCase();
    const isIdVerified = Boolean(
      profile.is_id_verified ||
      profile.id_verified ||
      kycStatus === 'VERIFIED' ||
      kycStatus === 'APPROVED' ||
      profile.verification_tier === 2 ||
      profile.verification_tier === 'TIER_2'
    );

    // 3. Feedback statistics
    let feedbacks: any[] = [];
    try {
      const { data: fb1 } = await supabaseAdmin
        .from('feedbacks')
        .select('*')
        .eq('to_user_id', profile.id);
      if (Array.isArray(fb1) && fb1.length > 0) {
        feedbacks = fb1;
      } else {
        const { data: fb2 } = await supabaseAdmin
          .from('trade_feedback')
          .select('*')
          .eq('reviewee_id', profile.id);
        if (Array.isArray(fb2)) {
          feedbacks = fb2;
        }
      }
    } catch {
      feedbacks = [];
    }

    const totalFeedback = feedbacks.length;
    const positiveFeedback = feedbacks.filter((f) => f.is_positive === true || f.is_positive === 'true' || (f.rating || '').toUpperCase() === 'POSITIVE').length;
    const negativeFeedback = feedbacks.filter((f) => f.is_positive === false || f.is_positive === 'false' || (f.rating || '').toUpperCase() === 'NEGATIVE').length;
    const positiveRatio = totalFeedback > 0 ? ((positiveFeedback / totalFeedback) * 100).toFixed(1) : '100.0';

    return NextResponse.json({
      id: profile.id,
      username: `@${(profile.username || cleanUsername).replace(/^@/, '')}`,
      avatar_url: profile.avatar_url || null,
      country: profile.country || 'US',
      is_email_verified: isEmailVerified,
      is_id_verified: isIdVerified,
      kyc_status: kycStatus || (isIdVerified ? 'VERIFIED' : 'UNVERIFIED'),
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
