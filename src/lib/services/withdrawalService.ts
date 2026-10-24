import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';
import { verify2FAOTP } from '@/lib/2fa';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval, checkPasswordChangeHold } from '@/lib/withdrawal-security';
import {
  resolveAuthoritativeWithdrawalFee,
  calculateWithdrawalUsdEquivalent,
  getAuthoritativeAssetUsdPrice,
} from '@/lib/fees';
import { isValidTronAddress } from '@/lib/blockchain/tron';
import { isTier2User } from '@/lib/kyc';

export const SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'LTC'] as const;
export const SUPPORTED_NETWORKS: Record<string, string[]> = {
  USDT: ['TRC20', 'ERC20', 'BEP20'],
  BTC: ['BTC'],
  ETH: ['ETH', 'ERC20'],
  LTC: ['LTC'],
};

export function normalizeNetwork(network: string): string {
  const norm = (network || '').toUpperCase().trim();
  if (norm === 'TRON') return 'TRC20';
  if (norm === 'ETHEREUM') return 'ERC20';
  if (norm === 'BSC' || norm === 'BINANCE') return 'BEP20';
  if (norm === 'BITCOIN') return 'BTC';
  if (norm === 'LITECOIN') return 'LTC';
  return norm;
}

export function validateDestinationAddress(address: string, network: string): { valid: boolean; formatted: string; error?: string } {
  const clean = (address || '').trim();
  const normNet = normalizeNetwork(network);

  if (!clean || clean.length < 10) {
    return { valid: false, formatted: clean, error: 'Destination address is too short' };
  }

  if (normNet === 'TRC20') {
    if (!isValidTronAddress(clean)) {
      return { valid: false, formatted: clean, error: 'Invalid TRON TRC-20 destination address format' };
    }
    return { valid: true, formatted: clean };
  }

  if (normNet === 'ERC20' || normNet === 'BEP20' || normNet === 'ETH') {
    if (!ethers.isAddress(clean)) {
      return { valid: false, formatted: clean, error: 'Invalid EVM destination address format' };
    }
    try {
      const checksummed = ethers.getAddress(clean);
      return { valid: true, formatted: checksummed };
    } catch {
      return { valid: false, formatted: clean, error: 'Invalid EVM address checksum' };
    }
  }

  if (normNet === 'BTC') {
    // Bitcoin Mainnet addresses start with 1, 3, or bc1
    const btcRegex = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})$/i;
    if (!btcRegex.test(clean)) {
      return { valid: false, formatted: clean, error: 'Invalid Bitcoin mainnet address format' };
    }
    return { valid: true, formatted: clean };
  }

  if (normNet === 'LTC') {
    // Litecoin Mainnet addresses start with L, M, or ltc1
    const ltcRegex = /^(L[a-km-zA-HJ-NP-Z1-9]{26,33}|M[a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[a-z0-9]{39,59})$/i;
    if (!ltcRegex.test(clean)) {
      return { valid: false, formatted: clean, error: 'Invalid Litecoin mainnet address format' };
    }
    return { valid: true, formatted: clean };
  }

  return { valid: false, formatted: clean, error: `Unsupported network for destination validation: ${network}` };
}

export interface WithdrawalRequestInput {
  asset?: string;
  amount?: number | string;
  network?: string;
  chain?: string;
  destinationAddress?: string;
  totpCode?: string;
  idempotencyKey?: string;
  authHeader?: string | null;
}

export interface WithdrawalServiceResult {
  success: boolean;
  withdrawalId?: string;
  status: string;
  asset?: string;
  network?: string;
  destinationAddress?: string;
  amountRequested?: number;
  networkFee?: number;
  totalDebited?: number;
  message: string;
  error?: string;
  statusCode?: number;
}

/**
 * Unified Canonical Server-Side Withdrawal Gateway
 */
export async function executeCanonicalWithdrawal(input: WithdrawalRequestInput): Promise<WithdrawalServiceResult> {
  // Authoritative server-side platform guard: check if withdrawals are allowed
  try {
    await assertPlatformControlAllowed('withdrawal');
  } catch (guardErr: any) {
    return {
      success: false,
      status: 'REJECTED',
      error: guardErr.message || 'Withdrawals are temporarily disabled by administrator.',
      message: guardErr.message || 'Withdrawals are temporarily disabled by administrator.',
      statusCode: guardErr.statusCode || 403,
    };
  }

  const supabaseAdmin = getSupabaseAdminClient();

  // 1. Check Global Emergency Pause
  const { data: settings, error: settingsError } = await supabaseAdmin
    .from('platform_settings')
    .select('global_kill_switch_active, withdrawals_enabled, max_single_withdrawal_usd, withdrawal_approval_threshold_usd, daily_withdrawal_limit_usd')
    .eq('id', 1)
    .maybeSingle();

  // Missing or unreadable platform controls must never silently fall back to
  // default limits and allow a financial operation.
  if (settingsError || !settings) {
    console.error('[WithdrawalService] Unable to verify platform withdrawal controls:', settingsError);
    return {
      success: false,
      status: 'PLATFORM_CONTROLS_UNAVAILABLE',
      error: 'Withdrawal controls could not be verified. Please try again later.',
      message: 'Withdrawals are temporarily unavailable while system controls are verified.',
      statusCode: 503,
    };
  }

  if (settings.global_kill_switch_active || !settings.withdrawals_enabled) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'EMERGENCY_PAUSE: Withdrawals are temporarily disabled for system maintenance.',
      message: 'Withdrawals are currently disabled for maintenance.',
      statusCode: 503,
    };
  }

  // 2. Authenticate Caller Session
  const supabase = await createClient();
  let user: any = null;

  if (input.authHeader && input.authHeader.startsWith('Bearer ')) {
    const token = input.authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        user = data.user;
      }
    } catch {}
  }

  if (!user) {
    const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
    if (!authError && cookieUser) {
      user = cookieUser;
    }
  }

  if (!user) {
    return {
      success: false,
      status: 'UNAUTHORIZED',
      error: 'Unauthorized: Active user session required',
      message: 'Active user session required',
      statusCode: 401,
    };
  }

  // 3. User Profile Verification & Security Checks
  const { data: userProfile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, is_verified, kyc_status, id_verified, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_banned, is_on_hold, is_withdrawal_locked, account_status')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !userProfile) {
    console.error('[WithdrawalService] Unable to verify withdrawal profile:', profileError);
    return {
      success: false,
      status: 'PROFILE_VERIFICATION_UNAVAILABLE',
      error: 'Your account security status could not be verified. Please try again later.',
      message: 'Withdrawals are temporarily unavailable while account security is verified.',
      statusCode: 503,
    };
  }

  if (
    userProfile?.is_banned ||
    userProfile?.is_on_hold ||
    userProfile?.is_withdrawal_locked ||
    userProfile?.account_status === 'restricted' ||
    userProfile?.account_status === 'frozen' ||
    userProfile?.account_status === 'banned'
  ) {
    return {
      success: false,
      status: 'ACCOUNT_RESTRICTED',
      error: 'ACCOUNT_RESTRICTED: Withdrawals are restricted on your account. Please contact support@paxones.com.',
      message: 'Account restricted. Contact support.',
      statusCode: 403,
    };
  }

  // Enforce Authoritative Password-Change Security Hold
  const pwdHold = await checkPasswordChangeHold(user.id);
  if (pwdHold.isHeld) {
    return {
      success: false,
      status: 'PASSWORD_WITHDRAWAL_HOLD',
      error: `PASSWORD_WITHDRAWAL_HOLD: Withdrawals are temporarily suspended following a recent password change for security reasons. Please try again in ${pwdHold.remainingHours} hour(s).`,
      message: `Withdrawals are temporarily held for security after a password change. Remaining hold: ${pwdHold.remainingHours} hour(s).`,
      statusCode: 403,
    };
  }

  // Enforce Active Pending Approval Lockout (Single In-Flight Pending Approval Withdrawal)
  const isPendingApproval = await hasPendingWithdrawalApproval(user.id);
  if (isPendingApproval) {
    return {
      success: false,
      status: 'WITHDRAWAL_APPROVAL_PENDING',
      error: 'WITHDRAWAL_APPROVAL_PENDING: Your previous withdrawal is awaiting administrator approval. You cannot create another withdrawal until it is approved or rejected.',
      message: 'Your previous withdrawal is awaiting administrator approval. You cannot create another withdrawal until it is approved or rejected.',
      statusCode: 403,
    };
  }

  // Enforce Authoritative KYC Identity Verification (Tier 2 required)
  const isKycVerified = isTier2User(userProfile);

  if (!isKycVerified) {
    return {
      success: false,
      status: 'KYC_REQUIRED',
      error: 'KYC_REQUIRED: KYC verification is required to withdraw funds.',
      message: 'KYC verification is required to withdraw funds.',
      statusCode: 403,
    };
  }

  // Enforce Authoritative 2FA TOTP Verification
  const is2faActive = Boolean(userProfile?.is_2fa_enabled || userProfile?.is_mfa_enabled || userProfile?.two_factor_enabled);
  const secret = userProfile?.totp_secret || userProfile?.two_factor_secret;

  if (is2faActive) {
    if (!input.totpCode || typeof input.totpCode !== 'string' || input.totpCode.trim().length < 4) {
      return {
        success: false,
        status: 'TWO_FACTOR_REQUIRED',
        error: 'TWO_FACTOR_REQUIRED: Valid 4-8 digit 2FA TOTP code is required to execute a withdrawal.',
        message: 'Valid 2FA TOTP authentication code required.',
        statusCode: 403,
      };
    }
    const isValidTotp = verify2FAOTP(secret, String(input.totpCode).trim(), is2faActive);
    if (!isValidTotp) {
      return {
        success: false,
        status: 'INVALID_2FA',
        error: 'Invalid 2FA authentication code.',
        message: 'Invalid 2FA authentication code.',
        statusCode: 401,
      };
    }
  }

  // 4. Validate Amount and Asset
  const rawAmount = input.amount;
  if (rawAmount === undefined || rawAmount === null) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Withdrawal amount is required',
      message: 'Withdrawal amount is required',
      statusCode: 400,
    };
  }

  const parsedAmount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount));
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Amount must be a positive number',
      message: 'Amount must be a positive number',
      statusCode: 400,
    };
  }

  const assetSymbol = (input.asset || 'USDT').toUpperCase().trim();
  const rawNetwork = input.network || input.chain || 'TRC20';
  const networkCode = normalizeNetwork(String(rawNetwork));

  if (!SUPPORTED_ASSETS.includes(assetSymbol as any)) {
    return {
      success: false,
      status: 'UNSUPPORTED_ASSET',
      error: `Unsupported asset: ${assetSymbol}. Supported: ${SUPPORTED_ASSETS.join(', ')}`,
      message: 'Unsupported asset',
      statusCode: 400,
    };
  }

  const allowedNetworks = SUPPORTED_NETWORKS[assetSymbol] || [];
  if (!allowedNetworks.includes(networkCode)) {
    return {
      success: false,
      status: 'UNSUPPORTED_NETWORK',
      error: `Unsupported network ${networkCode} for ${assetSymbol}. Supported: ${allowedNetworks.join(', ')}`,
      message: 'Unsupported network',
      statusCode: 400,
    };
  }

  // Validate Destination Address Format
  if (!input.destinationAddress) {
    return {
      success: false,
      status: 'INVALID_ADDRESS',
      error: 'Destination address is required',
      message: 'Destination address is required',
      statusCode: 400,
    };
  }

  const addressValidation = validateDestinationAddress(input.destinationAddress, networkCode);
  if (!addressValidation.valid) {
    return {
      success: false,
      status: 'INVALID_ADDRESS',
      error: addressValidation.error || 'Invalid destination address format',
      message: 'Invalid destination address format',
      statusCode: 400,
    };
  }
  const validDestination = addressValidation.formatted;

  // 5. Server-Authoritative Fee Calculation (2x Applicable Network Gas)
  const feeInfo = await resolveAuthoritativeWithdrawalFee(assetSymbol, networkCode);
  const networkFee = feeInfo.feeCrypto;

  // 6. Calculate Authoritative USD Equivalent
  const usdEquivalent = await calculateWithdrawalUsdEquivalent(assetSymbol, parsedAmount);

  // Platform Limit Parameters
  const hardMaxUsd = Number(settings?.max_single_withdrawal_usd || 4000.0);
  const dailyLimitUsd = Number(settings?.daily_withdrawal_limit_usd || 10000.0);

  // =========================================================================
  // RULE A: $4,000 HARD MAXIMUM & AUTOMATIC ACCOUNT RESTRICTION
  // =========================================================================
  if (usdEquivalent > hardMaxUsd) {
    // AUTOMATIC RESTRICTION
    await supabaseAdmin
      .from('profiles')
      .update({
        account_status: 'restricted',
        is_withdrawal_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: user.id,
      admin_email: 'security_monitor@paxones.com',
      action: 'SECURITY_RESTRICTION_HARD_MAX_EXCEEDED',
      details: {
        user_id: user.id,
        attempted_usd: usdEquivalent,
        hard_max_usd: hardMaxUsd,
        asset: assetSymbol,
        amount: parsedAmount,
      },
    });

    return {
      success: false,
      status: 'LIMIT_EXCEEDED',
      error: `Maximum single withdrawal limit ($${hardMaxUsd} USD equivalent) exceeded. Your account has been restricted for security review.`,
      message: 'Withdrawal limit exceeded. Account restricted.',
      statusCode: 400,
    };
  }

  // =========================================================================
  // RULE B: ROLLING 24-HOUR DAILY WITHDRAWAL LIMIT
  // =========================================================================
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: past24hWithdrawals, error: dailyHistoryError } = await supabaseAdmin
    .from('withdrawals')
    .select('amount, asset_symbol, created_at')
    .eq('user_id', user.id)
    .gte('created_at', oneDayAgo)
    .in('status', ['completed', 'COMPLETED', 'processing', 'PROCESSING', 'broadcasted', 'BROADCASTED', 'ambiguous_broadcast', 'AMBIGUOUS_BROADCAST', 'queued', 'QUEUED', 'pending_approval', 'PENDING_APPROVAL', 'approved', 'APPROVED', 'pending', 'PENDING']);

  if (dailyHistoryError || !past24hWithdrawals) {
    console.error('[WithdrawalService] Unable to verify rolling 24-hour withdrawal history:', dailyHistoryError);
    return {
      success: false,
      status: 'DAILY_LIMIT_CHECK_UNAVAILABLE',
      error: 'The daily withdrawal limit could not be verified. Please try again later.',
      message: 'Withdrawals are temporarily unavailable while the daily limit is verified.',
      statusCode: 503,
    };
  }

  let rolling24hUsd = 0;
  if (past24hWithdrawals && past24hWithdrawals.length > 0) {
    for (const w of past24hWithdrawals) {
      const wAsset = w.asset_symbol || 'USDT';
      const wAmount = Number(w.amount || 0);
      const wUsd = await calculateWithdrawalUsdEquivalent(wAsset, wAmount);
      rolling24hUsd += wUsd;
    }
  }

  if (rolling24hUsd + usdEquivalent > dailyLimitUsd) {
    // AUTOMATIC RESTRICTION
    await supabaseAdmin
      .from('profiles')
      .update({
        account_status: 'restricted',
        is_withdrawal_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: user.id,
      admin_email: 'security_monitor@paxones.com',
      action: 'SECURITY_RESTRICTION_DAILY_LIMIT_EXCEEDED',
      details: {
        user_id: user.id,
        rolling_24h_usd: rolling24hUsd,
        attempted_usd: usdEquivalent,
        daily_limit_usd: dailyLimitUsd,
      },
    });

    return {
      success: false,
      status: 'DAILY_LIMIT_EXCEEDED',
      error: `Daily withdrawal limit ($${dailyLimitUsd} USD equivalent) exceeded. Your account has been restricted for security review.`,
      message: 'Daily withdrawal limit exceeded. Account restricted.',
      statusCode: 400,
    };
  }

  // 7. Validate the optional idempotency key. Actual replay protection is
  // enforced atomically by the database, not by guessing from amount/address.
  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
    return {
      success: false,
      status: 'INVALID_IDEMPOTENCY_KEY',
      error: 'Idempotency key must contain between 8 and 200 characters.',
      message: 'Invalid idempotency key.',
      statusCode: 400,
    };
  }

  // 8. Execute atomic balance reservation, using a per-user idempotency lock
  // whenever the caller supplies a key. Never replay an unrelated withdrawal
  // just because its amount and destination happen to match.
  const withdrawalParams = {
    p_user_id: user.id,
    p_network: networkCode,
    p_to_address: validDestination,
    p_amount: parsedAmount,
    p_fee: networkFee,
    p_asset: assetSymbol,
    p_usd_equivalent: usdEquivalent,
  };

  let rpcResult: any;
  let rpcError: any;
  if (idempotencyKey) {
    const response = await supabaseAdmin.rpc('request_withdrawal_idempotent', {
      ...withdrawalParams,
      p_idempotency_key: idempotencyKey,
    });
    rpcResult = response.data;
    rpcError = response.error;
  } else {
    const response = await supabaseAdmin.rpc('request_withdrawal', withdrawalParams);
    rpcResult = response.data;
    rpcError = response.error;
  }

  if (rpcError) {
    return {
      success: false,
      status: 'RESERVATION_FAILED',
      error: rpcError.message || 'Balance reservation failed',
      message: rpcError.message || 'Balance reservation failed',
      statusCode: 400,
    };
  }

  // Treat the database response as an untrusted boundary. A successful RPC
  // transport is not proof that a withdrawal was reserved: require a valid
  // UUID and explicit status before reporting success to the caller.
  const withdrawalId = rpcResult && typeof rpcResult === 'object' && !Array.isArray(rpcResult)
    ? rpcResult.withdrawal_id
    : undefined;
  const returnedStatus = typeof rpcResult?.status === 'string' ? rpcResult.status.trim() : '';
  const validWithdrawalId = typeof withdrawalId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId);
  const validRpcContract = validWithdrawalId
    && returnedStatus.length > 0
    && (rpcResult?.success === undefined || rpcResult.success === true);

  if (!validRpcContract) {
    console.error('[WithdrawalService] Withdrawal RPC returned an invalid reservation response; manual reconciliation is required.', {
      hasWithdrawalId: typeof withdrawalId === 'string',
      hasStatus: returnedStatus.length > 0,
      successFlag: rpcResult?.success,
    });
    return {
      success: false,
      status: 'RESERVATION_UNCONFIRMED',
      error: 'The reservation result could not be verified. Do not submit a new withdrawal request; contact support for reconciliation.',
      message: 'Withdrawal reservation could not be verified. Please contact support before retrying.',
      statusCode: 503,
    };
  }

  // Only notify for a newly reserved withdrawal. Idempotent replays must
  // not create duplicate notifications for the same withdrawal.
  if (rpcResult?.replayed !== true) {
    try {
      const { error: notificationError } = await supabaseAdmin.from('notifications').insert({
        user_id: user.id,
        title: 'Withdrawal Pending',
        message: `Withdrawal of ${parsedAmount} ${assetSymbol} has been received and is pending processing.`,
        type: 'withdrawal',
        is_read: false,
        metadata: { link: '/wallets' },
        created_at: new Date().toISOString(),
      });
      if (notificationError) {
        console.error('[WithdrawalService] Failed to create withdrawal notification:', notificationError);
      }
    } catch (notificationError) {
      console.error('[WithdrawalService] Failed to create withdrawal notification:', notificationError);
    }
  }

  return {
    success: true,
    withdrawalId,
    status: returnedStatus,
    asset: assetSymbol,
    network: networkCode,
    destinationAddress: validDestination,
    amountRequested: parsedAmount,
    networkFee: networkFee,
    totalDebited: Number(rpcResult?.total_debited ?? (parsedAmount + networkFee)),
    message: String(rpcResult?.message || (rpcResult?.replayed ? 'Withdrawal already submitted (idempotent replay).' : 'Withdrawal Pending')),
    statusCode: 200,
  };
}
