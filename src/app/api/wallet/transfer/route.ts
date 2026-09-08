import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifySync } from 'otplib';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recipientUsername, assetSymbol, amount, totpCode } = await req.json();

    const transferAmount = Number(amount);
    if (!recipientUsername || !assetSymbol || isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer parameters provided' }, { status: 400 });
    }

    const normalizedAsset = String(assetSymbol).trim().toUpperCase();
    const targetUsername = String(recipientUsername).trim().replace(/^@/, '');

    // Check TOTP 2FA if enabled on profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, is_2fa_enabled, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.username && profile.username.toLowerCase() === targetUsername.toLowerCase()) {
      return NextResponse.json({ error: 'You cannot transfer funds to yourself' }, { status: 400 });
    }

    if (profile?.is_2fa_enabled) {
      if (!totpCode) {
        return NextResponse.json({ error: 'TOTP 2FA code is required' }, { status: 402 });
      }
      if (!profile.two_factor_secret) {
        return NextResponse.json({ error: '2FA secret not configured' }, { status: 400 });
      }
      const isValid = verifySync({ token: String(totpCode).trim(), secret: profile.two_factor_secret });
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 400 });
      }
    }

    // Call atomic stored procedure
    const { data: rpcResult, error: rpcError } = await supabase.rpc('execute_internal_transfer', {
      p_sender_id: user.id,
      p_recipient_username: targetUsername,
      p_asset_symbol: normalizedAsset,
      p_amount: transferAmount,
    });

    if (!rpcError && rpcResult) {
      if (!rpcResult.success) {
        return NextResponse.json({ error: rpcResult.error || 'Transfer failed' }, { status: 400 });
      }
      return NextResponse.json({ success: true, data: rpcResult });
    }

    // Fallback direct execution if database function not yet migrated in current environment
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', targetUsername)
      .maybeSingle();

    if (!recipientProfile) {
      return NextResponse.json({ error: `Recipient @${targetUsername} not found` }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'Cannot transfer to yourself' }, { status: 400 });
    }

    // Calculate 1.5% fee
    const feeAmount = Number(((transferAmount * 1.5) / 100).toFixed(8));
    const netAmount = Number((transferAmount - feeAmount).toFixed(8));

    // Check sender balance
    const { data: senderAsset } = await supabase
      .from('wallet_assets')
      .select('id, available, balance, amount')
      .eq('user_id', user.id)
      .eq('asset_symbol', normalizedAsset)
      .maybeSingle();

    const currentSenderAvail = Number(senderAsset?.available ?? senderAsset?.balance ?? senderAsset?.amount ?? 0);
    if (currentSenderAvail < transferAmount) {
      return NextResponse.json({ error: `Insufficient ${normalizedAsset} balance for transfer and 1.5% fee` }, { status: 400 });
    }

    // Deduct from sender
    if (senderAsset?.id) {
      await supabase
        .from('wallet_assets')
        .update({
          available: currentSenderAvail - transferAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', senderAsset.id);
    }

    // Credit to recipient
    const { data: recipientAsset } = await supabase
      .from('wallet_assets')
      .select('id, available, balance, amount')
      .eq('user_id', recipientProfile.id)
      .eq('asset_symbol', normalizedAsset)
      .maybeSingle();

    if (recipientAsset?.id) {
      const recipientAvail = Number(recipientAsset.available ?? recipientAsset.balance ?? recipientAsset.amount ?? 0);
      await supabase
        .from('wallet_assets')
        .update({
          available: recipientAvail + netAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipientAsset.id);
    } else {
      await supabase
        .from('wallet_assets')
        .insert({
          user_id: recipientProfile.id,
          asset_symbol: normalizedAsset,
          available: netAmount,
          locked: 0,
        });
    }

    // Record internal transfer transaction
    try {
      await supabase.from('internal_transfers').insert({
        sender_id: user.id,
        recipient_id: recipientProfile.id,
        asset_symbol: normalizedAsset,
        gross_amount: transferAmount,
        fee_amount: feeAmount,
        net_amount: netAmount,
      });
    } catch (e) {
      console.warn('Failed to insert into internal_transfers log:', e);
    }

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        recipient: recipientProfile.username,
        gross_amount: transferAmount,
        fee_amount: feeAmount,
        net_amount: netAmount,
        asset_symbol: normalizedAsset,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Internal server error occurred' }, { status: 500 });
  }
}
