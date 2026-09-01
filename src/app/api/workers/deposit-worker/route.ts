import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

const WORKER_SECRET = process.env.DEPOSIT_WORKER_SECRET;

// Set up Viem public client for EVM RPC queries
const rpcClient = createPublicClient({
  chain: sepolia, // Switch to mainnet for production
  transport: http(process.env.EVM_RPC_URL || 'https://rpc.ankr.com/eth_sepolia'),
});

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Fetch active deposit addresses from Supabase
    const { data: depositAddresses, error: dbError } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('user_id, address, asset_symbol, chain');

    if (dbError) throw new Error(dbError.message);
    if (!depositAddresses || depositAddresses.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, message: 'No active addresses to scan' });
    }

    // 2. Query latest block number
    const latestBlock = await rpcClient.getBlockNumber();
    const startBlock = latestBlock - 100n; // Scan last 100 blocks

    let processedDeposits = 0;
    const errors: any[] = [];

    // 3. Scan native balance or ERC-20 transfer logs for derived addresses
    for (const item of depositAddresses) {
      try {
        const balanceWei = await rpcClient.getBalance({ address: item.address as `0x${string}` });
        
        // If balance detected, process user deposit via DB RPC
        if (balanceWei > 0n) {
          const balanceEth = Number(balanceWei) / 1e18;

          const { data: processResult, error: processErr } = await supabaseAdmin.rpc(
            'process_user_deposit',
            {
              p_user_id: item.user_id,
              p_address: item.address,
              p_asset: item.asset_symbol,
              p_chain: item.chain,
              p_amount: balanceEth,
              p_tx_hash: `0x_native_balance_scan_${Date.now()}`,
            }
          );

          if (!processErr) processedDeposits++;
        }
      } catch (err: any) {
        errors.push({ address: item.address, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      scannedAddressesCount: depositAddresses.length,
      currentBlock: latestBlock.toString(),
      processedDeposits,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Deposit worker failed' }, { status: 500 });
  }
}
