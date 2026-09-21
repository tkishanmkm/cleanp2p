import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const WORKER_SECRET = process.env.WITHDRAWAL_WORKER_SECRET;
const HOT_WALLET_KEY = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Fetch pending withdrawals (via RPC or direct table query)
    let pendingItems: any[] = [];
    const { data: rpcItems, error: claimError } = await supabaseAdmin.rpc(
      'claim_pending_withdrawals',
      { p_limit: 10 }
    );

    if (!claimError && Array.isArray(rpcItems)) {
      pendingItems = rpcItems;
    } else {
      // Fallback to querying withdrawals directly
      const { data: directItems, error: fetchErr } = await supabaseAdmin
        .from('withdrawals')
        .select('*')
        .in('status', ['QUEUED', 'approved', 'PENDING'])
        .limit(10);

      if (fetchErr) {
        console.error('[Withdrawal Worker] Database fetch error:', fetchErr.message);
      }
      if (directItems && directItems.length > 0) {
        pendingItems = directItems;
      }
    }

    if (!pendingItems || pendingItems.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, message: 'No pending payouts' });
    }

    let successCount = 0;
    const errors: any[] = [];

    // 2. Dispatch on-chain transactions with Viem
    for (const withdrawal of pendingItems) {
      let txHash: string | undefined;
      let isBroadcasted = false;

      try {
        // Resolve destination address from database row (to_address, destination_address, or address)
        const targetAddress = (withdrawal.to_address || withdrawal.destination_address || withdrawal.address)?.trim();

        if (!targetAddress || !targetAddress.startsWith('0x') || targetAddress.length !== 42) {
          throw new Error(`Invalid or missing destination EVM address: ${targetAddress}`);
        }

        if (HOT_WALLET_KEY && HOT_WALLET_KEY.startsWith('0x')) {
          const hotWalletAccount = privateKeyToAccount(HOT_WALLET_KEY as `0x${string}`);
          const walletClient = createWalletClient({
            account: hotWalletAccount,
            chain: mainnet,
            transport: http(process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com'),
          });

          console.log(`[Withdrawal Worker] Broadcasting withdrawal ${withdrawal.id} of ${withdrawal.amount} to ${targetAddress}`);

          // Send on-chain transaction with explicit destination address mapping
          const hash = await walletClient.sendTransaction({
            account: hotWalletAccount,
            chain: mainnet,
            to: targetAddress as `0x${string}`, // Ensure this matches destination address from database
            value: parseEther(withdrawal.amount.toString()),
          });

          txHash = hash;
          isBroadcasted = true;
          console.log(`[Withdrawal Worker] Broadcast successful! Tx Hash: ${txHash}`);
        } else {
          throw new Error('EVM Hot Wallet key (HOT_WALLET_PRIVATE_KEY) is not configured or invalid.');
        }

        // 3. Mark withdrawal as completed in database (with explicit error verification)
        const { error: updateWithdrawalErr } = await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'completed',
            tx_hash: txHash,
            txid: txHash,
            broadcasted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);

        if (updateWithdrawalErr) {
          console.error(`[Withdrawal Worker] Database update error for withdrawals table (ID: ${withdrawal.id}):`, updateWithdrawalErr);
          throw new Error(`Database update failed after on-chain broadcast: ${updateWithdrawalErr.message}`);
        }

        // Also update onchain_withdrawals if matching record exists
        const { error: onchainErr } = await supabaseAdmin
          .from('onchain_withdrawals')
          .update({
            status: 'COMPLETED',
            tx_hash: txHash,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);

        if (onchainErr) {
          console.warn(`[Withdrawal Worker] Notice: onchain_withdrawals update returned:`, onchainErr.message);
        }

        // 4. Record ledger entry for auditing
        const { error: ledgerErr } = await supabaseAdmin.from('ledger_entries').insert({
          user_id: withdrawal.user_id,
          amount: withdrawal.amount,
          entry_type: 'withdrawal_payout',
          reference_type: 'withdrawals',
          reference_id: txHash,
          metadata: {
            destination: targetAddress,
            withdrawal_id: withdrawal.id,
            tx_hash: txHash,
          },
        });

        if (ledgerErr) {
          console.warn(`[Withdrawal Worker] Ledger entry record warning:`, ledgerErr.message);
        }

        successCount++;
      } catch (err: any) {
        console.error(`[Withdrawal Worker] Exception during withdrawal ${withdrawal.id}:`, err.message);

        // If the transaction was already broadcasted on-chain, do NOT mark status as failed (prevent double spends)
        const statusToSet = isBroadcasted ? 'BROADCASTED' : 'failed';

        const { error: failUpdateErr } = await supabaseAdmin
          .from('withdrawals')
          .update({
            status: statusToSet,
            tx_hash: txHash || withdrawal.tx_hash,
            broadcast_error: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);

        if (failUpdateErr) {
          console.error(`[Withdrawal Worker] Critical: Failed to update withdrawal status on error:`, failUpdateErr.message);
        }

        errors.push({ withdrawalId: withdrawal.id, isBroadcasted, txHash, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      claimedCount: pendingItems.length,
      processedCount: successCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('[Withdrawal Worker] Fatal route error:', error.message);
    return NextResponse.json({ error: error.message || 'Withdrawal worker failed' }, { status: 500 });
  }
}
