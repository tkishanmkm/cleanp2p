import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const validSecret = process.env.WORKER_SECRET || process.env.CRON_SECRET || process.env.WITHDRAWAL_WORKER_SECRET;
    
    if (validSecret && authHeader !== `Bearer ${validSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const assetUpper = (withdrawal.asset_symbol || withdrawal.asset || '').toUpperCase();
    const targetWithdrawalId = withdrawal.id || withdrawal.withdrawal_id;
    const destination = withdrawal.to_address || withdrawal.destination_address || withdrawal.destination;

    let txHash = '';

    if (assetUpper === 'ETH') {
      const payoutUnits = ethers.parseEther(String(withdrawal.amount));
      const tx = await wallet.sendTransaction({
        to: destination,
        value: payoutUnits,
      });
      txHash = tx.hash;
    } else if (assetUpper === 'USDT') {
      const tokenAddress = process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
      const payoutUnits = ethers.parseUnits(String(withdrawal.amount), 6);
      const tx = await contract.transfer(destination, payoutUnits);
      txHash = tx.hash;
    } else {
      throw new Error(`Unsupported EVM asset: ${assetUpper}`);
    }

    // Settle via authoritative complete_onchain_withdrawal RPC
    await supabaseAdmin.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: targetWithdrawalId,
      p_tx_hash: txHash,
    });

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
