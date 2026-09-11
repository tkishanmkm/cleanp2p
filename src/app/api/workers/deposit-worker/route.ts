import { NextResponse } from 'next/server';
import { publicClient } from '@/lib/viem';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getTronWeb, isValidTronAddress } from '@/lib/blockchain/tron';

/**
 * Helper to record deposit in database either via RPC (Option A) or direct table writes (Option B)
 */
async function creditDeposit(
  supabaseAdmin: any,
  params: {
    userId: string;
    address: string;
    asset: string;
    chain: string;
    amount: number;
    txHash: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { userId, address, asset, chain, amount, txHash } = params;

  // Option A: Try RPC process_user_deposit
  try {
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      'process_user_deposit',
      {
        p_user_id: userId,
        p_address: address,
        p_asset: asset,
        p_chain: chain,
        p_amount: amount,
        p_tx_hash: txHash,
      }
    );

    if (!rpcErr && rpcData?.success !== false) {
      return { success: true };
    }
  } catch (err) {
    // If RPC is missing or fails, proceed to Option B fallback
  }

  // Option B: Direct Table Writes / Insert Fallback
  try {
    // 1. Check idempotency in deposits table
    const { data: existing } = await supabaseAdmin
      .from('deposits')
      .select('id')
      .eq('txid', txHash)
      .maybeSingle();

    if (existing) {
      return { success: true }; // Already recorded
    }

    // 2. Insert into deposits table
    const { data: depositRecord, error: depErr } = await supabaseAdmin
      .from('deposits')
      .insert({
        user_id: userId,
        asset: asset.toUpperCase(),
        network: chain.toUpperCase(),
        amount: amount,
        txid: txHash,
        status: 'completed',
        address: address,
      })
      .select('id')
      .single();

    if (depErr) {
      console.error('[Deposit Worker] Direct deposit insert error:', depErr);
    }

    // 3. Insert into onchain_deposits table
    await supabaseAdmin
      .from('onchain_deposits')
      .insert({
        user_id: userId,
        network: chain.toUpperCase(),
        asset_symbol: asset.toUpperCase(),
        tx_hash: txHash,
        address: address,
        to_address: address,
        amount: amount,
        status: 'CONFIRMED',
        confirmations: 12,
      })
      .select()
      .maybeSingle();

    // 4. Update user wallet balance if wallet exists
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id, balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (wallet) {
      await supabaseAdmin
        .from('wallets')
        .update({
          balance: (Number(wallet.balance) || 0) + amount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', wallet.id);
    }

    return { success: true };
  } catch (directErr: any) {
    console.error('[Deposit Worker] Direct table write error:', directErr);
    return { success: false, error: directErr.message };
  }
}

export async function POST(request: Request) {
  try {
    // 1. Verify cron or worker secret authorization
    const authHeader = request.headers.get('authorization');
    const workerSecret = process.env.DEPOSIT_WORKER_SECRET;
    if (workerSecret && authHeader !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // 2. Fetch active user deposit addresses from the database
    const { data: depositAddresses, error: dbError } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('user_id, address, asset_symbol, chain');

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    let currentBlock = 0n;
    try {
      currentBlock = await publicClient.getBlockNumber();
    } catch (e: any) {
      console.warn('[Deposit Worker] Warning: Could not fetch EVM block number:', e.message);
    }

    let processedDeposits = 0;
    const errors: any[] = [];

    // 3. Scan addresses based on their specific chain type
    for (const record of depositAddresses || []) {
      const { address, chain, user_id, asset_symbol } = record;
      if (!address) continue;
      const cleanAddr = address.trim();

      // EVM Chain balance check
      if (chain === 'ETH' || chain === 'SEPOLIA' || cleanAddr.startsWith('0x')) {
        if (cleanAddr.startsWith('0x') && cleanAddr.length === 42) {
          try {
            const balanceWei = await publicClient.getBalance({
              address: cleanAddr as `0x${string}`,
            });

            if (balanceWei > 0n) {
              const balanceEth = Number(balanceWei) / 1e18;
              const txHash = `0x_scan_${Date.now()}_${cleanAddr.slice(2, 10)}`;

              const creditResult = await creditDeposit(supabaseAdmin, {
                userId: user_id,
                address: cleanAddr,
                asset: asset_symbol || 'ETH',
                chain: chain || 'SEPOLIA',
                amount: balanceEth,
                txHash,
              });

              if (creditResult.success) {
                processedDeposits++;
              } else {
                errors.push({ address: cleanAddr, chain: 'EVM', error: creditResult.error });
              }
            }
          } catch (err: any) {
            errors.push({ address: cleanAddr, chain: 'EVM', error: err.message });
          }
        }
      } 
      // Tron Chain balance check
      else if (chain === 'TRON' || chain === 'TRC20' || cleanAddr.startsWith('T')) {
        if (isValidTronAddress(cleanAddr) || cleanAddr.length === 34) {
          try {
            const tronWeb = getTronWeb();
            const trxBalanceSun = await tronWeb.trx.getBalance(cleanAddr);
            const trxBalance = Number(trxBalanceSun) / 1e6; // 1 TRX = 1,000,000 SUN

            if (trxBalance > 0) {
              const txHash = `tron_scan_${Date.now()}_${cleanAddr.slice(0, 8)}`;

              const creditResult = await creditDeposit(supabaseAdmin, {
                userId: user_id,
                address: cleanAddr,
                asset: asset_symbol || 'TRX',
                chain: chain || 'TRC20',
                amount: trxBalance,
                txHash,
              });

              if (creditResult.success) {
                processedDeposits++;
              } else {
                errors.push({ address: cleanAddr, chain: 'TRON', error: creditResult.error });
              }
            }
          } catch (err: any) {
            errors.push({ address: cleanAddr, chain: 'TRON', error: err.message });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      scannedAddressesCount: depositAddresses?.length || 0,
      currentBlock: currentBlock.toString(),
      processedDeposits,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Deposit worker error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
