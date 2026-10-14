import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

interface ClaimedWithdrawal {
  id?: string | null;
  withdrawal_id?: string | null;
  asset_symbol?: string | null;
  asset?: string | null;
  to_address?: string | null;
  destination_address?: string | null;
  destination?: string | null;
  amount?: number | string | null;
}

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
    const { data: rawWithdrawal, error: claimErr } = await supabaseAdmin
      .rpc('claim_next_pending_withdrawal')
      .single();
    const withdrawal = rawWithdrawal as unknown as ClaimedWithdrawal | null;

    if (claimErr || !withdrawal) {
      return NextResponse.json({ message: 'No pending withdrawals to process' }, { status: 200 });
    }

    const assetUpper = (withdrawal.asset_symbol || withdrawal.asset || '').toUpperCase().trim();
    const targetWithdrawalId = withdrawal.id || withdrawal.withdrawal_id;
    const destination = withdrawal.to_address || withdrawal.destination_address || withdrawal.destination;
    const amountText = withdrawal.amount == null ? '' : String(withdrawal.amount).trim();

    // Validate the claimed row completely before accessing a hot-wallet key or broadcasting.
    if (!targetWithdrawalId || typeof targetWithdrawalId !== 'string') {
      throw new Error('Claimed withdrawal has no valid ID');
    }
    if (!destination || !ethers.isAddress(destination)) {
      throw new Error('Claimed withdrawal has no valid EVM destination address');
    }
    if (!amountText || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amountText)) {
      throw new Error('Claimed withdrawal has an invalid amount');
    }
    if (assetUpper !== 'ETH' && assetUpper !== 'USDT') {
      throw new Error(`Unsupported EVM asset: ${assetUpper}`);
    }

    const payoutUnits = assetUpper === 'ETH'
      ? ethers.parseEther(amountText)
      : ethers.parseUnits(amountText, 6);
    if (payoutUnits <= 0n) {
      throw new Error('Claimed withdrawal amount must be greater than zero');
    }

    const rawPrivateKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_PRIVATE_KEY;
    if (!rawPrivateKey) {
      throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is missing');
    }

    const providerUrl = process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const formattedKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
    const wallet = new ethers.Wallet(formattedKey, provider);

    let txHash = '';

    if (assetUpper === 'ETH') {
      const tx = await wallet.sendTransaction({
        to: destination,
        value: payoutUnits,
      });
      txHash = tx.hash;
    } else {
      const tokenAddress = process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
      const tx = await contract.transfer(destination, payoutUnits);
      txHash = tx.hash;
    }

    // Persist settlement via the authoritative RPC. A broadcast transaction cannot
    // be safely treated as settled if this database operation fails; return the
    // hash for reconciliation instead of reporting success.
    const { error: settlementError, data: settlementData } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: targetWithdrawalId,
      p_tx_hash: txHash,
    });

    if (settlementError) {
      console.error('[Withdrawal Dispatch] Broadcast submitted but settlement RPC failed:', {
        withdrawalId: targetWithdrawalId,
        txHash,
        error: settlementError,
      });
      return NextResponse.json({
        success: false,
        broadcastSubmitted: true,
        reconciliationRequired: true,
        withdrawalId: targetWithdrawalId,
        txHash,
        error: 'Transaction was submitted, but withdrawal settlement could not be confirmed. Reconcile this transaction before retrying.',
      }, { status: 502 });
    }

    if (settlementData && typeof settlementData === 'object' && 'success' in settlementData && settlementData.success === false) {
      console.error('[Withdrawal Dispatch] Settlement RPC returned an unsuccessful result:', {
        withdrawalId: targetWithdrawalId,
        txHash,
      });
      return NextResponse.json({
        success: false,
        broadcastSubmitted: true,
        reconciliationRequired: true,
        withdrawalId: targetWithdrawalId,
        txHash,
        error: 'Transaction was submitted, but withdrawal settlement was not confirmed. Reconcile this transaction before retrying.',
      }, { status: 502 });
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
