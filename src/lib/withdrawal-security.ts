import { getSupabaseAdminClient } from '@/lib/supabase/server';

export interface PasswordHoldCheckResult {
  isHeld: boolean;
  remainingHours?: number;
  holdHours: number;
}

export interface WithdrawalGovernanceSettings {
  maxSingleUsd: number;
  dailyLimitUsd: number;
  approvalThresholdUsd: number;
  passwordHoldHours: number;
  withdrawalsEnabled: boolean;
  globalKillSwitch: boolean;
}

/**
 * Checks whether a user has an active withdrawal currently awaiting administrator approval.
 * Queries public.withdrawals for status IN ('PENDING_APPROVAL', 'pending_approval').
 */
export async function hasPendingWithdrawalApproval(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['PENDING_APPROVAL', 'pending_approval'])
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[WithdrawalSecurity] Error checking pending withdrawal approval:', error.message);
      // Fail-safe: query onchain_withdrawals
      const { data: onchainData, error: onchainError } = await supabaseAdmin
        .from('onchain_withdrawals')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['PENDING_APPROVAL', 'pending_approval'])
        .limit(1)
        .maybeSingle();

      if (onchainError) {
        throw new Error(`Unable to verify pending withdrawal approval state: ${onchainError.message}`);
      }
      return Boolean(onchainData?.id);
    }

    return Boolean(data?.id);
  } catch (err) {
    console.error('[WithdrawalSecurity] Unable to verify pending withdrawal approval state:', err);
    throw err instanceof Error ? err : new Error('Unable to verify pending withdrawal approval state');
  }
}

/**
 * Checks whether a user is currently under a temporary withdrawal security hold following a recent password change.
 * Defaults to a 24-hour security cooling-off window.
 */
export async function checkPasswordChangeHold(userId: string): Promise<PasswordHoldCheckResult> {
  const defaultHoldHours = 24.0;
  if (!userId) return { isHeld: false, holdHours: defaultHoldHours };

  try {
    const supabaseAdmin = getSupabaseAdminClient();

    // Fetch user password_changed_at timestamp and platform hold hours setting
    const [profileRes, settingsRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('password_changed_at')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('platform_settings')
        .select('password_change_withdrawal_hold_hours')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    if (profileRes.error) throw new Error(`Unable to read password-change timestamp: ${profileRes.error.message}`);
    if (settingsRes.error || !settingsRes.data) {
      throw new Error(`Unable to read password-change hold settings: ${settingsRes.error?.message || 'settings row missing'}`);
    }

    const passwordChangedAt = profileRes.data?.password_changed_at;
    const holdHours = Number(settingsRes.data.password_change_withdrawal_hold_hours || defaultHoldHours);

    if (!passwordChangedAt) {
      return { isHeld: false, holdHours };
    }

    const changedTime = new Date(passwordChangedAt).getTime();
    if (isNaN(changedTime)) {
      throw new Error('Invalid password_changed_at timestamp; cannot safely verify withdrawal hold');
    }

    const holdDurationMs = holdHours * 60 * 60 * 1000;
    const holdExpiryTime = changedTime + holdDurationMs;
    const now = Date.now();

    if (now < holdExpiryTime) {
      const remainingMs = holdExpiryTime - now;
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        isHeld: true,
        remainingHours: Math.max(1, remainingHours),
        holdHours,
      };
    }

    return { isHeld: false, holdHours };
  } catch (err) {
    console.error('[WithdrawalSecurity] Unable to verify password-change withdrawal hold:', err);
    throw err instanceof Error ? err : new Error('Unable to verify password-change withdrawal hold');
  }
}

/**
 * Retrieves the current platform-wide withdrawal limits and governance thresholds.
 */
export async function getWithdrawalGovernanceSettings(): Promise<WithdrawalGovernanceSettings> {
  const defaults: WithdrawalGovernanceSettings = {
    maxSingleUsd: 4000.0,
    dailyLimitUsd: 10000.0,
    approvalThresholdUsd: 2000.0,
    passwordHoldHours: 24.0,
    withdrawalsEnabled: true,
    globalKillSwitch: false,
  };

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('max_single_withdrawal_usd, daily_withdrawal_limit_usd, withdrawal_approval_threshold_usd, password_change_withdrawal_hold_hours, withdrawals_enabled, global_kill_switch_active')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) {
      return defaults;
    }

    return {
      maxSingleUsd: Number(data.max_single_withdrawal_usd || defaults.maxSingleUsd),
      dailyLimitUsd: Number(data.daily_withdrawal_limit_usd || defaults.dailyLimitUsd),
      approvalThresholdUsd: Number(data.withdrawal_approval_threshold_usd || defaults.approvalThresholdUsd),
      passwordHoldHours: Number(data.password_change_withdrawal_hold_hours || defaults.passwordHoldHours),
      withdrawalsEnabled: data.withdrawals_enabled !== false,
      globalKillSwitch: Boolean(data.global_kill_switch_active),
    };
  } catch (err) {
    console.error('[WithdrawalSecurity] Error fetching governance settings:', err);
    return defaults;
  }
}
