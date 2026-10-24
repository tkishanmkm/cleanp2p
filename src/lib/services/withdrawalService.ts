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
import { parseWithdrawalAmount } from '@/lib/wallet/amount-validation';

// The live canonical custodial withdrawal RPC currently supports USDT only.
// Do not route other assets through the legacy request_withdrawal function,
// whose target schema does not match the live withdrawals table.
export const SUPPORTED_ASSETS = ['USDT'] as const;
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

  if (settingsError || !settings) {
    return {
      success: false,
      status: 'PLATFORM_SETTINGS_UNAVAILABLE',
      error: 'Withdrawal controls could not be verified. Please try again later.',
      message: 'Withdrawals are temporarily unavailable while platform controls are verified.',
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
  const { data: userProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, is_verified, kyc_status, id_verified, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_banned, is_on_hold, is_withdrawal_locked, account_status')
    .eq('id', user.id)
    .maybeSingle();

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

  const parsedAmount = parseWithdrawalAmount(rawAmount);
  if (parsedAmount === null) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Amount must be a positive decimal with at most 6 decimal places',
      message: 'Invalid withdrawal amount',
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
  const [legacyWithdrawalsResult, onchainWithdrawalsResult] = await Promise.all([
    supabaseAdmin
      .from('withdrawals')
      .select('id, amount, asset_symbol, created_at, status')
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo)
      .in('status', ['completed', 'COMPLETED', 'processing', 'PROCESSING', 'QUEUED', 'PENDING_APPROVAL', 'APPROVED', 'approved', 'pending', 'PENDING']),
    supabaseAdmin
      .from('onchain_withdrawals')
      .select('id, amount, asset_symbol, created_at, status')
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo)
      .in('status', ['NEEDS_APPROVAL', 'needs_approval', 'PENDING_APPROVAL', 'pending_approval', 'PENDING', 'pending', 'QUEUED', 'BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST', 'COMPLETED', 'CONFIRMED']),
  ]);

  if (legacyWithdrawalsResult.error || onchainWithdrawalsResult.error) {
    return {
      success: false,
      status: 'WITHDRAWAL_HISTORY_UNAVAILABLE',
      error: 'Withdrawal history could not be verified. Please try again later.',
      message: 'Withdrawals are temporarily unavailable while limits are verified.',
      statusCode: 503,
    };
  }

  // The legacy and on-chain tables may contain the same withdrawal ID. Count each
  // operation once, preferring the canonical on-chain row when IDs overlap.
  const withdrawalsById = new Map<string, { amount: number | string; asset_symbol: string | null }>();
  for (const w of legacyWithdrawalsResult.data || []) {
    withdrawalsById.set(String(w.id), { amount: w.amount, asset_symbol: w.asset_symbol });
  }
  for (const w of onchainWithdrawalsResult.data || []) {
    withdrawalsById.set(String(w.id), { amount: w.amount, asset_symbol: w.asset_symbol });
  }

  let rolling24hUsd = 0;
  for (const w of withdrawalsById.values()) {
    const wAsset = w.asset_symbol || 'USDT';
    const wAmount = Number(w.amount || 0);
    const wUsd = await calculateWithdrawalUsdEquivalent(wAsset, wAmount);
    rolling24hUsd += wUsd;
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

  // 7. Require an idempotency key for every value-moving withdrawal request.
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return {
      success: false,
      status: 'IDEMPOTENCY_KEY_REQUIRED',
      error: 'A valid X-Idempotency-Key is required for withdrawals.',
      message: 'A valid idempotency key is required.',
      statusCode: 400,
    };
  }

  // 8. Atomic, idempotent reservation through the RPC aligned with the live
  // onchain_withdrawals and wallet_assets schema. The legacy request_withdrawal
  // RPC writes columns that do not exist in the live withdrawals table.
  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('request_custodial_withdrawal', {
    p_user_id: user.id,
    p_network: networkCode,
    p_asset_symbol: assetSymbol,
    p_to_address: validDestination,
    p_amount: parsedAmount,
    p_fee: networkFee,
    p_idempotency_key: idempotencyKey,
  });

  if (rpcError) {
    // Database errors may include internal schema details; keep them in server logs,
    // not in the public API response.
    console.error('[wallet-withdrawal] Atomic reservation failed', {
      code: rpcError.code,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return {
      success: false,
      status: 'RESERVATION_FAILED',
      error: 'Withdrawal could not be reserved. Please verify the request and try again.',
      message: 'Withdrawal reservation failed',
      statusCode: 400,
    };
  }

  const withdrawalId = rpcResult?.withdrawal_id || rpcResult;
  const returnedStatus = rpcResult?.status || 'NEEDS_APPROVAL';

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
