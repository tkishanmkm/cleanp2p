import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, destinationAddress, amount, asset } = (await req.json()) as {
      userId?: string;
      destinationAddress?: string;
      amount?: number;
      asset?: string;
    };

    if (!userId || !destinationAddress || !amount || amount <= 0 || !asset) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Check KYC status for withdrawal
    const { data: userProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, is_verified, kyc_status, id_verified')
      .eq('id', userId)
      .maybeSingle();

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

    const { error: deductError } = await supabaseAdmin.rpc('deduct_user_balance', {
      p_user_id: userId,
      p_amount: amount,
      p_asset: asset,
    });

    if (deductError) {
      return NextResponse.json({ error: deductError.message || 'Insufficient balance' }, { status: 400 });
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

        if (asset === 'ETH') {
          const tx = await hotWalletSigner.sendTransaction({
            to: destinationAddress,
            value: ethers.parseEther(amount.toString()),
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
            ethers.parseUnits(amount.toString(), 6),
            { gasPrice: priorityGasPrice }
          );
          txHash = tx.hash;
        }
      } catch (onChainErr) {
        console.error('On-chain dispatch error (withdrawal logged in DB):', onChainErr);
      }
    }

    await supabaseAdmin.from('withdrawals').insert({
      user_id: userId,
      currency: asset,
      amount,
      destination_address: destinationAddress,
      tx_hash: txHash || null,
      status: txHash ? 'completed' : 'processing',
    });

    // Activity Center Notification
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: userId,
        title: 'Withdrawal Processed',
        message: `Withdrawal of ${amount} ${asset} to ${destinationAddress.slice(0, 6)}...${destinationAddress.slice(-4)} has been submitted.`,
        link: '/wallet',
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
