import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const TERMINAL_TRADE_STATUSES = new Set([
  'completed',
  'released',
  'cancelled',
  'canceled',
  'expired',
]);

const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 20;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: You must be logged in to delete an account.' },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Fail closed if the trade history cannot be verified. Do not delete an account
    // while any trade is open, disputed, or in an unrecognized status.
    const { data: userTrades, error: tradesError } = await supabaseAdmin
      .from('trades')
      .select('id, status, is_disputed')
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .limit(1000);

    if (tradesError) {
      console.error('Account deletion trade-safety check failed:', tradesError);
      return NextResponse.json(
        { error: 'Unable to verify your trade history. Please try again later.', code: 'TRADE_HISTORY_CHECK_FAILED' },
        { status: 503 }
      );
    }

    if ((userTrades || []).length >= 1000) {
      return NextResponse.json(
        { error: 'Your trade history needs a manual safety review before account deletion.', code: 'TRADE_HISTORY_REVIEW_REQUIRED' },
        { status: 409 }
      );
    }

    const activeTrades = (userTrades || []).filter((trade: any) => {
      if (trade.is_disputed === true) return true;
      const status = String(trade.status || '').trim().toLowerCase();
      return !TERMINAL_TRADE_STATUSES.has(status);
    });

    if (activeTrades.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot request account deletion while you have open trades or unresolved escrow disputes. Please finalize or resolve them first.',
          code: 'ACTIVE_TRADES_BLOCK_ACCOUNT_DELETION',
        },
        { status: 409 }
      );
    }

    const requestedAt = new Date();
    const scheduledFor = new Date(
      requestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
    );
    const requestedAtIso = requestedAt.toISOString();
    const scheduledForIso = scheduledFor.toISOString();

    // Schedule deletion and lock the account immediately. Keep the existing username
    // and profile row as a tombstone; do not erase financial/trade audit records.
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        status: 'suspended',
        account_status: 'DELETION_PENDING',
        is_suspended: true,
        is_online: false,
        last_seen_at: null,
        deletion_requested_at: requestedAtIso,
        deletion_scheduled_for: scheduledForIso,
        deletion_completed_at: null,
        updated_at: requestedAtIso,
      })
      .eq('id', userId);

    if (profileError) {
      console.error('Account deletion request could not be saved:', profileError);
      return NextResponse.json(
        { error: 'Your deletion request could not be saved. No account data was removed.', code: 'DELETION_REQUEST_FAILED' },
        { status: 500 }
      );
    }

    // Deactivate ads immediately, but preserve ad rows for audit/history and trade references.
    const [p2pAdsResult, canonicalAdsResult] = await Promise.all([
      supabaseAdmin
        .from('p2p_ads')
        .update({ active: false, is_active: false, status: 'PAUSED' })
        .eq('user_id', userId),
      supabaseAdmin
        .from('ads')
        .update({ active: false, is_active: false, status: 'PAUSED' })
        .eq('user_id', userId),
    ]);

    const adsDeactivationFailed = Boolean(p2pAdsResult.error || canonicalAdsResult.error);
    if (adsDeactivationFailed) {
      console.error('Account deletion ad deactivation issue:', {
        p2pAdsError: p2pAdsResult.error,
        canonicalAdsError: canonicalAdsResult.error,
      });
      // Continue to lock the Auth account below; report partial failure instead of claiming full success.
    }

    // Keep the Auth user record so its email remains reserved and cannot be re-registered.
    // A long Auth ban blocks new sessions; middleware also checks the profile tombstone
    // so already-issued access tokens cannot use the app while they expire.
    const { error: authBanError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    });

    await supabase.auth.signOut().catch(() => undefined);

    if (authBanError) {
      console.error('Auth ban could not be confirmed for deletion request:', authBanError);
      return NextResponse.json(
        {
          success: false,
          code: 'DELETION_SCHEDULED_BUT_LOGIN_LOCK_NEEDS_REVIEW',
          deletionScheduledFor: scheduledForIso,
          error: 'Your deletion request is recorded and app access is restricted, but the sign-in lock needs support review. Contact support@wayones.com.',
        },
        { status: 503 }
      );
    }

    if (adsDeactivationFailed) {
      return NextResponse.json(
        {
          success: false,
          code: 'DELETION_SCHEDULED_AD_DEACTIVATION_FAILED',
          deletionScheduledFor: scheduledForIso,
          error: 'Your account is locked and deletion is scheduled, but some advertisements could not be paused. Contact support@wayones.com.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      code: 'ACCOUNT_DELETION_SCHEDULED',
      deletionScheduledFor: scheduledForIso,
      gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
      message: 'Your account is locked. Your name, date of birth, and profile picture will be removed after 20 days. Your email remains reserved so it cannot be used to create another account.',
    });
  } catch (err: any) {
    console.error('Account deletion request error:', err);
    return NextResponse.json(
      { error: 'Failed to process account deletion request. Please contact support@wayones.com.' },
      { status: 500 }
    );
  }
}
