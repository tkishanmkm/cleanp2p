import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys } from '@/lib/crypto/hd-engine';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

interface SweepQueueItem {
  id: string;
  user_id: string;
  wallet_index: number;
  asset: string;
  deposit_address: string;
  amount: number;
  tx_hash: string;
  status: string;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization');
  if (SYSTEM_CONFIG.secrets.cron && authHeader !== `Bearer ${SYSTEM_CONFIG.secrets.cron}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const provider = new ethers.JsonRpcProvider(SYSTEM_CONFIG.rpcs.evm);
  const hotWalletSigner = SYSTEM_CONFIG.hotWallets.evm.privateKey
    ? new ethers.Wallet(SYSTEM_CONFIG.hotWallets.evm.privateKey, provider)
    : null;

  // STAGE 1: GAS ORACLE
  const { data: pendingGasItems } = await supabaseAdmin
    .from('sweep_queue')
    .select('*')
    .eq('status', 'PENDING_GAS')
    .limit(10);

  const typedPendingItems = (pendingGasItems || []) as SweepQueueItem[];

  if (hotWalletSigner) {
    for (const item of typedPendingItems) {
      try {
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');
        const requiredGas = gasPrice * 65000n;

        const gasTx = await hotWalletSigner.sendTransaction({
          to: item.deposit_address,
          value: requiredGas,
        });

        await supabaseAdmin.rpc('mark_gas_funded', {
          p_sweep_id: item.id,
          p_gas_tx_hash: gasTx.hash,
        });
      } catch (err: unknown) {
        console.error(`Gas funding failed for sweep ID ${item.id}:`, err);
      }
    }
  }

  // STAGE 2: TOKEN SWEEPER
  const { data: readyToSweepItems } = await supabaseAdmin
    .from('sweep_queue')
    .select('*')
    .eq('status', 'GAS_FUNDED')
    .limit(10);

  const typedSweepItems = (readyToSweepItems || []) as SweepQueueItem[];

  for (const item of typedSweepItems) {
    try {
      const userKeys = await deriveUserKeys(SYSTEM_CONFIG.mnemonic, item.wallet_index ?? 0);
      const userSigner = new ethers.Wallet(userKeys.evm.privateKey, provider);

      let sweepTxHash = '';

      if (item.asset === 'ETH') {
        const balance = await provider.getBalance(item.deposit_address);
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');
        const fee = gasPrice * 21000n;

        if (balance > fee) {
          const tx = await userSigner.sendTransaction({
            to: SYSTEM_CONFIG.hotWallets.evm.address,
            value: balance - fee,
          });
          sweepTxHash = tx.hash;
        }
      } else {
        const tokenAddress = SYSTEM_CONFIG.contracts.usdtErc20;
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'],
          userSigner
        );

        const tokenBalance = (await tokenContract.balanceOf(item.deposit_address)) as bigint;
        if (tokenBalance > 0n) {
          const tx = await tokenContract.transfer(SYSTEM_CONFIG.hotWallets.evm.address, tokenBalance);
          sweepTxHash = tx.hash;
        }
      }

      if (sweepTxHash) {
        await supabaseAdmin.rpc('mark_swept', {
          p_sweep_id: item.id,
          p_sweep_tx_hash: sweepTxHash,
        });
      }
    } catch (err: unknown) {
      console.error(`Sweep transaction failed for item ID ${item.id}:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    processedGas: typedPendingItems.length,
    processedSweeps: typedSweepItems.length,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
