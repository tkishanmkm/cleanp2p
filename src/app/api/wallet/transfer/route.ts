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

    // 0. Withdrawal Queue Freeze Check
    const { count: pendingWithdrawals } = await admin
      .from('hot_wallet_withdrawals')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['PENDING', 'PROCESSING', 'QUEUED']);

    if (pendingWithdrawals && pendingWithdrawals > 0) {
      return NextResponse.json(
        { error: 'ACCOUNT_RESTRICTED: You have an active withdrawal in progress. Internal transfers are disabled until completed.' },
        { status: 403 }
      );
    }

    const { recipientUsername, asset, crypto, amount, totpCode } = await req.json();
    const coinSymbol = String(asset || crypto || '').toUpperCase().trim();
    const numericAmount = Number(amount);

    if (!recipientUsername || !coinSymbol || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Amount must be positive.' }, { status: 400 });
    }

    // 1. Fetch sender profile
    const { data: senderProfile } = await admin
      .from('profiles')
      .select('id, username, is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    // 2. Conditional 2FA check (only if enabled)
    const is2faActive = Boolean(senderProfile?.is_2fa_enabled || senderProfile?.is_mfa_enabled);
    const secret = senderProfile?.two_factor_secret || senderProfile?.security_answer_hash;

    if (is2faActive) {
      if (!totpCode || typeof totpCode !== 'string' || totpCode.trim().length < 4) {
        return NextResponse.json({ error: '6-digit Authenticator TOTP code is required' }, { status: 403 });
      }

      const isValidTotp = verify2FAOTP(secret, totpCode.trim(), is2faActive);

      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid authenticator code. Please check your app.' }, { status: 401 });
      }
    }

    // 3. Find recipient by username or id
    const cleanRecipient = recipientUsername.trim().replace(/^@/, '');
    const { data: recipientProfile, error: recipientErr } = await admin
      .from('profiles')
      .select('id, username, is_banned, account_status')
      .or(`username.ilike.${cleanRecipient},id.eq.${cleanRecipient}`)
      .maybeSingle();

    if (recipientErr || !recipientProfile) {
      return NextResponse.json({ error: `Recipient user "${recipientUsername}" not found.` }, { status: 404 });
    }

    if (recipientProfile.is_banned || recipientProfile.account_status === 'suspended') {
      return NextResponse.json({ error: 'Recipient account is restricted and cannot receive funds.' }, { status: 400 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer coins to yourself.' }, { status: 400 });
    }

    // 4. Calculate 1.5% Fee
    const feeAmount = Number((numericAmount * 0.015).toFixed(8));
    const totalDeduction = Number((numericAmount + feeAmount).toFixed(8));

    // 5. Execute PostgreSQL Atomic RPC
    const { data: rpcData, error: rpcError } = await admin.rpc('execute_internal_transfer', {
      p_sender_id: user.id,
      p_recipient_id: recipientProfile.id,
      p_asset: coinSymbol,
      p_net_amount: numericAmount,
      p_fee_amount: feeAmount,
      p_total_deduction: totalDeduction,
    });

    if (rpcError) {
      console.error('RPC execute_internal_transfer error:', rpcError);
      return NextResponse.json({ error: rpcError.message || 'Transfer failed' }, { status: 400 });
    }

    // 6. Record transaction in transfers table
    const publicId = `TX-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile?.username || 'Trader';

    const { error: transferInsertErr } = await admin
      .from('transfers')
      .insert({
        public_id: publicId,
        sender_id: user.id,
        sender_username: senderName,
        recipient_id: recipientProfile.id,
        recipient_username: recipientName,
        crypto: coinSymbol,
        amount: numericAmount,
        fee_amount: feeAmount,
        status: 'completed',
        created_at: new Date().toISOString(),
      });

    if (transferInsertErr) {
      console.warn('Transfer record insert notice:', transferInsertErr);
    }

    return NextResponse.json({
      success: true,
      transferId: publicId,
      amount: numericAmount,
      feeAmount,
      crypto: coinSymbol,
      senderUsername: senderName,
      recipientUsername: recipientName,
      message: `Successfully transferred ${numericAmount} ${coinSymbol} to @${recipientName} (Fee: ${feeAmount} ${coinSymbol})`,
    }, { status: 200 });
  } catch (err: any) {
    console.error('Transfer route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error during transfer' }, { status: 500 });
  }
}
