import { getSupabaseAdminClient } from '@/lib/supabase/server';

export type TradeEligibilityResult =
  | { allowed: true }
  | { allowed: false; statusCode: 403 | 503; code: string; message: string };

/**
 * Defense-in-depth HTTP guard. The escrow database RPC must independently
 * enforce the same policy because callers can invoke RPCs without these routes.
 */
export async function checkTradeEligibility(userId: string): Promise<TradeEligibilityResult> {
  try {
    const admin = getSupabaseAdminClient();
    const { data: profile, error } = await admin
      .from('profiles')
      .select('status, account_status, is_banned, is_suspended, is_on_hold')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) {
      console.error('[TradeEligibility] Unable to verify profile status:', error);
      return {
        allowed: false,
        statusCode: 503,
        code: 'TRADE_ELIGIBILITY_UNAVAILABLE',
        message: 'Unable to verify account eligibility right now. Please try again.',
      };
    }

    const status = String(profile.status ?? '').trim().toLowerCase();
    const accountStatus = String(profile.account_status ?? '').trim().toLowerCase();
    if (profile.is_banned === true || status === 'banned' || accountStatus === 'blocked') {
      return {
        allowed: false,
        statusCode: 403,
        code: 'ACCOUNT_BANNED',
        message: 'Your account is not permitted to initiate trades.',
      };
    }

    if (
      profile.is_suspended === true ||
      profile.is_on_hold === true ||
      ['restricted', 'suspended', 'disabled', 'deactivated'].includes(status) ||
      ['on_hold', 'suspended', 'blocked'].includes(accountStatus)
    ) {
      return {
        allowed: false,
        statusCode: 403,
        code: 'ACCOUNT_RESTRICTED',
        message: 'Your account is restricted from initiating trades.',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('[TradeEligibility] Unexpected eligibility check failure:', error);
    return {
      allowed: false,
      statusCode: 503,
      code: 'TRADE_ELIGIBILITY_UNAVAILABLE',
      message: 'Unable to verify account eligibility right now. Please try again.',
    };
  }
}
