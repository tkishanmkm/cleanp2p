import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyUserTotpForSensitiveAction } from '@/lib/2fa';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { isTier2User } from '@/lib/kyc';
import { isTransferAccountBlocked } from '@/lib/transfer-account-status';
import { isValidTransferRpcResponse } from '@/lib/transfer-rpc-validation';
import { getPlatformFeeSettings } from '@/lib/platform-fees';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Pending Withdrawal Approval Lockout Check
    const isWithdrawalPending = await hasPendingWithdrawalApproval(user.id);
    if (isWithdrawalPending) {
      return NextResponse.json({
        error: 'Your previous withdrawal is awaiting administrator approval. You cannot initiate transfers until it is approved or rejected.',
        code: 'WITHDRAWAL_APPROVAL_PENDING',
      }, { status: 403 });
    }

    // Platform Guard Check
    try {
      await assertPlatformControlAllowed('transfer', { userId: user.id });
    } catch (guardErr: any) {
      return NextResponse.json(
        { error: guardErr.message || 'Internal transfers are temporarily disabled.', code: guardErr.code || 'PLATFORM_TRANSFERS_DISABLED' },
        { status: guardErr.statusCode || 403 }
      );
    }

    const admin = getSupabaseAdminClient();
    const body = await req.json();
    const {
      recipientInput,
      recipientUsername,
      asset,
      crypto,
      amount,
      totpCode,
      idempotencyKey: bodyIdempotencyKey,
      idempotency_key,
      requestId,
    } = body;
    
    const targetIdentifier = String(recipientInput || recipientUsername || '').trim();
    const coinSymbol = String(asset || crypto || 'USDT').toUpperCase().trim();
    const numericAmount = Number(amount);

    // Extract and validate client idempotency key
    const headerIdempotencyKey = req.headers.get('x-idempotency-key') || req.headers.get('idempotency-key');
    const rawKey = String(bodyIdempotencyKey || idempotency_key || requestId || headerIdempotencyKey || '').trim();
    const idempotencyKey = rawKey && rawKey.length >= 8 && rawKey.length <= 128 ? rawKey : null;

    if (!idempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required for transfer execution (must be between 8 and 128 characters).',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      }, { status: 400 });
    }

    if (!targetIdentifier || !coinSymbol || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Recipient and positive amount required.' }, { status: 400 });
    }

    // 1. Fetch sender profile & check banned / restricted / emergency frozen status
    const { data: senderProfile } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_verified, id_verified, is_id_verified, kyc_status, verification_tier')
      .eq('id', user.id)
      .maybeSingle();

    if (!senderProfile) {
      return NextResponse.json({ error: 'Sender profile not found.' }, { status: 404 });
    }

    // Block sender if banned, restricted, or emergency frozen
    if (isTransferAccountBlocked(senderProfile)) {
      return NextResponse.json({
        error: senderProfile.is_emergency_frozen
          ? 'USER_EMERGENCY_FROZEN: Your account is under an individual emergency freeze. Transfers are disabled.'
          : 'Your account is restricted or banned. You cannot send or receive transfers.',
        code: senderProfile.is_emergency_frozen ? 'USER_EMERGENCY_FROZEN' : 'ACCOUNT_RESTRICTED'
      }, { status: 403 });
    }

    // 1b. Enforce Tier 2 KYC for Transfer OUT (Tier 1 is blocked)
    const isSenderTier2 = isTier2User(senderProfile);

    if (!isSenderTier2) {
      return NextResponse.json({
        error: 'KYC verification is required to transfer funds out.',
        code: 'KYC_REQUIRED',
        requires_kyc: true,
      }, { status: 403 });
    }

    // 2. Conditional 2FA check (only if enabled on sender profile)
    const is2faActive = Boolean(senderProfile?.is_2fa_enabled || senderProfile?.is_mfa_enabled || senderProfile?.two_factor_enabled);
    const secret = senderProfile?.totp_secret || senderProfile?.two_factor_secret;

    if (is2faActive) {
      if (!totpCode) {
        return NextResponse.json({ error: '6-digit Authenticator TOTP code is required' }, { status: 403 });
      }

      const verification = await verifyUserTotpForSensitiveAction(
        admin, user.id, secret, totpCode, 'transfer'
      );
      if (!verification.ok) {
        return NextResponse.json(
          { error: verification.error },
          {
            status: verification.status,
            headers: verification.retryAfterSeconds
              ? { 'Retry-After': String(verification.retryAfterSeconds) }
              : undefined,
          }
        );
      }
    }

    // 3. Resolve recipient: Can be username, profile ID, user's email, or user's deposit address
    let recipientProfile: {
      id: string;
      username: string;
      is_banned?: boolean | null;
      is_restricted?: boolean | null;
      is_suspended?: boolean | null;
      is_minor_restricted?: boolean | null;
      is_emergency_frozen?: boolean | null;
      account_status?: string | null;
      status?: string | null;
    } | null = null;
    const cleanTarget = targetIdentifier.replace(/^@/, '').trim();
    // Treat user input literally in LIKE-based lookups; '%' and '_' otherwise act as wildcards.
    const escapedTargetPattern = cleanTarget.replace(/[\\%_]/g, '\\$&');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTarget);

    // 3a. Check by exact / case-insensitive username in profiles
    const { data: profByUsername } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
      .ilike('username', escapedTargetPattern)
      .maybeSingle();

    if (profByUsername) {
      recipientProfile = profByUsername;
    }

    // 3b. Check if cleanTarget is a valid UUID and matches id
    if (!recipientProfile && isUuid) {
      const { data: profById } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
        .eq('id', cleanTarget)
        .maybeSingle();
      if (profById) {
        recipientProfile = profById;
      }
    }

    // 3c. Check email, then full name using parameterized PostgREST filters.
    // Do not interpolate user input into an .or() filter expression: commas and
    // filter operators in the identifier could change the query's meaning.
    if (!recipientProfile) {
      const { data: profByEmail, error: emailLookupError } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
        .ilike('email', escapedTargetPattern)
        .maybeSingle();
      if (!emailLookupError && profByEmail) {
        recipientProfile = profByEmail;
      }
    }

    if (!recipientProfile) {
      const { data: profByFullName, error: fullNameLookupError } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
        .ilike('full_name', escapedTargetPattern)
        .maybeSingle();
      if (!fullNameLookupError && profByFullName) {
        recipientProfile = profByFullName;
      }
    }

    // 3d. Check if targetIdentifier is a deposit address of another platform user
    if (!recipientProfile) {
      const { data: depAddr } = await admin
        .from('deposit_addresses')
        .select('user_id')
        .eq('address', targetIdentifier)
        .maybeSingle();

      if (depAddr?.user_id) {
        const { data: profByAddr } = await admin
          .from('profiles')
          .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
          .eq('id', depAddr.user_id)
          .maybeSingle();
        if (profByAddr) {
          recipientProfile = profByAddr;
        }
      }
    }

    // 3e. Do not enumerate Auth users or create profiles during a transfer.
    // Recipient profiles must be provisioned by the normal signup/profile workflow.
    // This avoids partial account creation, email-prefix misrouting, and dependence
    // on the first page of the Auth admin user listing.

    if (!recipientProfile) {
      return NextResponse.json({ error: `Recipient "${targetIdentifier}" not found on Paxones.` }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer funds to yourself.' }, { status: 400 });
    }

    // Block recipient if banned, restricted, or emergency frozen
    if (isTransferAccountBlocked(recipientProfile)) {
      return NextResponse.json({
        error: `Cannot transfer: Recipient @${recipientProfile.username} is restricted or frozen on the platform.`,
      }, { status: 403 });
    }

    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile.username || targetIdentifier.replace(/^@/, '');

    let transferFeeRate: number;
    try {
      const feeSettings = await getPlatformFeeSettings();
      transferFeeRate = feeSettings.platformFeePercent / 100;
    } catch (feeError) {
      console.error('[Internal Transfer] Fee settings could not be verified:', feeError);
      return NextResponse.json({
        error: 'Transfer fee settings are temporarily unavailable. Please retry.',
        code: 'TRANSFER_FEE_CONFIG_UNAVAILABLE',
      }, { status: 503 });
    }

    // 4. Delegate atomic transfer, balance updates, ledgering, and transfer recording to canonical database RPC
    const { data: rpcResult, error: rpcError } = await admin.rpc('execute_internal_transfer', {
      p_sender_id: user.id,
      p_recipient_username: recipientProfile.username,
      p_asset: coinSymbol,
      p_gross_amount: numericAmount,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcError) {
      console.error('[Internal Transfer] RPC execute_internal_transfer error:', rpcError);
      return NextResponse.json({
        error: rpcError.message || 'Failed to execute internal transfer.',
        code: rpcError.code || 'TRANSFER_RPC_ERROR',
      }, { status: 400 });
    }

    // Fail closed: Ensure RPC response is valid and explicitly reports success
    interface TransferRpcResponse {
      success?: boolean;
      transfer_id?: string;
      public_id?: string;
      sender_id?: string;
      recipient_id?: string;
      asset?: string;
      gross_amount?: number | string;
      net_amount?: number | string;
      fee_amount?: number | string;
      fee?: number | string;
      total_deduction?: number | string;
      sender_balance_after?: number | string;
      recipient_balance_after?: number | string;
      status?: string;
      idempotent_replay?: boolean;
      error?: string;
    }

    const transferData = rpcResult as TransferRpcResponse | null;

    if (!transferData || transferData.success !== true) {
      const errorMsg = transferData?.error || 'Failed to execute internal transfer.';
      return NextResponse.json({
        error: errorMsg,
        code: 'TRANSFER_REJECTED',
      }, { status: 400 });
    }

    // Verify identity, asset, amount, and all financial fields before reporting success.
    // The database RPC has already committed atomically; this guard prevents a malformed
    // or mismatched result from being presented to the caller as a valid receipt.
    if (!isValidTransferRpcResponse(transferData, {
      senderId: user.id,
      recipientId: recipientProfile.id,
      asset: coinSymbol,
      amount: numericAmount,
      feeRate: transferFeeRate,
    })) {
      console.error('[Internal Transfer] RPC response failed financial integrity validation.');
      return NextResponse.json({
        error: 'Transfer result could not be safely verified. Contact support before retrying.',
        code: 'INVALID_RPC_RESPONSE',
      }, { status: 500 });
    }

    const isIdempotentReplay = Boolean(transferData.idempotent_replay);
    const transferId = String(transferData.public_id || transferData.transfer_id);
    const dbTransferId = String(transferData.transfer_id);
    const grossAmount = Number(transferData.gross_amount);
    const netAmount = Number(transferData.net_amount);
    const feeAmount = Number(transferData.fee_amount);
    const totalDeduction = Number(transferData.total_deduction);
    const senderBalanceAfter = transferData.sender_balance_after != null ? Number(transferData.sender_balance_after) : undefined;
    const recipientBalanceAfter = transferData.recipient_balance_after != null ? Number(transferData.recipient_balance_after) : undefined;
    const transferStatus = String(transferData.status || 'confirmed').toLowerCase();

    // 5. Dispatch confirmation notification for sender only on new transfer (not replay)
    if (!isIdempotentReplay) {
      try {
        await admin.from('notifications').insert({
          user_id: user.id,
          title: 'Transfer Sent',
          message: `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (${(transferFeeRate * 100).toFixed(2)}% Fee: ${feeAmount} ${coinSymbol}, Total Deducted: ${totalDeduction} ${coinSymbol}).`,
          type: 'transfer',
          is_read: false,
          metadata: { link: '/wallet' },
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Sender transfer notification insert notice:', notifErr);
      }
    }

    const message = isIdempotentReplay
      ? `Transfer was already completed previously (ID: ${transferId}).`
      : `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (${(transferFeeRate * 100).toFixed(2)}% Fee: ${feeAmount} ${coinSymbol}, Total Deducted: ${totalDeduction} ${coinSymbol}).`;

    return NextResponse.json({
      success: true,
      idempotentReplay: isIdempotentReplay,
      idempotent_replay: isIdempotentReplay,
      transferId,
      publicId: transferData.public_id || transferId,
      dbTransferId,
      amount: grossAmount,
      grossAmount,
      netAmount,
      fee: feeAmount,
      feeAmount,
      totalDeduction,
      total_deduction: totalDeduction,
      crypto: coinSymbol,
      asset: coinSymbol,
      senderUsername: senderName,
      recipientUsername: recipientName,
      senderBalanceAfter,
      recipientBalanceAfter,
      status: transferStatus,
      message,
    }, { status: 200 });

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Internal server error during transfer';
    console.error('Transfer API route error:', err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

