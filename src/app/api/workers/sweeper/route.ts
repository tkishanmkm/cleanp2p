import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createWalletClient, http, parseAbi, parseEther, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia, bsc, polygon } from 'viem/chains';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const validSecret = process.env.WORKER_SECRET || process.env.CRON_SECRET;
    if (validSecret && authHeader !== `Bearer ${validSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch un-swept deposits ready for hot-wallet aggregation
    const { data: deposits, error } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, to_address, amount, asset, network, txid')
      .eq('is_swept', false)
      .eq('status', 'CONFIRMED')
      .limit(5);

    if (error || !deposits || deposits.length === 0) {
      return NextResponse.json({ message: 'No pending sweeps' });
    }

    const rawPrivateKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY;
    if (!rawPrivateKey) {
      return NextResponse.json({ error: 'EVM_HOT_WALLET_PRIVATE_KEY is not configured' }, { status: 500 });
    }

    const formattedKey = (rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`) as `0x${string}`;
    const masterAccount = privateKeyToAccount(formattedKey);
    const hotWalletAddress = (process.env.EVM_HOT_WALLET_ADDRESS || masterAccount.address) as `0x${string}`;

    const client = createWalletClient({
      account: masterAccount,
      chain: sepolia,
      transport: http(process.env.ETH_RPC_URL)
    });

    const results = [];

    for (const deposit of deposits) {
      try {
        const assetUpper = (deposit.asset || '').toUpperCase();
        if (assetUpper === 'ETH') {
          // Native sweep directly to hot wallet
          const hash = await client.sendTransaction({
            to: hotWalletAddress,
            value: parseEther(deposit.amount.toString())
          });

          await supabaseAdmin
            .from('onchain_deposits')
            .update({ 
              is_swept: true, 
              sweep_txid: hash,
              swept_at: new Date().toISOString()
            })
            .eq('id', deposit.id);

          results.push({ depositId: deposit.id, sweepTxid: hash, status: 'SWEPT' });
        } else if (assetUpper === 'USDT' || assetUpper === 'USDC') {
          // Record ERC20 sweep task or dispatch token transfer
          results.push({ depositId: deposit.id, asset: assetUpper, status: 'QUEUED_FOR_ERC20_SWEEP' });
        }
      } catch (sweepItemErr: any) {
        console.error(`[Sweeper] Error sweeping deposit ${deposit.id}:`, sweepItemErr);
        results.push({ depositId: deposit.id, error: sweepItemErr.message });
      }
    }

    return NextResponse.json({ success: true, swept: results });
  } catch (err: any) {
    console.error('[Sweeper Route Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
