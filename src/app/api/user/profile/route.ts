import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { isTier2User } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    const { data: { user } } = await supabase.auth.getUser();

    const targetUsername = request.nextUrl.searchParams.get('username')?.replace(/^@/, '').trim();

    const PUBLIC_COLUMNS = 'id, username, display_name, avatar_url, photo_url, country, is_verified, id_verified, kyc_status, is_online, last_seen_at, created_at, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, avg_release_time_mins, avg_release_minutes, avg_release_time, total_completed_trades, completed_trades, trade_volume, positive_feedback, negative_feedback, feedback_score';

    const OWNER_COLUMNS = 'id, username, display_name, name, full_name, email, avatar_url, photo_url, country, preferred_currency, name_visibility, dob, date_of_birth, is_country_locked, security_question, onboarding_completed, username_changed, username_changes_remaining, username_changed_count, is_verified, id_verified, kyc_status, is_kyc_locked, kyc_retry_count, kyc_attempts, kyc_last_attempt_at, kyc_submitted_at, kyc_approved_at, kyc_retry_after, is_2fa_enabled, is_mfa_enabled, is_online, last_seen_at, created_at, updated_at, deposit_address, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, avg_release_time_mins, avg_release_minutes, avg_release_time, total_completed_trades, completed_trades, trade_volume, positive_feedback, negative_feedback, feedback_score';

    let profile: any = null;
    let isOwner = false;

    // Mode 1: No username provided OR username matches current user -> Owner Mode
    if (!targetUsername || (user && (targetUsername.toLowerCase() === user.email?.toLowerCase() || targetUsername === user.id))) {
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { data: ownerProfile, error: ownerError } = await admin
        .from('profiles')
        .select(OWNER_COLUMNS)
        .eq('id', user.id)
        .maybeSingle();

      if (ownerError || !ownerProfile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }

      profile = ownerProfile;
      isOwner = true;
    } else {
      // Mode 2: Querying another user by username -> Public Mode (26 public columns ONLY)
      const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(targetUsername);
      let query = admin.from('profiles').select(PUBLIC_COLUMNS);

      if (isUuid) {
        query = query.or(`id.eq.${targetUsername},username.ilike.${targetUsername}`);
      } else {
        query = query.ilike('username', targetUsername);
      }

      const { data: publicProfile, error: publicError } = await query.maybeSingle();

      if (publicError || !publicProfile) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      profile = publicProfile;

      // Check if target is actually the requesting user
      if (user && profile.id === user.id) {
        // Upgrade to owner profile
        const { data: ownerProfile } = await admin
          .from('profiles')
          .select(OWNER_COLUMNS)
          .eq('id', user.id)
          .maybeSingle();
        if (ownerProfile) {
          profile = ownerProfile;
          isOwner = true;
        }
      }
    }

    // Calculate dynamic trades & fiat trade volume
    let completedTradeCount = profile.completed_trades || profile.total_completed_trades || 0;
    let totalTradeVolumeFiat = profile.trade_volume || profile.total_trade_volume || 0;

    let avgPayTimeSeconds: number | null = profile.avg_pay_time_seconds ?? null;
    let avgReleaseTimeSeconds: number | null = profile.avg_release_time_seconds ?? null;

    try {
      const { data: allUserTrades } = await admin
        .from('trades')
        .select('id, buyer_id, seller_id, created_at, paid_at, marked_paid_at, released_at, completed_at, fiat_amount, fiat_amount_usd, status')
        .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);

      if (allUserTrades && allUserTrades.length > 0) {
        const completedList = allUserTrades.filter(t => t.status === 'completed' || t.status === 'released');
        completedTradeCount = completedList.length;
        totalTradeVolumeFiat = completedList.reduce((acc, t) => {
          const val = Number(t.fiat_amount || t.fiat_amount_usd || 0);
          return acc + (isNaN(val) ? 0 : val);
        }, 0);
      }
    } catch {
      // ignore dynamic calculation error
    }

    const isIdVerified = isTier2User(profile);

    return NextResponse.json({
      profile: {
        ...profile,
        is_id_verified: isIdVerified,
        completed_trades: completedTradeCount,
        total_completed_trades: completedTradeCount,
        total_trade_volume: totalTradeVolumeFiat,
      },
      isOwner,
    });
  } catch (err: any) {
    console.error('Error in /api/user/profile:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
