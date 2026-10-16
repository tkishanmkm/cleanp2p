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
  if (clean.length > 128) {
    return { valid: false, formatted: clean, error: 'Destination address is too long' };
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

  // Financial safety controls must be readable before any withdrawal is allowed.
  if (settingsError || !settings) {
    console.error('Withdrawal platform settings could not be verified:', settingsError?.message || 'missing settings row');
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Withdrawal security settings are temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
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
  const { data: userProfile, error: userProfileError } = await supabaseAdmin
    .from('profiles')
    .select('id, is_verified, kyc_status, id_verified, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_banned, is_on_hold, is_withdrawal_locked, account_status')
    .eq('id', user.id)
    .maybeSingle();

  // Missing/unreadable account controls must never be interpreted as an unrestricted user.
  if (userProfileError) {
    console.error('Withdrawal account security profile lookup failed:', userProfileError.message);
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Account security checks are temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }
  if (!userProfile) {
    return {
      success: false,
      status: 'ACCOUNT_PROFILE_UNAVAILABLE',
      error: 'Account security profile is unavailable.',
      message: 'Your account could not be verified for withdrawal.',
      statusCode: 403,
    };
  }

  if (
    userProfile.is_banned ||
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

  // Enforce authoritative password-change hold and pending-approval lockout.
  // If either security query fails, do not treat the account as unrestricted.
  let pwdHold: Awaited<ReturnType<typeof checkPasswordChangeHold>>;
  let isPendingApproval: boolean;
  try {
    pwdHold = await checkPasswordChangeHold(user.id);
    isPendingApproval = await hasPendingWithdrawalApproval(user.id);
  } catch (securityCheckError) {
    console.error('Withdrawal hold/approval security checks unavailable:', securityCheckError);
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Withdrawal security checks are temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

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
    if (!input.totpCode || typeof input.totpCode !== 'string' || !/^\d{4,8}$/.test(input.totpCode.trim())) {
      return {
        success: false,
        status: 'TWO_FACTOR_REQUIRED',
        error: 'TWO_FACTOR_REQUIRED: Valid 4-8 digit 2FA TOTP code is required to execute a withdrawal.',
        message: 'Valid 2FA TOTP authentication code required.',
        statusCode: 403,
      };
    }
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      console.error('Two-factor authentication is enabled but the user secret is unavailable.');
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Two-factor verification could not be completed.',
        message: 'Withdrawals are temporarily unavailable. Please contact support.',
        statusCode: 503,
      };
    }
    const isValidTotp = verify2FAOTP(secret, input.totpCode.trim(), is2faActive);
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

  const amountText = typeof rawAmount === 'string' ? rawAmount.trim() : '';
  const parsedAmount = typeof rawAmount === 'number'
    ? rawAmount
    : (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amountText) ? Number(amountText) : Number.NaN);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Amount must be a positive number',
      message: 'Amount must be a positive number',
      statusCode: 400,
    };
  }

  if (
    (input.asset !== undefined && input.asset !== null && typeof input.asset !== 'string') ||
    (input.network !== undefined && input.network !== null && typeof input.network !== 'string') ||
    (input.chain !== undefined && input.chain !== null && typeof input.chain !== 'string')
  ) {
    return {
      success: false,
      status: 'INVALID_ASSET_OR_NETWORK',
      error: 'Asset and network must be strings.',
      message: 'Invalid asset or network.',
      statusCode: 400,
    };
  }

  const assetSymbol = (input.asset || 'USDT').toUpperCase().trim();
  const rawNetwork = input.network || input.chain || 'TRC20';
  const networkCode = normalizeNetwork(rawNetwork);

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
  if (typeof input.destinationAddress !== 'string' || input.destinationAddress.trim().length === 0) {
    return {
      success: false,
      status: 'INVALID_ADDRESS',
      error: 'A valid destination address string is required.',
      message: 'Invalid destination address.',
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

  // 5–6. Resolve authoritative fee and USD value. Never continue with guessed prices
  // or defaults if configuration/oracle/database checks are unavailable.
  let networkFee: number;
  let usdEquivalent: number;
  try {
    const feeInfo = await resolveAuthoritativeWithdrawalFee(assetSymbol, networkCode);
    networkFee = feeInfo.feeCrypto;
    usdEquivalent = await calculateWithdrawalUsdEquivalent(assetSymbol, parsedAmount);
  } catch (pricingError) {
    console.error('Withdrawal pricing/configuration check unavailable:', pricingError);
    return {
      success: false,
      status: 'PRICING_UNAVAILABLE',
      error: 'Authoritative withdrawal pricing is temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

  // Financial limits must come from valid persisted settings; do not silently
  // substitute permissive defaults when configuration is missing or malformed.
  const hardMaxUsd = Number(settings.max_single_withdrawal_usd);
  const dailyLimitUsd = Number(settings.daily_withdrawal_limit_usd);
  if (
    !Number.isFinite(hardMaxUsd) ||
    hardMaxUsd <= 0 ||
    !Number.isFinite(dailyLimitUsd) ||
    dailyLimitUsd <= 0
  ) {
    console.error('Withdrawal limits are missing or invalid in platform settings.');
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Withdrawal limits could not be verified.',
      message: 'Withdrawals are temporarily unavailable. Please contact support.',
      statusCode: 503,
    };
  }

  // =========================================================================
  // RULE A: $4,000 HARD MAXIMUM & AUTOMATIC ACCOUNT RESTRICTION
  // =========================================================================
  if (usdEquivalent > hardMaxUsd) {
    // AUTOMATIC RESTRICTION
    const { error: restrictionError } = await supabaseAdmin
      .from('profiles')
      .update({
        account_status: 'restricted',
        is_withdrawal_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (restrictionError) {
      console.error('Failed to persist hard-limit withdrawal restriction:', restrictionError.message);
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Security restriction could not be applied. Withdrawals are disabled temporarily.',
        message: 'Withdrawals are temporarily unavailable. Please contact support.',
        statusCode: 503,
      };
    }

    const { error: auditError } = await supabaseAdmin.from('admin_audit_logs').insert({
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

    if (auditError) {
      console.error('Failed to audit hard-limit withdrawal restriction:', auditError.message);
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Security audit could not be recorded. Withdrawals are disabled temporarily.',
        message: 'Withdrawals are temporarily unavailable. Please contact support.',
        statusCode: 503,
      };
    }

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
  const { data: past24hWithdrawals, error: past24hWithdrawalsError } = await supabaseAdmin
    .from('withdrawals')
    .select('amount, asset_symbol, created_at')
    .eq('user_id', user.id)
    .gte('created_at', oneDayAgo)
    .in('status', ['completed', 'processing', 'QUEUED', 'PENDING_APPROVAL', 'APPROVED', 'approved', 'pending']);

  if (past24hWithdrawalsError || !past24hWithdrawals) {
    console.error('Unable to load recent withdrawals for daily limit enforcement:', past24hWithdrawalsError);
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Daily withdrawal-limit verification is temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

  let rolling24hUsd = 0;
  try {
    if (past24hWithdrawals && past24hWithdrawals.length > 0) {
      for (const w of past24hWithdrawals) {
        const wAsset = typeof w.asset_symbol === 'string' ? w.asset_symbol.trim() : '';
        const wAmount = Number(w.amount);
        if (!wAsset || !Number.isFinite(wAmount) || wAmount <= 0) {
          throw new Error('Recent withdrawal history contains invalid amount or asset data.');
        }
        const wUsd = await calculateWithdrawalUsdEquivalent(wAsset, wAmount);
        if (!Number.isFinite(wUsd) || wUsd <= 0) {
          throw new Error('Recent withdrawal history could not be valued safely.');
        }
        rolling24hUsd += wUsd;
        if (!Number.isFinite(rolling24hUsd)) {
          throw new Error('Recent withdrawal total is not finite.');
        }
      }
    }
  } catch (pricingError) {
    console.error('Unable to value recent withdrawals for daily limit enforcement:', pricingError);
    return {
      success: false,
      status: 'PRICING_UNAVAILABLE',
      error: 'Authoritative pricing for daily withdrawal-limit checks is temporarily unavailable.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

  const projected24hUsd = rolling24hUsd + usdEquivalent;
  if (!Number.isFinite(projected24hUsd) || projected24hUsd < 0) {
    console.error('Projected rolling withdrawal total is invalid.');
    return {
      success: false,
      status: 'SECURITY_CHECK_UNAVAILABLE',
      error: 'Daily withdrawal total could not be verified.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

  if (projected24hUsd > dailyLimitUsd) {
    // AUTOMATIC RESTRICTION
    const { error: restrictionError } = await supabaseAdmin
      .from('profiles')
      .update({
        account_status: 'restricted',
        is_withdrawal_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (restrictionError) {
      console.error('Failed to persist daily-limit withdrawal restriction:', restrictionError.message);
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Security restriction could not be applied. Withdrawals are disabled temporarily.',
        message: 'Withdrawals are temporarily unavailable. Please contact support.',
        statusCode: 503,
      };
    }

    const { error: auditError } = await supabaseAdmin.from('admin_audit_logs').insert({
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

    if (auditError) {
      console.error('Failed to audit daily-limit withdrawal restriction:', auditError.message);
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Security audit could not be recorded. Withdrawals are disabled temporarily.',
        message: 'Withdrawals are temporarily unavailable. Please contact support.',
        statusCode: 503,
      };
    }

    return {
      success: false,
      status: 'DAILY_LIMIT_EXCEEDED',
      error: `Daily withdrawal limit ($${dailyLimitUsd} USD equivalent) exceeded. Your account has been restricted for security review.`,
      message: 'Daily withdrawal limit exceeded. Account restricted.',
      statusCode: 400,
    };
  }

  // 7. Idempotency Check
  if (input.idempotencyKey) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('user_id', user.id)
      .eq('destination_address', validDestination)
      .eq('amount', parsedAmount)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('Unable to verify possible duplicate withdrawal:', existingError.message);
      return {
        success: false,
        status: 'SECURITY_CHECK_UNAVAILABLE',
        error: 'Duplicate-withdrawal verification is temporarily unavailable.',
        message: 'Withdrawals are temporarily unavailable. Please try again later.',
        statusCode: 503,
      };
    }

    if (existing && (existing.status === 'completed' || existing.status === 'processing' || existing.status === 'QUEUED' || existing.status === 'PENDING_APPROVAL' || existing.status === 'APPROVED' || existing.status === 'approved' || existing.status === 'pending')) {
      const existingFee = Number(existing.network_fee);
      if (
        typeof existing.id !== 'string' ||
        existing.id.trim().length === 0 ||
        existing.network_fee === null ||
        existing.network_fee === undefined ||
        !Number.isFinite(existingFee) ||
        existingFee < 0
      ) {
        console.error('Existing withdrawal record has invalid replay fields.');
        return {
          success: false,
          status: 'SECURITY_CHECK_UNAVAILABLE',
          error: 'Existing withdrawal details could not be verified.',
          message: 'Withdrawals are temporarily unavailable. Please contact support.',
          statusCode: 503,
        };
      }

      return {
        success: true,
        status: existing.status,
        withdrawalId: existing.id,
        amountRequested: parsedAmount,
        networkFee: existingFee,
        totalDebited: parsedAmount + existingFee,
        message: 'Withdrawal already submitted (idempotent replay).',
        statusCode: 200,
      };
    }
  }

  // 8. Execute Atomic Balance Reservation via Authoritative RPC
  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('request_withdrawal', {
    p_user_id: user.id,
    p_network: networkCode,
    p_to_address: validDestination,
    p_amount: parsedAmount,
    p_fee: networkFee,
    p_asset: assetSymbol,
    p_usd_equivalent: usdEquivalent,
  });

  if (rpcError) {
    return {
      success: false,
      status: 'RESERVATION_FAILED',
      error: 'Balance reservation failed.',
      message: 'Withdrawals are temporarily unavailable. Please try again later.',
      statusCode: 503,
    };
  }

  const withdrawalId = rpcResult?.withdrawal_id || (typeof rpcResult === 'string' ? rpcResult : null);
  if (
    typeof withdrawalId !== 'string' ||
    withdrawalId.trim().length === 0 ||
    (typeof rpcResult === 'object' && rpcResult !== null && rpcResult.success === false)
  ) {
    console.error('Withdrawal reservation RPC returned an invalid success result:', rpcResult);
    return {
      success: false,
      status: 'RESERVATION_UNCONFIRMED',
      error: 'Withdrawal reservation could not be confirmed.',
      message: 'Withdrawals are temporarily unavailable. Please contact support if your balance changed.',
      statusCode: 503,
    };
  }

  const returnedStatus = rpcResult?.status || 'QUEUED';

  // Activity Notification
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: user.id,
      title: 'Withdrawal Pending',
      message: `Withdrawal of ${parsedAmount} ${assetSymbol} has been received and is pending processing.`,
      type: 'withdrawal',
      is_read: false,
      metadata: { link: '/wallets' },
      created_at: new Date().toISOString(),
    });
  } catch {}

  return {
    success: true,
    withdrawalId,
    status: returnedStatus,
    asset: assetSymbol,
    network: networkCode,
    destinationAddress: validDestination,
    amountRequested: parsedAmount,
    networkFee: networkFee,
    totalDebited: parsedAmount + networkFee,
    message: 'Withdrawal Pending',
    statusCode: 200,
  };
}
