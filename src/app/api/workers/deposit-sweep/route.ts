import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys } from '@/lib/crypto/hd-engine';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const urlKey = req.nextUrl.searchParams.get('key');
    const expectedSecret =
      process.env.CRON_SECRET_KEY?.trim() ||
      process.env.CRON_SECRET?.trim() ||
      process.env.DEPOSIT_WORKER_SECRET?.trim() ||
      SYSTEM_CONFIG.secrets.depositWorker ||
      SYSTEM_CONFIG.secrets.cron;

    if (expectedSecret && token !== expectedSecret && urlKey !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid worker secret' }, { status: 401 });
    }

    const { runDepositSweeper } = await import('@/jobs/sweeperWorker');
    const result = await runDepositSweeper();
    return NextResponse.json({ success: true, mode: 'automated_queue', timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('Deposit sweep GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedSecret = SYSTEM_CONFIG.secrets.depositWorker;

    if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'Unauthorized: Invalid worker secret' }, { status: 401 });
    }

    const body = await req.json();
    const { userId, walletIndex, amount, asset, txHash } = body;

    if (!userId || walletIndex === undefined || !amount || !asset || !txHash) {
      return NextResponse.json(
        { error: 'Missing required parameters: userId, walletIndex, amount, asset, txHash' },
        { status: 400 }
      );
    }

    // 1. Prevent duplicate processing
    const { data: existingTx } = await supabase
      .from('deposits')
      .select('id, status')
      .eq('tx_hash', txHash)
      .maybeSingle();

    if (existingTx) {
      return NextResponse.json({ message: 'Transaction already processed', depositId: existingTx.id }, { status: 200 });
    }

    // 2. Re-derive child private key for this user
    let userKeys: any = null;
    if (SYSTEM_CONFIG.mnemonic) {
      userKeys = await deriveUserKeys(SYSTEM_CONFIG.mnemonic, Number(walletIndex));
    }

    // 3. Record deposit & update user balance inside Supabase DB via stored procedure
    const { error: dbError } = await supabase.rpc('process_user_deposit', {
      p_user_id: userId,
      p_amount: Number(amount),
      p_asset: asset,
      p_tx_hash: txHash,
    });

    if (dbError) {
      console.error('Database process_user_deposit error:', dbError);
      return NextResponse.json({ error: dbError.message || 'Database error processing deposit' }, { status: 500 });
    }

    // 4. Sweep EVM / ERC20 / BEP20 Funds to Master Hot Wallet
    let sweepTxHash: string | null = null;
    const isEvmAsset = ['ETH', 'USDT_ERC20', 'USDT_BEP20', 'USDT', 'BNB', 'POL'].includes(asset);

    if (isEvmAsset && userKeys && SYSTEM_CONFIG.hotWallets.evm.address && SYSTEM_CONFIG.rpcs.evm) {
      try {
        const provider = new ethers.JsonRpcProvider(SYSTEM_CONFIG.rpcs.evm);
        const userSigner = new ethers.Wallet(userKeys.evm.privateKey, provider);

        if (asset === 'ETH' || asset === 'BNB' || asset === 'POL') {
          const balance = await provider.getBalance(userKeys.evm.address);
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
          const gasLimit = 21000n;
          const fee = gasPrice * gasLimit;

          if (balance > fee) {
            const tx = await userSigner.sendTransaction({
              to: SYSTEM_CONFIG.hotWallets.evm.address,
              value: balance - fee,
            });
            sweepTxHash = tx.hash;
          }
        } else {
          // Token Sweep (USDT ERC20 / BEP20)
          const tokenAddress =
            asset === 'USDT_BEP20'
              ? SYSTEM_CONFIG.contracts.usdtBep20
              : SYSTEM_CONFIG.contracts.usdtErc20;

          if (tokenAddress) {
            const tokenContract = new ethers.Contract(
              tokenAddress,
              [
                'function transfer(address to, uint256 amount) returns (bool)',
                'function balanceOf(address) view returns (uint256)',
              ],
              userSigner
            );

            const tokenBalance = await tokenContract.balanceOf(userKeys.evm.address);
            if (tokenBalance > 0n) {
              const tx = await tokenContract.transfer(SYSTEM_CONFIG.hotWallets.evm.address, tokenBalance);
              sweepTxHash = tx.hash;
            }
          }
        }
      } catch (sweepError) {
        console.warn('Auto-sweep non-fatal notice (funds safely credited in DB):', sweepError);
      }
    }

    return NextResponse.json({
      success: true,
      status: 'Credited and Swept',
      userId,
      amount,
      asset,
      txHash,
      sweepTxHash,
    });
  } catch (err: any) {
    console.error('Deposit sweep worker error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
