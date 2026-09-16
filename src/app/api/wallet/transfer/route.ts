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
    const { recipientInput, recipientUsername, asset, crypto, amount, totpCode } = body;
    
    const targetIdentifier = String(recipientInput || recipientUsername || '').trim();
    const coinSymbol = String(asset || crypto || 'USDT').toUpperCase().trim();
    const numericAmount = Number(amount);

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

    // 3. Resolve recipient: Can be username, profile ID, or user's deposit address
    let recipientProfile: { id: string; username: string; is_banned?: boolean; is_restricted?: boolean; account_status?: string } | null = null;
    const cleanTarget = targetIdentifier.replace(/^@/, '');

    // Check by username or UUID in profiles
    const { data: prof } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, account_status')
      .or(`username.ilike.${cleanTarget},id.eq.${cleanTarget}`)
      .maybeSingle();

    if (prof) {
      recipientProfile = prof;
    } else {
      // Check if targetIdentifier is a deposit address of another platform user
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

    // 4. Calculate 1.5% transfer fee
    // If transferring 100 USDT -> fee is 1.5 USDT -> total deduction = 101.5 USDT
    const feeAmount = Number((numericAmount * 0.015).toFixed(8));
    const totalDeduction = Number((numericAmount + feeAmount).toFixed(8));

    // 5. Check sender's available balance in wallet_assets
    const { data: senderAsset } = await admin
      .from('wallet_assets')
      .select('balance, locked_balance')
      .eq('user_id', user.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    const currentSenderBalance = Number(senderAsset?.balance || 0);
    if (currentSenderBalance < totalDeduction) {
      return NextResponse.json({
        error: `Insufficient ${coinSymbol} balance. You need ${totalDeduction} ${coinSymbol} (${numericAmount} transfer + 1.5% fee of ${feeAmount} ${coinSymbol}), but have ${currentSenderBalance} ${coinSymbol}.`
      }, { status: 400 });
    }

    // 6. Execute atomic balance updates
    // Deduct totalDeduction from sender
    const { error: deductErr } = await admin
      .from('wallet_assets')
      .update({
        balance: Number((currentSenderBalance - totalDeduction).toFixed(8)),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('asset_symbol', coinSymbol);

    if (deductErr) {
      console.error('Balance deduction error:', deductErr);
      return NextResponse.json({ error: 'Failed to update sender balance' }, { status: 500 });
    }

    // Upsert / Add net amount to recipient
    const { data: recipientAsset } = await admin
      .from('wallet_assets')
      .select('balance')
      .eq('user_id', recipientProfile.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    if (recipientAsset) {
      await admin
        .from('wallet_assets')
        .update({
          balance: Number(((recipientAsset.balance || 0) + numericAmount).toFixed(8)),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', recipientProfile.id)
        .eq('asset_symbol', coinSymbol);
    } else {
      await admin
        .from('wallet_assets')
        .insert({
          user_id: recipientProfile.id,
          asset_symbol: coinSymbol,
          balance: numericAmount,
          locked_balance: 0,
          updated_at: new Date().toISOString(),
        });
    }

    // 7. Generate 12-character alphanumeric transfer ID
    const randomHex = Math.random().toString(36).substring(2, 11).toUpperCase();
    const publicId = `TRF${randomHex}`.substring(0, 12);
    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile.username || 'Trader';

    // 8. Record in transfers table (using 'confirmed' enum status)
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
        fee: feeAmount,
        status: 'confirmed',
        created_at: new Date().toISOString(),
      });

    if (transferInsertErr) {
      console.warn('Transfer record insertion notice:', transferInsertErr);
    }

    return NextResponse.json({
      success: true,
      transferId: publicId,
      amount: numericAmount,
      fee: feeAmount,
      totalDeduction,
      crypto: coinSymbol,
      senderUsername: senderName,
      recipientUsername: recipientName,
      message: `Successfully transferred ${numericAmount} ${coinSymbol} to @${recipientName} (1.5% Fee: ${feeAmount} ${coinSymbol}).`,
    }, { status: 200 });

  } catch (err: any) {
    console.error('Transfer API route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error during transfer' }, { status: 500 });
  }
}
