import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';
import { verifyUserTotpForSensitiveAction } from '@/lib/2fa';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { checkPasswordChangeHold } from '@/lib/withdrawal-security';
import {
  resolveAuthoritativeWithdrawalFee,
  calculateWithdrawalUsdEquivalent,
} from '@/lib/fees';
import { isValidTronAddress } from '@/lib/blockchain/tron';
import { isTier2User } from '@/lib/kyc';

// These are the asset/network pairs supported by the deployed request,
// claim, durable-signing, broadcast, confirmation, refund and settlement RPCs.
// BTC/LTC withdrawals remain disabled until the UTXO reservation and durable
// signed-transaction lifecycle is implemented end-to-end in SQL and workers.
export const SUPPORTED_ASSETS = ['USDT', 'ETH'] as const;
export const SUPPORTED_NETWORKS: Record<string, string[]> = {
  USDT: ['TRC20', 'ERC20', 'BEP20'],
  ETH: ['ERC20'],
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
  retryAfterSeconds?: number;
}

/**
 * Unified Canonical Server-Side Withdrawal Gateway
 */
export async function executeCanonicalWithdrawal(input: WithdrawalRequestInput): Promise<WithdrawalServiceResult> {
  // Independent release interlock: the deployed production request/worker/settlement
  // RPC contracts are not yet schema-compatible. Do not reserve any funds until a
  // schema-matched migration is deployed, verified, and this switch is deliberately enabled.
  if (process.env.ENABLE_WITHDRAWALS !== 'true') {
    return {
      success: false,
      status: 'DISABLED',
      error: 'Withdrawals are temporarily unavailable while secure settlement infrastructure is being completed.',
      message: 'Withdrawals are temporarily unavailable. Your wallet balance has not been changed.',
      statusCode: 503,
    };
  }

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
    .select('global_kill_switch_active, withdrawals_enabled')
    .eq('id', 1)
    .maybeSingle();

  // Financial controls must fail closed if the authoritative settings row cannot be read.
  if (settingsError || !settings) {
    return {
      success: false,
      status: 'WITHDRAWAL_CONTROLS_UNAVAILABLE',
      error: 'Withdrawals are temporarily unavailable while security controls are checked. Please try again later.',
      message: 'Withdrawal security settings could not be verified.',
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
    .select('id, is_verified, kyc_status, id_verified, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_banned, is_restricted, is_suspended, is_on_hold, is_withdrawal_locked, is_emergency_frozen, is_minor_restricted, withdrawals_disabled, account_status, status')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !userProfile) {
    return {
      success: false,
      status: 'ACCOUNT_STATUS_UNAVAILABLE',
      error: 'Withdrawals are temporarily unavailable because account security status could not be verified.',
      message: 'Account security status could not be verified.',
      statusCode: 503,
    };
  }

  const profileStatus = String(userProfile.status || '').trim().toLowerCase();
  const accountStatus = String(userProfile.account_status || '').trim().toUpperCase();
  if (
    userProfile.is_banned === true ||
    userProfile.is_restricted === true ||
    userProfile.is_suspended === true ||
    userProfile.is_on_hold === true ||
    userProfile.is_withdrawal_locked === true ||
    userProfile.is_emergency_frozen === true ||
    userProfile.is_minor_restricted === true ||
    userProfile.withdrawals_disabled === true ||
    ['banned', 'restricted', 'suspended', 'on_hold', 'hold', 'deleted', 'inactive', 'closed', 'deletion_pending'].includes(profileStatus) ||
    ['RESTRICTED', 'FROZEN', 'BANNED', 'BLOCKED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'DELETION_PENDING', 'DELETED', 'INACTIVE', 'CLOSED'].includes(accountStatus)
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
    if (typeof input.totpCode !== 'string' || input.totpCode.trim().length === 0 || input.totpCode.length > 128) {
      return {
        success: false,
        status: 'TWO_FACTOR_REQUIRED',
        error: 'TWO_FACTOR_REQUIRED: A 6-digit authenticator TOTP code is required to execute a withdrawal.',
        message: 'A 6-digit authenticator code is required.',
        statusCode: 403,
      };
    }
    const verification = await verifyUserTotpForSensitiveAction(
      supabaseAdmin, user.id, secret, input.totpCode, 'withdrawal'
    );
    if (!verification.ok) {
      return {
        success: false,
        status: verification.status === 429 ? 'TWO_FACTOR_RATE_LIMITED' : verification.status === 401 ? 'INVALID_2FA' : 'TWO_FACTOR_UNAVAILABLE',
        error: verification.error,
        message: verification.error,
        statusCode: verification.status,
        retryAfterSeconds: verification.retryAfterSeconds,
      };
    }
  }

  // 4. Validate Amount and Asset
  const rawAmount = input.amount;
  if (
    rawAmount === undefined ||
    rawAmount === null ||
    (typeof rawAmount !== 'number' && typeof rawAmount !== 'string')
  ) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Withdrawal amount is required',
      message: 'Withdrawal amount is required',
      statusCode: 400,
    };
  }

  const amountText = typeof rawAmount === 'string' ? rawAmount.trim() : null;
  const parsedAmount = typeof rawAmount === 'number'
    ? rawAmount
    : amountText !== null && amountText.length > 0
      ? Number(amountText)
      : Number.NaN;
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount >= 1e18) {
    return {
      success: false,
      status: 'INVALID_AMOUNT',
      error: 'Amount must be a positive number',
      message: 'Amount must be a positive number',
      statusCode: 400,
    };
  }

  if (input.asset !== undefined && input.asset !== null && typeof input.asset !== 'string') {
    return {
      success: false,
      status: 'UNSUPPORTED_ASSET',
      error: 'Asset must be provided as a valid text symbol.',
      message: 'Unsupported asset',
      statusCode: 400,
    };
  }
  if (
    (input.network !== undefined && input.network !== null && typeof input.network !== 'string') ||
    (input.chain !== undefined && input.chain !== null && typeof input.chain !== 'string')
  ) {
    return {
      success: false,
      status: 'UNSUPPORTED_NETWORK',
      error: 'Network must be provided as a valid text code.',
      message: 'Unsupported network',
      statusCode: 400,
    };
  }

  const assetSymbol = String(input.asset || 'USDT').toUpperCase().trim();
  const rawNetwork = input.network || input.chain || 'TRC20';
  const networkCode = normalizeNetwork(rawNetwork);

  const allowedDecimals = assetSymbol === 'ETH' || (assetSymbol === 'USDT' && networkCode === 'BEP20') ? 18 : 6;
  if (parsedAmount !== Number(parsedAmount.toFixed(allowedDecimals))) {
    return {
      success: false,
      status: 'INVALID_AMOUNT_PRECISION',
      error: `Withdrawal amount exceeds the supported ${allowedDecimals}-decimal precision for ${assetSymbol}/${networkCode}.`,
      message: 'Invalid amount precision',
      statusCode: 400,
    };
  }

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
  if (
    typeof input.destinationAddress !== 'string' ||
    input.destinationAddress.trim().length < 10 ||
    input.destinationAddress.trim().length > 180
  ) {
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

  // Validate the caller key before mutable checks so a retry can return its original result.
  if (
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < 16 ||
    input.idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(input.idempotencyKey)
  ) {
    return {
      success: false,
      status: 'INVALID_IDEMPOTENCY_KEY',
      error: 'A valid idempotency key (16–128 letters, numbers, dots, underscores, colons, or hyphens) is required.',
      message: 'Invalid idempotency key',
      statusCode: 400,
    };
  }

  // Return an already-committed receipt before consulting current gas or market
  // feeds. The helper uses the exact same fingerprint as the atomic reservation RPC.
  const { data: replayLookup, error: replayLookupError } = await supabaseAdmin.rpc(
    'get_withdrawal_idempotency_replay',
    {
      p_user_id: user.id,
      p_network: networkCode,
      p_to_address: validDestination,
      p_amount: parsedAmount,
      p_asset: assetSymbol,
      p_idempotency_key: input.idempotencyKey,
    }
  );

  if (replayLookupError) {
    if (replayLookupError.code === '23505') {
      return {
        success: false,
        status: 'IDEMPOTENCY_KEY_CONFLICT',
        error: 'This idempotency key was already used for different withdrawal details. Use a new key only for a new withdrawal.',
        message: 'Idempotency key conflict',
        statusCode: 409,
      };
    }
    if (replayLookupError.code === '55P03') {
      return {
        success: false,
        status: 'WITHDRAWAL_ALREADY_PROCESSING',
        error: 'A request with this idempotency key is already being processed. Check withdrawal history before retrying.',
        message: 'Withdrawal request is already processing',
        statusCode: 409,
      };
    }
    return {
      success: false,
      status: 'IDEMPOTENCY_LOOKUP_UNAVAILABLE',
      error: 'Withdrawal history could not be verified. Check your withdrawal history before retrying.',
      message: 'Withdrawal idempotency could not be verified.',
      statusCode: 503,
    };
  }

  if (!replayLookup || typeof replayLookup.found !== 'boolean') {
    return {
      success: false,
      status: 'IDEMPOTENCY_LOOKUP_UNAVAILABLE',
      error: 'Withdrawal history could not be verified. Check your withdrawal history before retrying.',
      message: 'Withdrawal idempotency response was invalid.',
      statusCode: 503,
    };
  }

  if (replayLookup.found === true) {
    const saved = replayLookup.response as Record<string, unknown> | undefined;
    const savedAmount = Number(saved?.amount);
    const savedFee = Number(saved?.network_fee);
    const savedTotal = Number(saved?.total_debited);
    const savedWithdrawalId = saved?.withdrawal_id;
    const savedStatus = saved?.status;
    if (
      saved?.success !== true ||
      typeof savedWithdrawalId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedWithdrawalId) ||
      typeof savedStatus !== 'string' ||
      !Number.isFinite(savedAmount) || savedAmount <= 0 ||
      !Number.isFinite(savedFee) || savedFee < 0 ||
      !Number.isFinite(savedTotal) || savedTotal <= 0 ||
      Math.abs(savedTotal - (savedAmount + savedFee)) > 1e-8
    ) {
      return {
        success: false,
        status: 'RESERVATION_UNCONFIRMED',
        error: 'The saved withdrawal receipt could not be verified. Check withdrawal history before retrying.',
        message: 'Saved withdrawal receipt is invalid.',
        statusCode: 503,
      };
    }

    return {
      success: true,
      withdrawalId: savedWithdrawalId,
      status: savedStatus,
      asset: typeof saved.asset === 'string' ? saved.asset : assetSymbol,
      network: typeof saved.network === 'string' ? saved.network : networkCode,
      destinationAddress: validDestination,
      amountRequested: savedAmount,
      networkFee: savedFee,
      totalDebited: savedTotal,
      message: 'Previously submitted withdrawal request retrieved successfully.',
      statusCode: 200,
    };
  }

  // Pending-approval lockout, maximum amount and rolling 24-hour limit are
  // enforced by request_withdrawal inside the idempotent reservation transaction.

  // 5. Server-Authoritative Fee Calculation (2x Applicable Network Gas)
  const feeInfo = await resolveAuthoritativeWithdrawalFee(assetSymbol, networkCode);
  const networkFee = feeInfo.feeCrypto;

  // 6. Calculate Authoritative USD Equivalent using a fresh market price.
  const usdEquivalent = await calculateWithdrawalUsdEquivalent(assetSymbol, parsedAmount);
  if (!Number.isFinite(usdEquivalent) || usdEquivalent < 5) {
    return {
      success: false,
      status: 'MIN_WITHDRAWAL_USD_NOT_MET',
      error: 'The minimum withdrawal is $5 USD equivalent. Smaller deposits may remain in your wallet, but cannot be withdrawn until the minimum is reached.',
      message: 'Minimum withdrawal is $5 USD equivalent.',
      statusCode: 400,
    };
  }

  // Per-withdrawal and rolling 24-hour limits are authoritative in
  // public.request_withdrawal, under the profile lock and before reservation.

  // 8. Every request uses the idempotent reservation RPC. Never fall back to
  // request_withdrawal directly, because that would bypass duplicate protection.
  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('request_withdrawal_idempotent', {
    p_user_id: user.id,
    p_network: networkCode,
    p_to_address: validDestination,
    p_amount: parsedAmount,
    p_fee: networkFee,
    p_asset: assetSymbol,
    p_usd_equivalent: usdEquivalent,
    p_idempotency_key: input.idempotencyKey,
  });

  if (rpcError) {
    const rpcMessage = String(rpcError.message || '');
    const keyConflict =
      rpcError.code === '23505' &&
      rpcMessage.includes('Idempotency key was used for different withdrawal details');
    const approvalPending =
      rpcError.code === '55P03' &&
      rpcMessage.includes('awaiting administrator approval');
    const requestInProgress =
      rpcError.code === '55P03' &&
      !approvalPending;
    const hardLimitExceeded =
      rpcError.code === '22023' &&
      rpcMessage.includes('Maximum single withdrawal limit exceeded');
    const dailyLimitExceeded =
      rpcError.code === '22023' &&
      rpcMessage.includes('Rolling 24-hour withdrawal limit exceeded');
    const accountForbidden = rpcError.code === '42501';
    const unavailableControl =
      rpcError.code === 'P0001' &&
      /control|pause|governance/i.test(rpcMessage);
    const missingBalance = rpcError.code === 'P0002';

    const status = keyConflict
      ? 'IDEMPOTENCY_KEY_CONFLICT'
      : approvalPending
        ? 'WITHDRAWAL_APPROVAL_PENDING'
        : requestInProgress
          ? 'WITHDRAWAL_ALREADY_PROCESSING'
          : hardLimitExceeded
            ? 'MAXIMUM_WITHDRAWAL_LIMIT_EXCEEDED'
            : dailyLimitExceeded
              ? 'DAILY_WITHDRAWAL_LIMIT_EXCEEDED'
              : accountForbidden
                ? 'ACCOUNT_RESTRICTED'
                : unavailableControl
                  ? 'WITHDRAWAL_CONTROLS_UNAVAILABLE'
                  : missingBalance
                    ? 'INSUFFICIENT_BALANCE'
                    : 'RESERVATION_FAILED';

    const message = keyConflict
      ? 'This idempotency key was already used for different withdrawal details. Use a new key only for a new withdrawal.'
      : approvalPending
        ? 'Your previous withdrawal is awaiting administrator approval. You cannot create another withdrawal until it is approved or rejected.'
        : requestInProgress
          ? 'A request with this idempotency key is already being processed. Check withdrawal history before retrying.'
          : hardLimitExceeded
            ? 'The maximum single-withdrawal limit was exceeded.'
            : dailyLimitExceeded
              ? 'The rolling 24-hour withdrawal limit was exceeded.'
              : accountForbidden
                ? 'Your account is not eligible to withdraw funds.'
                : unavailableControl
                  ? 'Withdrawals are temporarily unavailable because platform security controls could not be verified.'
                  : missingBalance
                    ? 'The requested asset balance is unavailable or not provisioned.'
                    : 'Withdrawal could not be confirmed. Check your withdrawal history before retrying.';

    return {
      success: false,
      status,
      error: message,
      message,
      statusCode: keyConflict || requestInProgress ? 409
        : approvalPending || accountForbidden ? 403
        : hardLimitExceeded || dailyLimitExceeded ? 400
        : missingBalance ? 409
        : 503,
    };
  }

  const withdrawalId = rpcResult?.withdrawal_id;
  const returnedStatus = rpcResult?.status;
  const committedAmount = Number(rpcResult?.amount);
  const committedFee = Number(rpcResult?.network_fee);
  const committedTotal = Number(rpcResult?.total_debited);
  if (
    rpcResult?.success !== true ||
    typeof withdrawalId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId) ||
    typeof returnedStatus !== 'string' ||
    !Number.isFinite(committedAmount) || committedAmount <= 0 ||
    !Number.isFinite(committedFee) || committedFee < 0 ||
    !Number.isFinite(committedTotal) || committedTotal <= 0 ||
    Math.abs(committedTotal - (committedAmount + committedFee)) > 1e-8
  ) {
    return {
      success: false,
      status: 'RESERVATION_UNCONFIRMED',
      error: 'Withdrawal could not be confirmed. Check your withdrawal history before retrying.',
      message: 'Withdrawal reservation response could not be verified.',
      statusCode: 503,
    };
  }

  // Activity Notification is emitted only for the first successful reservation.
  if (rpcResult.idempotent_replay !== true) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: user.id,
        title: returnedStatus === 'PENDING_APPROVAL' ? 'Withdrawal Awaiting Approval' : 'Withdrawal Pending',
        message: `Withdrawal of ${committedAmount} ${assetSymbol} has been received and is ${returnedStatus === 'PENDING_APPROVAL' ? 'awaiting administrator approval' : 'pending processing'}.`,
        type: 'withdrawal',
        is_read: false,
        metadata: { link: '/wallets' },
        created_at: new Date().toISOString(),
      });
    } catch (notificationError) {
      console.warn('[Withdrawal] Notification insert failed after committed reservation:', notificationError);
    }
  }

  return {
    success: true,
    withdrawalId,
    status: returnedStatus,
    asset: assetSymbol,
    network: networkCode,
    destinationAddress: validDestination,
    amountRequested: committedAmount,
    networkFee: committedFee,
    totalDebited: committedTotal,
    message: returnedStatus === 'PENDING_APPROVAL' ? 'Withdrawal is awaiting administrator approval.' : 'Withdrawal Pending',
    statusCode: 200,
  };
}
