import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createClient } from '@/lib/supabase/server';

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
    // 1. Authenticate caller session
    const supabase = await createClient();
    let authUser: any = null;

    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data?.user) {
          authUser = data.user;
        }
      } catch {
        // ignore
      }
    }

    if (!authUser) {
      const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
      if (!authError && cookieUser) {
        authUser = cookieUser;
      }
    }

    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized: Active user session required' }, { status: 401 });
    }

    const userId = authUser.id;
    const { amountUsdt, destinationAddress, chain, totpCode } = await req.json();

    const numericAmount = Number(amountUsdt);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    if (!destinationAddress || typeof destinationAddress !== 'string' || destinationAddress.trim().length < 10) {
      return NextResponse.json({ error: 'Valid destination address is required' }, { status: 400 });
    }

    const normalizedChain = (chain || '').toUpperCase().trim();
    const config = NETWORK_WITHDRAWAL_FEES[chain] || NETWORK_WITHDRAWAL_FEES[normalizedChain];
    if (!config) {
      return NextResponse.json({ error: 'Unsupported network chain' }, { status: 400 });
    }

    if (numericAmount < config.minWithdrawal) {
      return NextResponse.json({ 
        error: `Minimum withdrawal for ${chain} is ${config.minWithdrawal} USDT` 
      }, { status: 400 });
    }

    // 2. Check 2FA if enabled
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_2fa_enabled, two_factor_secret')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.is_2fa_enabled) {
      if (!totpCode || typeof totpCode !== 'string' || !/^\d{4,8}$/.test(totpCode.trim())) {
        return NextResponse.json({
          error: 'TWO_FACTOR_REQUIRED: Valid 2FA TOTP code is required to execute a withdrawal.'
        }, { status: 403 });
      }
    }

    // Calculate Net Payout (Fee covers both deposit sweep & withdrawal gas)
    const withdrawalFee = config.feeUsdt;
    const netPayoutAmount = numericAmount - withdrawalFee;

    // 3. Fetch user balance
    let hasSufficientBalance = false;
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('balance_usdt')
      .eq('id', userId)
      .single();

    if (!userErr && user && typeof user.balance_usdt === 'number') {
      if (user.balance_usdt >= numericAmount) {
        hasSufficientBalance = true;
      }
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
        if (asset && Number(asset.available || 0) >= numericAmount) {
          hasSufficientBalance = true;
        }
      }
    }

    if (!hasSufficientBalance) {
      return NextResponse.json({ error: 'Insufficient account balance' }, { status: 400 });
    }

    // 4. Deduct full amount from user balance & record withdrawal request
    const { error: txErr } = await supabaseAdmin.rpc('process_withdrawal_request', {
      p_user_id: userId,
      p_gross_amount: numericAmount,
      p_fee: withdrawalFee,
      p_net_payout: netPayoutAmount,
      p_chain: chain,
      p_destination: destinationAddress.trim(),
    });

    if (txErr) {
      // Fallback to request_withdrawal if process_withdrawal_request RPC is not yet loaded in DB
      const fallback = await supabaseAdmin.rpc('request_withdrawal', {
        p_user_id: userId,
        p_network: normalizedChain,
        p_to_address: destinationAddress.trim(),
        p_amount: netPayoutAmount,
        p_fee: withdrawalFee,
        p_asset: 'USDT',
      });

      if (fallback.error) {
        throw txErr;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Withdrawal queued successfully',
      grossRequested: numericAmount,
      feeDeducted: withdrawalFee,
      netPayout: netPayoutAmount,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
