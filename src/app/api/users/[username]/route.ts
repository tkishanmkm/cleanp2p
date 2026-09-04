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

    // 1. Query sanitized public profile view
    let profile: any = null;
    let query = supabaseAdmin.from('public_profiles').select('*');
    if (isUuid) {
      query = query.or(`id.eq.${cleanUsername},username.ilike.${cleanUsername}`);
    } else {
      query = query.ilike('username', cleanUsername);
    }
    const { data: pubProfile, error } = await query.maybeSingle();

    if (pubProfile && !error) {
      profile = pubProfile;
    } else {
      // Fallback to querying sanitized public columns from profiles table
      let fallbackQuery = supabaseAdmin
        .from('profiles')
        .select('id, username, full_name, avatar_url, country, last_seen_at, last_active, updated_at, created_at, completed_trades, total_trade_volume, avg_payment_minutes, avg_release_minutes, feedback_score, badges');
      
      if (isUuid) {
        fallbackQuery = fallbackQuery.or(`id.eq.${cleanUsername},username.ilike.${cleanUsername}`);
      } else {
        fallbackQuery = fallbackQuery.ilike('username', cleanUsername);
      }

      const { data: directProfile } = await fallbackQuery.maybeSingle();

      if (directProfile) {
        profile = {
          id: directProfile.id,
          username: directProfile.username || directProfile.full_name,
          avatar_url: directProfile.avatar_url,
          country: directProfile.country || 'US',
          last_seen_at: directProfile.last_seen_at || directProfile.last_active,
          joined_at: directProfile.created_at,
          completed_trades: directProfile.completed_trades || 0,
          total_trade_volume: directProfile.total_trade_volume || 0,
          avg_payment_minutes: directProfile.avg_payment_minutes || 0,
          avg_release_minutes: directProfile.avg_release_minutes || 0,
          feedback_score: directProfile.feedback_score || 100,
          badges: directProfile.badges || ['Verified Trader'],
        };
      }
    }

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Retrieve feedback summaries
    let feedback: any[] | null = null;
    try {
      const { data: fb } = await supabaseAdmin
        .from('trade_feedback')
        .select('rating, comment, created_at')
        .eq('target_user_id', profile.id);
      feedback = fb;
    } catch {
      feedback = [];
    }

    const total = feedback?.length || 0;
    const positive = feedback?.filter((f) => (f.rating || '').toUpperCase() === 'POSITIVE').length || 0;
    const positiveRatio = total > 0 ? ((positive / total) * 100).toFixed(1) : '100.0';
    const negativeRatio = total > 0 ? ((100 - parseFloat(positiveRatio)).toFixed(1)) : '0.0';

    return NextResponse.json({
      id: profile.id,
      username: `@${(profile.username || cleanUsername).replace(/^@/, '')}`,
      avatar_url: profile.avatar_url || null,
      last_seen_at: profile.last_seen_at || null,
      joined_at: profile.joined_at || profile.created_at || null,
      stats: {
        completed_trades: profile.completed_trades || 0,
        total_trade_volume: profile.total_trade_volume || 0,
        avg_payment_minutes: profile.avg_payment_minutes || 0,
        avg_release_minutes: profile.avg_release_minutes || 0,
        positive_feedback_pct: `${positiveRatio}%`,
        negative_feedback_pct: `${negativeRatio}%`,
        total_feedback_count: total,
      },
    });
  } catch (error) {
    console.error('Error fetching public user profile:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
