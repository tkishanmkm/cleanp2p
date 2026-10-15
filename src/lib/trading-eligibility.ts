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
      .select('status, ban_policy, banned_at')
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
    if (status === 'banned') {
      const banExpiry = profile.banned_at ? new Date(profile.banned_at) : null;
      if (banExpiry) banExpiry.setMonth(banExpiry.getMonth() + 3);
      const temporaryBanExpired =
        String(profile.ban_policy ?? '').trim().toLowerCase() === 'three_months' &&
        Boolean(banExpiry && !Number.isNaN(banExpiry.getTime())) &&
        Date.now() >= (banExpiry?.getTime() ?? Number.POSITIVE_INFINITY);

      if (!temporaryBanExpired) {
        return {
          allowed: false,
          statusCode: 403,
          code: 'ACCOUNT_BANNED',
          message: 'Your account is not permitted to initiate trades.',
        };
      }
    }

    if (['restricted', 'suspended', 'disabled', 'deactivated'].includes(status)) {
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
