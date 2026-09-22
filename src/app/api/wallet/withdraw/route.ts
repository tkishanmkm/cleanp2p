import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authenticate caller session
    const supabase = await createClient();
    const admin = getSupabaseAdminClient();

    let { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user && req.headers.get('authorization')) {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const { data: tokenData } = await admin.auth.getUser(token);
        if (tokenData?.user) {
          user = tokenData.user;
          authError = null;
        }
      }
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session authentication required' }, { status: 401 });
    }

    const { destinationAddress, amount, asset } = (await req.json().catch(() => ({}))) as {
      destinationAddress?: string;
      amount?: number;
      asset?: string;
    };

    if (!destinationAddress || !amount || amount <= 0 || !asset) {
      return NextResponse.json({ error: 'Invalid payload: Valid destination address, positive amount, and asset required.' }, { status: 400 });
    }

    const cleanAsset = String(asset).toUpperCase().trim();
    const numericAmount = Number(amount);

    // 2. Check KYC status for withdrawal
    const { data: userProfile } = await admin
      .from('profiles')
      .select('id, is_verified, kyc_status, id_verified, is_banned, is_withdrawal_locked, withdrawals_disabled')
      .eq('id', user.id)
      .maybeSingle();

    if (userProfile?.is_banned || userProfile?.is_withdrawal_locked || userProfile?.withdrawals_disabled) {
      return NextResponse.json(
        { error: 'Withdrawals are currently restricted for your account. Please contact support@paxones.com.' },
        { status: 403 }
      );
    }

    const isVerified = Boolean(
      userProfile?.is_verified ||
      userProfile?.kyc_status === 'approved' ||
      userProfile?.kyc_status === 'verified' ||
      userProfile?.id_verified
    );

    if (!isVerified) {
      return NextResponse.json(
        { error: 'Identity verification is required before initiating cryptocurrency withdrawals. Please complete Identity Verification in Settings.' },
        { status: 403 }
      );
    }

    // 3. Atomically check balance and lock funds
    const { error: deductError } = await admin.rpc('deduct_user_balance', {
      p_user_id: user.id,
      p_amount: numericAmount,
      p_asset: cleanAsset,
    });

    if (deductError) {
      return NextResponse.json({ error: deductError.message || 'Insufficient spendable balance' }, { status: 400 });
    }

    let txHash = '';
    const hasEvmSigner = Boolean(SYSTEM_CONFIG.hotWallets.evm.privateKey && SYSTEM_CONFIG.rpcs.evm);

    if (hasEvmSigner) {
      try {
        const provider = new ethers.JsonRpcProvider(SYSTEM_CONFIG.rpcs.evm);
        const hotWalletSigner = new ethers.Wallet(SYSTEM_CONFIG.hotWallets.evm.privateKey, provider);

        const feeData = await provider.getFeeData();
        const baseGasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');
        const priorityGasPrice = (baseGasPrice * 200n) / 100n;

        if (cleanAsset === 'ETH') {
          const tx = await hotWalletSigner.sendTransaction({
            to: destinationAddress,
            value: ethers.parseEther(numericAmount.toString()),
            gasPrice: priorityGasPrice,
          });
          txHash = tx.hash;
        } else {
          const tokenAddress = SYSTEM_CONFIG.contracts.usdtErc20;
          const contract = new ethers.Contract(
            tokenAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            hotWalletSigner
          );

          const tx = await contract.transfer(
            destinationAddress,
            ethers.parseUnits(numericAmount.toString(), 6),
            { gasPrice: priorityGasPrice }
          );
          txHash = tx.hash;
        }
      } catch (onChainErr) {
        console.error('On-chain dispatch error (withdrawal logged in DB):', onChainErr);
      }
    }

    await admin.from('withdrawals').insert({
      user_id: user.id,
      currency: cleanAsset,
      amount: numericAmount,
      destination_address: destinationAddress,
      tx_hash: txHash || null,
      status: txHash ? 'completed' : 'processing',
    });

    // Activity Center Notification
    try {
      await admin.from('notifications').insert({
        user_id: user.id,
        title: 'Withdrawal Processed',
        message: `Withdrawal of ${numericAmount} ${cleanAsset} to ${destinationAddress.slice(0, 6)}...${destinationAddress.slice(-4)} has been submitted.`,
        link: '/wallets',
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch (notifErr) {
      console.warn('Withdrawal notification insert notice:', notifErr);
    }

    return NextResponse.json({ success: true, txHash: txHash || 'QUEUED_FOR_BROADCAST' });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Withdrawal dispatch failed';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
