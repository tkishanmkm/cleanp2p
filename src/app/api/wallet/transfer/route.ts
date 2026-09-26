import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Extract or generate cryptographically secure idempotency key
    const headerIdempotencyKey = req.headers.get('x-idempotency-key') || req.headers.get('idempotency-key');
    const rawKey = String(bodyIdempotencyKey || idempotency_key || requestId || headerIdempotencyKey || '').trim();
    const idempotencyKey = rawKey && rawKey.length >= 8 && rawKey.length <= 128 ? rawKey : globalThis.crypto.randomUUID();

    if (!targetIdentifier || !coinSymbol || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Recipient and positive amount required.' }, { status: 400 });
    }

    // 1. Fetch sender profile & check banned / restricted status
    const { data: senderProfile } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, account_status, is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    if (!senderProfile) {
      return NextResponse.json({ error: 'Sender profile not found.' }, { status: 404 });
    }

    // Block sender if banned or restricted
    if (
      senderProfile.is_banned ||
      senderProfile.is_restricted ||
      senderProfile.account_status === 'suspended' ||
      senderProfile.account_status === 'banned' ||
      senderProfile.account_status === 'restricted'
    ) {
      return NextResponse.json({
        error: 'Your account is restricted or banned. You cannot send or receive transfers.',
      }, { status: 403 });
    }

    // 2. Conditional 2FA check (only if enabled on sender profile)
    const is2faActive = Boolean(senderProfile?.is_2fa_enabled || senderProfile?.is_mfa_enabled);
    const secret = senderProfile?.two_factor_secret || senderProfile?.security_answer_hash;

    if (is2faActive) {
      if (!totpCode || typeof totpCode !== 'string' || totpCode.trim().length < 4) {
        return NextResponse.json({ error: '6-digit Authenticator TOTP code is required' }, { status: 403 });
      }

      const isValidTotp = verify2FAOTP(secret, totpCode.trim(), is2faActive);
      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid authenticator code. Please check your authenticator app.' }, { status: 401 });
      }
    }

    // 3. Resolve recipient: Can be username, profile ID, user's email, or user's deposit address
    let recipientProfile: { id: string; username: string; is_banned?: boolean; is_restricted?: boolean; account_status?: string } | null = null;
    const cleanTarget = targetIdentifier.replace(/^@/, '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTarget);

    // 3a. Check by exact / case-insensitive username in profiles
    const { data: profByUsername } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, account_status')
      .ilike('username', cleanTarget)
      .maybeSingle();

    if (profByUsername) {
      recipientProfile = profByUsername;
    }

    // 3b. Check if cleanTarget is a valid UUID and matches id
    if (!recipientProfile && isUuid) {
      const { data: profById } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, account_status')
        .eq('id', cleanTarget)
        .maybeSingle();
      if (profById) {
        recipientProfile = profById;
      }
    }

    // 3c. Check by email or full_name in profiles if still not found
    if (!recipientProfile) {
      const { data: profByEmail } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, account_status')
        .or(`email.ilike.${cleanTarget},full_name.ilike.${cleanTarget}`)
        .maybeSingle();
      if (profByEmail) {
        recipientProfile = profByEmail;
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
          .select('id, username, is_banned, is_restricted, account_status')
          .eq('id', depAddr.user_id)
          .maybeSingle();
        if (profByAddr) {
          recipientProfile = profByAddr;
        }
      }
    }

    // 3e. If still not found, check Supabase Auth admin to see if user exists in auth.users by email or username
    if (!recipientProfile) {
      try {
        const { data: authData } = await admin.auth.admin.listUsers();
        if (authData?.users) {
          const matchedAuthUser = authData.users.find((u) => {
            const email = u.email?.toLowerCase() || '';
            const emailPrefix = email.split('@')[0];
            const metaUsername = (u.user_metadata?.username || '').toLowerCase();
            const targetLower = cleanTarget.toLowerCase();
            return (
              email === targetLower ||
              emailPrefix === targetLower ||
              metaUsername === targetLower ||
              u.id === cleanTarget
            );
          });

          if (matchedAuthUser) {
            // Find or insert profile for this user
            const { data: existingProf } = await admin
              .from('profiles')
              .select('id, username, is_banned, is_restricted, account_status')
              .eq('id', matchedAuthUser.id)
              .maybeSingle();

            if (existingProf) {
              recipientProfile = existingProf;
            } else {
              // Auto-create/upsert basic profile so transfer succeeds seamlessly
              const fallbackUsername = matchedAuthUser.user_metadata?.username || matchedAuthUser.email?.split('@')[0] || `user_${matchedAuthUser.id.slice(0, 6)}`;
              const { data: newProf } = await admin
                .from('profiles')
                .upsert({
                  id: matchedAuthUser.id,
                  username: fallbackUsername,
                  email: matchedAuthUser.email,
                  account_status: 'ACTIVE',
                })
                .select('id, username, is_banned, is_restricted, account_status')
                .single();

              if (newProf) {
                recipientProfile = newProf;
              }
            }
          }
        }
      } catch (authLookupErr) {
        console.warn('Auth user search fallback notice in transfer:', authLookupErr);
      }
    }

    if (!recipientProfile) {
      return NextResponse.json({ error: `Recipient "${targetIdentifier}" not found on Paxones.` }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer funds to yourself.' }, { status: 400 });
    }

    // Block recipient if banned or restricted
    if (
      recipientProfile.is_banned ||
      recipientProfile.is_restricted ||
      recipientProfile.account_status === 'suspended' ||
      recipientProfile.account_status === 'banned' ||
      recipientProfile.account_status === 'restricted'
    ) {
      return NextResponse.json({
        error: `Cannot transfer: Recipient @${recipientProfile.username} is banned or restricted on the platform.`,
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

    // Verify critical financial fields are strictly present from the RPC output
    if (
      !transferData.transfer_id ||
      transferData.gross_amount === undefined ||
      transferData.gross_amount === null ||
      transferData.net_amount === undefined ||
      transferData.net_amount === null ||
      transferData.fee_amount === undefined ||
      transferData.fee_amount === null
    ) {
      console.error('[Internal Transfer] Malformed RPC response missing financial fields:', transferData);
      return NextResponse.json({
        error: 'Transfer failed: Incomplete financial response received from database.',
        code: 'INVALID_RPC_RESPONSE',
      }, { status: 500 });
    }

    const isIdempotentReplay = Boolean(transferData.idempotent_replay);
    const transferId = String(transferData.public_id || transferData.transfer_id);
    const dbTransferId = String(transferData.transfer_id);
    const grossAmount = Number(transferData.gross_amount);
    const netAmount = Number(transferData.net_amount);
    const feeAmount = Number(transferData.fee_amount);
    const senderBalanceAfter = transferData.sender_balance_after != null ? Number(transferData.sender_balance_after) : undefined;
    const recipientBalanceAfter = transferData.recipient_balance_after != null ? Number(transferData.recipient_balance_after) : undefined;
    const transferStatus = String(transferData.status || 'completed').toLowerCase();

    // 5. Dispatch confirmation notification for sender only on new transfer (not replay)
    if (!isIdempotentReplay) {
      try {
        await admin.from('notifications').insert({
          user_id: user.id,
          title: 'Transfer Sent',
          message: `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (Net: ${netAmount} ${coinSymbol}, 1.5% Fee: ${feeAmount} ${coinSymbol}).`,
          link: '/wallet',
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Sender transfer notification insert notice:', notifErr);
      }
    }

    const message = isIdempotentReplay
      ? `Transfer was already completed previously (ID: ${transferId}).`
      : `Successfully transferred ${grossAmount} ${coinSymbol} to @${recipientName} (Net: ${netAmount} ${coinSymbol}, 1.5% Fee: ${feeAmount} ${coinSymbol}).`;

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
      totalDeduction: grossAmount,
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

