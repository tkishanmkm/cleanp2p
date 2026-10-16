import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [
        process.env.WITHDRAWAL_WORKER_SECRET,
        process.env.WORKER_SECRET,
        process.env.CRON_SECRET,
      ],
      customHeaderNames: ['x-worker-secret', 'x-withdrawal-worker-secret'],
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Atomically claim the next pending withdrawal via PostgreSQL SKIP LOCKED
    const { data: withdrawal, error: claimErr } = await supabaseAdmin
      .rpc('claim_next_pending_withdrawal')
      .single();

    if (claimErr || !withdrawal) {
      return NextResponse.json({ message: 'No pending withdrawals to process' }, { status: 200 });
    }

    const rawPrivateKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_PRIVATE_KEY;
    if (!rawPrivateKey) {
      throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is missing');
    }

    const providerUrl = process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const formattedKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
    const wallet = new ethers.Wallet(formattedKey, provider);

    type ClaimedWithdrawal = {
      asset_symbol?: string | null;
      asset?: string | null;
      id?: string | null;
      withdrawal_id?: string | null;
      to_address?: string | null;
      destination_address?: string | null;
      destination?: string | null;
      amount?: number | string | null;
    };
    const claimedWithdrawal = withdrawal as ClaimedWithdrawal;
    const assetUpper = (claimedWithdrawal.asset_symbol || claimedWithdrawal.asset || '').toUpperCase();
    const targetWithdrawalId = claimedWithdrawal.id || claimedWithdrawal.withdrawal_id;
    const destination = claimedWithdrawal.to_address || claimedWithdrawal.destination_address || claimedWithdrawal.destination;
    const payoutAmount = Number(claimedWithdrawal.amount);

    // Fail closed before broadcasting any irreversible on-chain transaction.
    if (!targetWithdrawalId || typeof destination !== 'string' || !ethers.isAddress(destination)) {
      throw new Error('Claimed withdrawal is missing a valid ID or EVM destination address');
    }
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      throw new Error('Claimed withdrawal amount must be a finite positive number');
    }

    let txHash = '';

    if (assetUpper === 'ETH') {
      const payoutUnits = ethers.parseEther(String(payoutAmount));
      const tx = await wallet.sendTransaction({
        to: destination,
        value: payoutUnits,
      });
      txHash = tx.hash;
    } else if (assetUpper === 'USDT') {
      const tokenAddress = process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
      const payoutUnits = ethers.parseUnits(String(payoutAmount), 6);
      const tx = await contract.transfer(destination, payoutUnits);
      txHash = tx.hash;
    } else {
      throw new Error(`Unsupported EVM asset: ${assetUpper}`);
    }

    // Settle via authoritative complete_onchain_withdrawal RPC
    const { error: settlementError } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: targetWithdrawalId,
      p_tx_hash: txHash,
    });
    if (settlementError) {
      // Do not attempt a second payout here. The transaction has already been broadcast;
      // reconcile this withdrawal using its tx hash before any retry.
      console.error('[Withdrawal Dispatch CRITICAL] On-chain payout broadcast but database settlement failed', {
        withdrawalId: targetWithdrawalId,
        txHash,
        settlementError,
      });
      return NextResponse.json({
        error: 'Payout was broadcast but database settlement failed; manual reconciliation is required.',
        withdrawalId: targetWithdrawalId,
        txHash,
        reconciliationRequired: true,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      withdrawalId: targetWithdrawalId,
      txHash,
    });
  } catch (err: any) {
    console.error('[Withdrawal Dispatch Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal processing error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
