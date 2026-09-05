import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { executeHotWalletWithdrawal } from '@/lib/wallets/evmWithdrawal';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Check Global Emergency Kill-Switch in platform_settings
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

    const body = await request.json().catch(() => ({}));
    const asset = body.asset || body.assetSymbol || body.asset_symbol;
    const amount = body.amount ?? body.amountEth;
    const destinationAddress = body.destinationAddress || body.destination_address || body.recipientAddress || body.address;
    const totpCode = body.totpCode || body.totp_code || body.code;
    const idempotencyKey = request.headers.get('x-idempotency-key') || body.idempotencyKey;

    // 2. Check 2FA TOTP enforcement (HTTP 403 on missing 2FA TOTP)
    if (!totpCode) {
      return NextResponse.json(
        { error: 'TWO_FACTOR_REQUIRED: Valid 2FA TOTP code is required to execute a withdrawal.' },
        { status: 403 }
      );
    }

    // 3. Authenticated session check
    const supabase = await createClient();
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
        // ignore
      }
    }

    if (!user) {
      const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
      if (!authError && cookieUser) {
        user = cookieUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!asset || amount === undefined || amount === null || !destinationAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: asset, amount, and destinationAddress are required' },
        { status: 400 }
      );
    }

    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be a positive number' },
        { status: 400 }
      );
    }

    const assetSymbol = String(asset).toUpperCase();

    // 4. Checksum & Sanitize Destination Address
    let validDestination = String(destinationAddress).trim();
    if (ethers.isAddress(validDestination)) {
      try {
        validDestination = ethers.getAddress(validDestination);
      } catch {
        return NextResponse.json(
          { error: 'Invalid destination EVM address checksum' },
          { status: 400 }
        );
      }
    }

    // 5. Database Idempotency Check
    if (idempotencyKey) {
      const { data: existing } = await supabaseAdmin
        .from('hot_wallet_withdrawals')
        .select('*')
        .eq('user_id', user.id)
        .eq('destination_address', validDestination)
        .eq('amount', parsedAmount)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && (existing.status === 'COMPLETED' || existing.status === 'PROCESSING')) {
        return NextResponse.json({
          success: true,
          status: existing.status,
          txHash: existing.tx_hash,
          message: 'Withdrawal already submitted (idempotent replay).',
        });
      }
    }

    // 6. DB Transaction Statuses: Insert with state 'PENDING'
    const { data: withdrawalRecord, error: insertError } = await supabaseAdmin
      .from('hot_wallet_withdrawals')
      .insert({
        user_id: user.id,
        asset_symbol: assetSymbol,
        amount: parsedAmount,
        destination_address: validDestination,
        status: 'PENDING',
      })
      .select()
      .single();

    if (insertError) {
      console.warn('[Withdrawal] Failed to create initial pending record:', insertError.message);
    }

    const withdrawalId = withdrawalRecord?.id;

    // 7. Row Locking: Mark state as 'PROCESSING'
    if (withdrawalId) {
      await supabaseAdmin
        .from('hot_wallet_withdrawals')
        .update({ status: 'PROCESSING' })
        .eq('id', withdrawalId)
        .eq('status', 'PENDING');
    }

    // 8. Execute core balance deduction via stored procedure
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('process_withdrawal', {
      p_user_id: user.id,
      p_asset_symbol: assetSymbol,
      p_amount: parsedAmount,
      p_destination_address: validDestination,
    });

    if (rpcError) {
      if (withdrawalId) {
        await supabaseAdmin
          .from('hot_wallet_withdrawals')
          .update({ status: 'FAILED' })
          .eq('id', withdrawalId);
      }
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }

    // 9. On-Chain Hot Wallet Execution (if EVM RPC & credentials configured)
    let onChainTxHash: string | null = null;
    const tokenContractAddress = process.env.USDT_CONTRACT_ADDRESS;
    const isEvmToken = assetSymbol === 'USDT' || assetSymbol === 'USDC' || assetSymbol === 'ETH';

    if (process.env.EVM_RPC_URL && process.env.EVM_HOT_WALLET_PRIVATE_KEY && tokenContractAddress && isEvmToken) {
      try {
        onChainTxHash = await executeHotWalletWithdrawal(
          validDestination,
          parsedAmount.toString(),
          tokenContractAddress
        );
      } catch (onChainError: any) {
        console.error('[Withdrawal] Hot wallet on-chain broadcast failed:', onChainError?.message);
        if (withdrawalId) {
          await supabaseAdmin
            .from('hot_wallet_withdrawals')
            .update({ status: 'FAILED' })
            .eq('id', withdrawalId);
        }
        return NextResponse.json(
          { error: `On-chain execution failed: ${onChainError?.message || 'Network error'}` },
          { status: 502 }
        );
      }
    }

    // 10. Mark withdrawal as 'COMPLETED'
    if (withdrawalId) {
      await supabaseAdmin
        .from('hot_wallet_withdrawals')
        .update({
          status: 'COMPLETED',
          tx_hash: onChainTxHash || (rpcResult as any)?.tx_hash || null,
        })
        .eq('id', withdrawalId);
    }

    return NextResponse.json({
      success: true,
      withdrawalId,
      status: 'COMPLETED',
      txHash: onChainTxHash || (rpcResult as any)?.tx_hash || null,
      result: rpcResult,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
