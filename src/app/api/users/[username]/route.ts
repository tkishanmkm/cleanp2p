import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;
    const cleanUsername = (username || '').replace(/^@/, '');

    // 1. Query sanitized public profile view
    let profile: any = null;
    const { data: pubProfile, error } = await supabaseAdmin
      .from('public_profiles')
      .select('*')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (pubProfile && !error) {
      profile = pubProfile;
    } else {
      // Fallback to querying sanitized public columns from profiles table
      const { data: directProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, username, avatar_url, last_seen_at, last_active, created_at, completed_trades, total_trade_volume, avg_payment_minutes, avg_release_minutes')
        .ilike('username', cleanUsername)
        .maybeSingle();

      if (directProfile) {
        profile = {
          id: directProfile.id,
          username: directProfile.username,
          avatar_url: directProfile.avatar_url,
          last_seen_at: directProfile.last_seen_at || directProfile.last_active,
          joined_at: directProfile.created_at,
          completed_trades: directProfile.completed_trades || 0,
          total_trade_volume: directProfile.total_trade_volume || 0,
          avg_payment_minutes: directProfile.avg_payment_minutes || 0,
          avg_release_minutes: directProfile.avg_release_minutes || 0,
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
