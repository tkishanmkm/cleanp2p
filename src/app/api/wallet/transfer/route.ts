import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { isTier2User } from '@/lib/kyc';

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
        { error: 'Internal transfers are temporarily unavailable.', code: guardErr.code || 'PLATFORM_TRANSFERS_DISABLED' },
        { status: guardErr.statusCode || 403 }
      );
    }

    const admin = getSupabaseAdminClient();
    const contentLength = req.headers.get('content-length');
    if (contentLength !== null) {
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 16_384) {
        return NextResponse.json({ error: 'Request body is too large or invalid.' }, { status: 413 });
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
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
    } = payload;
    
    const rawRecipient = recipientInput ?? recipientUsername;
    const rawAsset = asset ?? crypto ?? 'USDT';
    if (
      typeof rawRecipient !== 'string' ||
      rawRecipient.length > 320 ||
      typeof rawAsset !== 'string' ||
      rawAsset.length > 20 ||
      (typeof amount !== 'string' && typeof amount !== 'number') ||
      (typeof amount === 'string' && (amount.length > 80 || !/^\d+(?:\.\d+)?$/.test(amount.trim())))
    ) {
      return NextResponse.json({ error: 'Invalid transfer payload types.' }, { status: 400 });
    }
    const targetIdentifier = rawRecipient.trim();
    const coinSymbol = rawAsset.toUpperCase().trim();
    const numericAmount = Number(amount);
    if (!targetIdentifier || targetIdentifier.length > 320 || !coinSymbol || coinSymbol.length > 20 || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > Number.MAX_SAFE_INTEGER) {
      return NextResponse.json({ error: 'Invalid transfer payload. Recipient and positive finite amount required.' }, { status: 400 });
    }

    // Extract and validate client idempotency key
    const headerIdempotencyKey = req.headers.get('x-idempotency-key') || req.headers.get('idempotency-key');
    const suppliedKey = bodyIdempotencyKey ?? idempotency_key ?? requestId ?? headerIdempotencyKey;
    const rawKey = typeof suppliedKey === 'string' && suppliedKey.length <= 128 ? suppliedKey.trim() : '';
    const idempotencyKey = /^[A-Za-z0-9._:-]{8,128}$/.test(rawKey) ? rawKey : null;

    if (!idempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required for transfer execution (must be between 8 and 128 characters).',
        code: 'IDEMPOTENCY_KEY_REQUIRED'
      }, { status: 400 });
    }

    if (!targetIdentifier || !coinSymbol || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Recipient and positive amount required.' }, { status: 400 });
    }

    // 1. Fetch sender profile & check banned / restricted / emergency frozen status
    const { data: senderProfile, error: senderProfileError } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, is_emergency_frozen, account_status, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, is_verified, id_verified, is_id_verified, kyc_status, verification_tier')
      .eq('id', user.id)
      .maybeSingle();

    if (senderProfileError) {
      console.error('[Internal Transfer] Sender security profile lookup failed:', senderProfileError.code);
      return NextResponse.json({
        error: 'Account security status could not be verified. Please try again later.',
        code: 'SECURITY_CHECK_UNAVAILABLE',
      }, { status: 503 });
    }

    if (!senderProfile) {
      return NextResponse.json({ error: 'Sender profile not found.' }, { status: 404 });
    }

    // Normalize status casing so database capitalization cannot bypass sender restrictions.
    const senderAccountStatus = typeof senderProfile.account_status === 'string'
      ? senderProfile.account_status.trim().toLowerCase()
      : '';

    // Block sender if banned, restricted, or emergency frozen.
    if (
      senderProfile.is_banned ||
      senderProfile.is_restricted ||
      senderProfile.is_emergency_frozen ||
      ['suspended', 'banned', 'restricted', 'frozen'].includes(senderAccountStatus)
    ) {
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
      if (typeof secret !== 'string' || secret.trim().length === 0) {
        console.error('[Internal Transfer] 2FA is enabled but the authenticator secret is unavailable.');
        return NextResponse.json({
          error: 'Account security verification is temporarily unavailable. Please try again later.',
          code: 'SECURITY_CHECK_UNAVAILABLE',
        }, { status: 503 });
      }

      if (typeof totpCode !== 'string' || totpCode.length > 16 || !/^\d{4,8}$/.test(totpCode.trim())) {
        return NextResponse.json({ error: 'A valid numeric authenticator code is required' }, { status: 403 });
      }

      const isValidTotp = verify2FAOTP(secret, totpCode.trim(), is2faActive);
      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid authenticator code. Please check your authenticator app.' }, { status: 401 });
      }
    }

    // 3. Resolve recipient: Can be username, profile ID, user's email, or user's deposit address
    let recipientProfile: { id: string; username: string; is_banned?: boolean; is_restricted?: boolean; is_emergency_frozen?: boolean; account_status?: string } | null = null;
    const cleanTarget = targetIdentifier.replace(/^@/, '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTarget);

    // 3a. Check by exact / case-insensitive username in profiles
    const { data: profByUsername, error: usernameLookupError } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, is_emergency_frozen, account_status')
      .eq('username', cleanTarget)
      .maybeSingle();

    if (usernameLookupError) {
      console.error('[Internal Transfer] Recipient username lookup failed:', usernameLookupError.code);
      return NextResponse.json({
        error: 'Recipient security status could not be verified. Please try again later.',
        code: 'RECIPIENT_LOOKUP_UNAVAILABLE',
      }, { status: 503 });
    }

    if (profByUsername) {
      recipientProfile = profByUsername;
    }

    // 3b. Check if cleanTarget is a valid UUID and matches id
    if (!recipientProfile && isUuid) {
      const { data: profById, error: idLookupError } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, is_emergency_frozen, account_status')
        .eq('id', cleanTarget)
        .maybeSingle();
      if (idLookupError) {
        console.error('[Internal Transfer] Recipient ID lookup failed:', idLookupError.code);
        return NextResponse.json({
          error: 'Recipient security status could not be verified. Please try again later.',
          code: 'RECIPIENT_LOOKUP_UNAVAILABLE',
        }, { status: 503 });
      }
      if (profById) {
        recipientProfile = profById;
      }
    }

    // 3c. Check by email or full_name in profiles if still not found
    if (!recipientProfile) {
      const { data: profByEmail, error: emailLookupError } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, is_emergency_frozen, account_status')
        .eq('email', cleanTarget)
        .maybeSingle();
      if (emailLookupError) {
        console.error('[Internal Transfer] Recipient email/name lookup failed:', emailLookupError.code);
        return NextResponse.json({
          error: 'Recipient security status could not be verified. Please try again later.',
          code: 'RECIPIENT_LOOKUP_UNAVAILABLE',
        }, { status: 503 });
      }
      if (profByEmail) {
        recipientProfile = profByEmail;
      }
    }

    // 3d. Check if targetIdentifier is a deposit address of another platform user
    if (!recipientProfile) {
      const { data: depAddr, error: depositAddressLookupError } = await admin
        .from('deposit_addresses')
        .select('user_id')
        .eq('address', targetIdentifier)
        .maybeSingle();

      if (depositAddressLookupError) {
        console.error('[Internal Transfer] Deposit-address recipient lookup failed:', depositAddressLookupError.code);
        return NextResponse.json({
          error: 'Recipient security status could not be verified. Please try again later.',
          code: 'RECIPIENT_LOOKUP_UNAVAILABLE',
        }, { status: 503 });
      }

      if (depAddr?.user_id) {
        const { data: profByAddr, error: addressProfileLookupError } = await admin
          .from('profiles')
          .select('id, username, is_banned, is_restricted, is_emergency_frozen, account_status')
          .eq('id', depAddr.user_id)
          .maybeSingle();
        if (addressProfileLookupError) {
          console.error('[Internal Transfer] Deposit-address profile lookup failed:', addressProfileLookupError.code);
          return NextResponse.json({
            error: 'Recipient security status could not be verified. Please try again later.',
            code: 'RECIPIENT_LOOKUP_UNAVAILABLE',
          }, { status: 503 });
        }
        if (profByAddr) {
          recipientProfile = profByAddr;
        }
      }
    }

    // Transfers require an existing profile resolved by username, UUID, exact email, or deposit address.

    if (!recipientProfile) {
      return NextResponse.json({ error: 'Recipient account was not found.' }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer funds to yourself.' }, { status: 400 });
    }

    // The canonical RPC identifies the recipient by username; do not pass a missing or blank identifier.
    if (typeof recipientProfile.username !== 'string' || recipientProfile.username.trim().length === 0) {
      return NextResponse.json({
        error: 'Recipient account is not eligible to receive transfers.',
        code: 'RECIPIENT_UNAVAILABLE',
      }, { status: 409 });
    }

    // Normalize status casing so database capitalization cannot bypass recipient restrictions.
    const recipientAccountStatus = typeof recipientProfile.account_status === 'string'
      ? recipientProfile.account_status.trim().toLowerCase()
      : '';

    // Block recipient if banned, restricted, or emergency frozen.
    if (
      recipientProfile.is_banned ||
      recipientProfile.is_restricted ||
      recipientProfile.is_emergency_frozen ||
      ['suspended', 'banned', 'restricted', 'frozen'].includes(recipientAccountStatus)
    ) {
      return NextResponse.json({
        error: `Cannot transfer: Recipient @${recipientProfile.username} is restricted or frozen on the platform.`,
      }, { status: 403 });
    }

    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile.username || targetIdentifier.replace(/^@/, '');

    // 4. Delegate atomic transfer, balance updates, ledgering, and transfer recording to canonical database RPC
    const { data: rpcResult, error: rpcError } = await admin.rpc('execute_internal_transfer', {
      p_sender_id: user.id,
      p_recipient_username: recipientProfile.username,
      p_asset: coinSymbol,
      p_gross_amount: numericAmount,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcError) {
      console.error('[Internal Transfer] RPC execute_internal_transfer failed:', {
        code: rpcError.code || 'UNKNOWN',
      });
      return NextResponse.json({
        error: 'Transfer could not be completed. Please verify your details and try again.',
        code: 'TRANSFER_RPC_ERROR',
      }, { status: 503 });
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
      total_deduction?: number | string;
      sender_balance_after?: number | string;
      recipient_balance_after?: number | string;
      status?: string;
      idempotent_replay?: boolean;
      error?: string;
    }

    const transferData = rpcResult as TransferRpcResponse | null;

    if (!transferData || transferData.success !== true) {
      return NextResponse.json({
        error: 'Transfer result could not be confirmed. Please check transfer history before retrying.',
        code: 'TRANSFER_RESULT_UNCONFIRMED',
      }, { status: 503 });
    }

    // Verify critical financial fields are strictly present from the RPC output
    if (
      typeof transferData.transfer_id !== 'string' ||
      transferData.transfer_id.trim().length === 0 ||
      (transferData.public_id !== undefined && transferData.public_id !== null && (typeof transferData.public_id !== 'string' || transferData.public_id.trim().length === 0)) ||
      (typeof transferData.status !== 'string' || transferData.status.trim().length === 0) ||
      (transferData.idempotent_replay !== undefined && typeof transferData.idempotent_replay !== 'boolean') ||
      (transferData.sender_id !== undefined && transferData.sender_id !== user.id) ||
      (transferData.recipient_id !== undefined && transferData.recipient_id !== recipientProfile.id) ||
      (transferData.asset !== undefined && (typeof transferData.asset !== 'string' || transferData.asset.toUpperCase() !== coinSymbol)) ||
      transferData.gross_amount === undefined ||
      transferData.gross_amount === null ||
      transferData.net_amount === undefined ||
      transferData.net_amount === null ||
      transferData.fee_amount === undefined ||
      transferData.fee_amount === null ||
      (transferData.total_deduction !== undefined && transferData.total_deduction !== null &&
        ((typeof transferData.total_deduction !== 'number' && typeof transferData.total_deduction !== 'string') ||
          (typeof transferData.total_deduction === 'string' && transferData.total_deduction.trim().length === 0)))
    ) {
      console.error('[Internal Transfer] Malformed RPC response: required fields missing or invalid.');
      return NextResponse.json({
        error: 'Transfer failed: Incomplete financial response received from database.',
        code: 'INVALID_RPC_RESPONSE',
      }, { status: 503 });
    }

    const isIdempotentReplay = Boolean(transferData.idempotent_replay);
    const transferId = String(transferData.public_id || transferData.transfer_id);
    const dbTransferId = String(transferData.transfer_id);
    const grossAmount = Number(transferData.gross_amount);
    const netAmount = Number(transferData.net_amount);
    const feeAmount = Number(transferData.fee_amount);
    const rawTotalDeduction = transferData.total_deduction;
    const totalDeduction = rawTotalDeduction != null
      ? Number(rawTotalDeduction)
      : Number((grossAmount + feeAmount).toFixed(8));
    const senderBalanceAfter = transferData.sender_balance_after != null ? Number(transferData.sender_balance_after) : undefined;
    const recipientBalanceAfter = transferData.recipient_balance_after != null ? Number(transferData.recipient_balance_after) : undefined;
    const transferStatus = transferData.status.trim().toLowerCase();

    if (
      !Number.isFinite(grossAmount) || grossAmount <= 0 ||
      Math.abs(grossAmount - numericAmount) > 1e-8 ||
      !Number.isFinite(netAmount) || netAmount < 0 ||
      !Number.isFinite(feeAmount) || feeAmount < 0 ||
      !Number.isFinite(totalDeduction) || totalDeduction < 0 ||
      totalDeduction + 1e-8 < grossAmount ||
      (senderBalanceAfter !== undefined && (!Number.isFinite(senderBalanceAfter) || senderBalanceAfter < 0)) ||
      (recipientBalanceAfter !== undefined && (!Number.isFinite(recipientBalanceAfter) || recipientBalanceAfter < 0))
    ) {
      console.error('[Internal Transfer] RPC response contains invalid financial values.');
      return NextResponse.json({
        error: 'Transfer result could not be verified safely.',
        code: 'INVALID_RPC_RESPONSE',
      }, { status: 503 });
    }

    // 5. Dispatch confirmation notification for sender only on new transfer (not replay)
    if (!isIdempotentReplay) {
      try {
        await admin.from('notifications').insert({
          user_id: user.id,
          title: 'Transfer Sent',
          message: `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (Fee: ${feeAmount} ${coinSymbol}, Total Deducted: ${totalDeduction} ${coinSymbol}).`,
          type: 'transfer',
          is_read: false,
          metadata: { link: '/wallet' },
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('[Internal Transfer] Sender notification could not be recorded.');
      }
    }

    const message = isIdempotentReplay
      ? `Transfer was already completed previously (ID: ${transferId}).`
      : `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (Fee: ${feeAmount} ${coinSymbol}, Total Deducted: ${totalDeduction} ${coinSymbol}).`;

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
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    console.error('Transfer API route failed:', { errorName });
    return NextResponse.json(
      { error: 'Transfer request could not be processed. Please try again later.' },
      { status: 500 }
    );
  }
}

