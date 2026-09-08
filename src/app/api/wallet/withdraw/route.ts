import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();

    // 0. Check Global Emergency Kill-Switch in platform_settings
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('global_kill_switch_active, withdrawals_enabled')
      .eq('id', 1)
      .maybeSingle();

    if (settings && (settings.global_kill_switch_active || !settings.withdrawals_enabled)) {
      return NextResponse.json(
        { error: 'EMERGENCY_PAUSE: Withdrawals are temporarily disabled for system maintenance.' },
        { status: 503 }
      );
    }

    const supabase = await createClient();

    // 1. Check authenticated user session
    let user: any = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data?.user) {
          user = data.user;
        }
      } catch {
        // Fallback to cookie check
      }
    }

    if (!user) {
      const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
      if (!authError && cookieUser) {
        user = cookieUser;
      }
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const asset = body.asset || body.assetSymbol || body.asset_symbol;
    const amount = body.amount ?? body.amountEth;
    const destinationAddress = body.destinationAddress || body.destination_address || body.destinationAddressOrUsername || body.recipientAddress || body.address;

    if (!asset || amount === undefined || amount === null || !destinationAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: asset, amount, and destinationAddress are required' },
        { status: 400 }
      );
    }

    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number' },
        { status: 400 }
      );
    }

    const assetSymbol = String(asset).toUpperCase();
    const destStr = String(destinationAddress).trim();
    const cleanDestUsername = destStr.replace(/^@/, '');

    // 2. SMART ROUTING CHECK: Check if destination matches an internal Paxones user
    const { data: internalUser } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .or(`username.ilike.${cleanDestUsername},deposit_address.eq.${destStr},btc_deposit_address.eq.${destStr},eth_deposit_address.eq.${destStr},tron_deposit_address.eq.${destStr},ltc_deposit_address.eq.${destStr}`)
      .maybeSingle();

    if (internalUser && internalUser.username) {
      if (internalUser.id === user.id) {
        return NextResponse.json(
          { success: false, error: 'Cannot transfer or withdraw to your own account address.' },
          { status: 400 }
        );
      }

      // Re-route to internal transfer flow with 1.5% fee
      const { data: rpcData, error: rpcError } = await supabase.rpc('execute_internal_transfer', {
        p_sender_id: user.id,
        p_recipient_username: internalUser.username,
        p_asset_symbol: assetSymbol,
        p_amount: parsedAmount,
      });

      if (!rpcError && rpcData) {
        if (!rpcData.success) {
          return NextResponse.json({ success: false, error: rpcData.error || 'Transfer failed' }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          type: 'INTERNAL_TRANSFER',
          message: `Destination belongs to Paxones user @${internalUser.username}. Processed as Instant Internal Transfer with 1.5% fee.`,
          data: rpcData,
        });
      }

      // Fallback direct execution if database RPC pending migration
      const feeAmount = Number(((parsedAmount * 1.5) / 100).toFixed(8));
      const netAmount = Number((parsedAmount - feeAmount).toFixed(8));

      const { data: senderWallet } = await supabaseAdmin
        .from('wallet_assets')
        .select('id, available, balance, amount')
        .eq('user_id', user.id)
        .eq('asset_symbol', assetSymbol)
        .maybeSingle();

      const senderAvail = Number(senderWallet?.available ?? senderWallet?.balance ?? senderWallet?.amount ?? 0);
      if (senderAvail < parsedAmount) {
        return NextResponse.json({ success: false, error: `Insufficient ${assetSymbol} balance` }, { status: 400 });
      }

      // Deduct from sender
      if (senderWallet?.id) {
        await supabaseAdmin
          .from('wallet_assets')
          .update({
            available: senderAvail - parsedAmount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', senderWallet.id);
      }

      // Credit recipient
      const { data: recipientWallet } = await supabaseAdmin
        .from('wallet_assets')
        .select('id, available, balance, amount')
        .eq('user_id', internalUser.id)
        .eq('asset_symbol', assetSymbol)
        .maybeSingle();

      if (recipientWallet?.id) {
        const rAvail = Number(recipientWallet.available ?? recipientWallet.balance ?? recipientWallet.amount ?? 0);
        await supabaseAdmin
          .from('wallet_assets')
          .update({
            available: rAvail + netAmount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipientWallet.id);
      } else {
        await supabaseAdmin
          .from('wallet_assets')
          .insert({
            user_id: internalUser.id,
            asset_symbol: assetSymbol,
            available: netAmount,
            locked: 0,
          });
      }

      try {
        await supabaseAdmin.from('internal_transfers').insert({
          sender_id: user.id,
          recipient_id: internalUser.id,
          asset_symbol: assetSymbol,
          gross_amount: parsedAmount,
          fee_amount: feeAmount,
          net_amount: netAmount,
        });
      } catch (e) {
        console.warn('Transfer log insert fallback:', e);
      }

      return NextResponse.json({
        success: true,
        type: 'INTERNAL_TRANSFER',
        message: `Destination belongs to Paxones user @${internalUser.username}. Processed as Instant Internal Transfer with 1.5% fee.`,
        data: {
          recipient: internalUser.username,
          gross_amount: parsedAmount,
          fee_amount: feeAmount,
          net_amount: netAmount,
          asset_symbol: assetSymbol,
        },
      });
    }

    // 3. Standard on-chain withdrawal
    const { data, error } = await supabase.rpc('process_withdrawal', {
      p_user_id: user.id,
      p_asset_symbol: assetSymbol,
      p_amount: parsedAmount,
      p_destination_address: destStr,
    });

    if (error) {
      if (error.message?.includes('function process_withdrawal') || error.code === '42883') {
        const { data: adminRpcData, error: adminRpcError } = await supabaseAdmin.rpc('process_withdrawal', {
          p_user_id: user.id,
          p_asset_symbol: assetSymbol,
          p_amount: parsedAmount,
          p_destination_address: destStr,
        });

        if (adminRpcError) {
          return NextResponse.json({ success: false, error: adminRpcError.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, type: 'ON_CHAIN_WITHDRAWAL', result: adminRpcData });
      }

      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, type: 'ON_CHAIN_WITHDRAWAL', result: data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
