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
    const validSecret = process.env.WORKER_SECRET || process.env.CRON_SECRET;
    
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

    const rawPrivateKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY;
    if (!rawPrivateKey) {
      throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is missing');
    }

    // Initialize provider and signer
    const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
    const formattedKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
    const wallet = new ethers.Wallet(formattedKey, provider);

    // Precise BigInt calculation for asset precision (USDT/USDC = 6 decimals, Native ETH = 18 decimals)
    const assetUpper = (withdrawal.asset_symbol || '').toUpperCase();
    const decimals = assetUpper === 'USDT' || assetUpper === 'USDC' ? 6 : 18;
    const payoutUnits = ethers.parseUnits(String(withdrawal.amount), decimals);

    let txHash = '';

    if (assetUpper === 'ETH') {
      const tx = await wallet.sendTransaction({
        to: withdrawal.to_address,
        value: payoutUnits,
      });
      txHash = tx.hash;
    } else if (assetUpper === 'USDT') {
      // Standard ERC20 Transfer Interface
      const tokenAddress = process.env.NEXT_PUBLIC_USDT_CONTRACT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new ethers.Contract(tokenAddress, erc20Abi, wallet);
      const tx = await contract.transfer(withdrawal.to_address, payoutUnits);
      txHash = tx.hash;
    }

    // Update DB status to BROADCASTED without waiting for block confirmation (Serverless compliant)
    await supabaseAdmin
      .from('onchain_withdrawals')
      .update({
        status: 'BROADCASTED',
        tx_hash: txHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', withdrawal.id);

    return NextResponse.json({
      success: true,
      withdrawalId: withdrawal.id,
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
