import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Chain-specific bundled fees (Sweeping Cost + Dispatch Cost)
const NETWORK_WITHDRAWAL_FEES: Record<string, { feeUsdt: number; minWithdrawal: number }> = {
  TRON: { feeUsdt: 5.0, minWithdrawal: 10.0 },      // Covers ~30 TRX sweep + ~30 TRX dispatch
  TRC20: { feeUsdt: 5.0, minWithdrawal: 10.0 },
  BSC: { feeUsdt: 1.5, minWithdrawal: 5.0 },        // Covers BNB sweeping + dispatch
  BEP20: { feeUsdt: 1.5, minWithdrawal: 5.0 },
  ETHEREUM: { feeUsdt: 12.0, minWithdrawal: 25.0 },  // Covers high ETH gas fees
  ERC20: { feeUsdt: 12.0, minWithdrawal: 25.0 },
};

export async function POST(req: Request) {
  try {
    const { userId, amountUsdt, destinationAddress, chain } = await req.json();

    const normalizedChain = (chain || '').toUpperCase().trim();
    const config = NETWORK_WITHDRAWAL_FEES[normalizedChain];
    if (!config) {
      return NextResponse.json({ error: 'Unsupported network chain' }, { status: 400 });
    }

    if (!amountUsdt || amountUsdt < config.minWithdrawal) {
      return NextResponse.json({ 
        error: `Minimum withdrawal for ${chain} is ${config.minWithdrawal} USDT` 
      }, { status: 400 });
    }

    if (!destinationAddress) {
      return NextResponse.json({ error: 'Destination address is required' }, { status: 400 });
    }

    // Calculate Net Payout (Fee covers both deposit sweep & withdrawal gas)
    const withdrawalFee = config.feeUsdt;
    const netPayoutAmount = amountUsdt - withdrawalFee;

    // 1. Fetch user balance
    let availableBalance = 0;
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('balance_usdt')
      .eq('id', userId)
      .single();

    if (!userErr && user && typeof user.balance_usdt === 'number') {
      availableBalance = user.balance_usdt;
    } else {
      // Fallback: Query wallet_assets for active wallet
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (wallet) {
        const { data: asset } = await supabaseAdmin
          .from('wallet_assets')
          .select('available')
          .eq('wallet_id', wallet.id)
          .eq('asset_code', 'USDT')
          .maybeSingle();
        availableBalance = Number(asset?.available || 0);
      }
    }

    if (availableBalance < amountUsdt) {
      return NextResponse.json({ error: 'Insufficient account balance' }, { status: 400 });
    }

    // 2. Deduct full amount from user balance & record withdrawal request
    let { data: rpcResult, error: txErr } = await supabaseAdmin.rpc('process_withdrawal_request', {
      p_user_id: userId,
      p_gross_amount: amountUsdt,
      p_fee: withdrawalFee,
      p_net_payout: netPayoutAmount,
      p_chain: normalizedChain,
      p_destination: destinationAddress,
    });

    if (txErr) {
      // Fallback to request_withdrawal if process_withdrawal_request RPC is not yet loaded in DB
      const fallback = await supabaseAdmin.rpc('request_withdrawal', {
        p_user_id: userId,
        p_network: normalizedChain,
        p_to_address: destinationAddress,
        p_amount: netPayoutAmount,
        p_fee: withdrawalFee,
        p_asset: 'USDT',
      });

      if (fallback.error) {
        throw txErr;
      }
      rpcResult = fallback.data;
    }

    return NextResponse.json({
      success: true,
      message: 'Withdrawal queued successfully',
      withdrawalId: rpcResult,
      grossRequested: amountUsdt,
      feeDeducted: withdrawalFee,
      netPayout: netPayoutAmount,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
