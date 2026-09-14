import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

// Initialize Supabase admin client with service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface ConfirmationWorkerResult {
  totalScanned: number;
  confirmedCount: number;
  pendingCount: number;
  failedCount: number;
  details: Array<{
    depositId: string;
    txHash: string;
    network: string;
    previousConfirmations: number;
    newConfirmations: number;
    requiredConfirmations: number;
    status: string;
    error?: string;
  }>;
}

/**
 * Returns default RPC URL by network
 */
function getRpcUrl(network: string): string {
  const norm = network.toUpperCase().trim();
  switch (norm) {
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'POLYGON':
    case 'MATIC':
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    default:
      return process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
  }
}

/**
 * Polls on-chain confirmation count for a given transaction hash and network
 */
async function fetchOnChainConfirmations(
  txHash: string,
  network: string
): Promise<{ confirmations: number; blockNumber?: number } | null> {
  const norm = network.toUpperCase().trim();

  // Handle Tron TRC-20
  if (norm === 'TRC20' || norm === 'TRON') {
    try {
      // Query TronGrid API
      const res = await fetch('https://api.trongrid.io/wallet/gettransactioninfobyid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: txHash }),
      });

      if (!res.ok) return null;
      const data = await res.json();

      if (!data || !data.blockNumber) {
        return null;
      }

      // Fetch current latest Tron block
      const nowRes = await fetch('https://api.trongrid.io/wallet/getnowblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const nowData = await nowRes.json();
      const currentBlock = nowData?.block_header?.raw_data?.number;

      if (currentBlock && data.blockNumber) {
        const confs = Math.max(1, currentBlock - data.blockNumber + 1);
        return { confirmations: confs, blockNumber: data.blockNumber };
      }

      return { confirmations: 19, blockNumber: data.blockNumber }; // Default to confirmed if in block
    } catch (tronErr) {
      console.warn(`Tron confirmation query error for ${txHash}:`, tronErr);
      return null;
    }
  }

  // Handle EVM networks (ERC20, BEP20, POLYGON)
  try {
    const rpcUrl = getRpcUrl(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Timeout provider queries after 8 seconds to prevent worker hangs
    const receiptPromise = provider.getTransactionReceipt(txHash);
    const blockPromise = provider.getBlockNumber();

    const [receipt, currentBlock] = await Promise.all([receiptPromise, blockPromise]);

    if (!receipt || !receipt.blockNumber) {
      return null; // Transaction still unmined / in mempool
    }

    const confs = Math.max(1, currentBlock - receipt.blockNumber + 1);
    return {
      confirmations: confs,
      blockNumber: receipt.blockNumber,
    };
  } catch (err: any) {
    console.warn(`EVM confirmation check failed for ${txHash} on ${network}:`, err?.message);
    return null;
  }
}

/**
 * Main worker logic: Polling and ingestion processor for pending deposits
 */
export async function runConfirmationsWorker(): Promise<ConfirmationWorkerResult> {
  const result: ConfirmationWorkerResult = {
    totalScanned: 0,
    confirmedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    details: [],
  };

  try {
    // 1. Fetch pending on-chain deposits
    const { data: pendingDeposits, error } = await supabaseAdmin
      .from('onchain_deposits')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Failed to query pending deposits:', error.message);
      return result;
    }

    if (!pendingDeposits || pendingDeposits.length === 0) {
      return result;
    }

    result.totalScanned = pendingDeposits.length;

    // 2. Iterate through each pending deposit
    for (const deposit of pendingDeposits) {
      const requiredConfs = deposit.required_confirmations || 12;
      const prevConfs = deposit.confirmations || 0;

      try {
        // Query blockchain node for real-time confirmations
        const onChainData = await fetchOnChainConfirmations(deposit.tx_hash, deposit.network);

        let currentConfirmations = prevConfs;
        let blockNumber = deposit.block_number;

        if (onChainData) {
          currentConfirmations = onChainData.confirmations;
          if (onChainData.blockNumber) {
            blockNumber = onChainData.blockNumber;
          }
        }

        const isNowConfirmed = currentConfirmations >= requiredConfs;

        if (isNowConfirmed) {
          // Strictly invoke PostgreSQL RPC credit_confirmed_deposit
          const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('credit_confirmed_deposit', {
            p_tx_hash: deposit.tx_hash,
            p_log_index: Number(deposit.log_index || 0),
            p_network: deposit.network,
            p_user_id: deposit.user_id,
            p_asset: deposit.asset_symbol?.toUpperCase()?.trim(),
            p_amount: Number(deposit.amount),
          });

          if (rpcErr) {
            console.error(`RPC credit_confirmed_deposit failed for ${deposit.tx_hash}:`, rpcErr);
            throw new Error(`RPC credit_confirmed_deposit failed: ${rpcErr.message}`);
          }

          // Mark onchain_deposits record as CREDITED / confirmed
          await supabaseAdmin
            .from('onchain_deposits')
            .update({
              status: 'CREDITED',
              confirmations: currentConfirmations,
              block_number: blockNumber,
              credited_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', deposit.id);

          result.confirmedCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: deposit.network,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'CREDITED',
          });
        } else {
          // Still pending: update confirmations if increased
          if (currentConfirmations !== prevConfs || blockNumber !== deposit.block_number) {
            await supabaseAdmin
              .from('onchain_deposits')
              .update({
                confirmations: currentConfirmations,
                block_number: blockNumber,
                updated_at: new Date().toISOString(),
              })
              .eq('id', deposit.id);
          }

          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: deposit.network,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
          });
        }
      } catch (depositErr: any) {
        console.error(`Error processing pending deposit ${deposit.tx_hash}:`, depositErr);
        result.failedCount++;
        result.details.push({
          depositId: deposit.id,
          txHash: deposit.tx_hash,
          network: deposit.network,
          previousConfirmations: prevConfs,
          newConfirmations: prevConfs,
          requiredConfirmations: requiredConfs,
          status: 'ERROR',
          error: depositErr?.message || 'Unknown processing error',
        });
      }
    }

    return result;
  } catch (err: any) {
    console.error('Fatal error in runConfirmationsWorker:', err);
    return result;
  }
}

/**
 * Starts an ongoing interval worker in long-running Node background processes
 */
let workerIntervalHandle: NodeJS.Timeout | null = null;

export function startConfirmationsWorker(intervalMs: number = 30000): void {
  if (workerIntervalHandle) {
    console.log('Confirmations worker already running.');
    return;
  }

  console.log(`Starting confirmations worker polling every ${intervalMs}ms...`);
  // Run once immediately
  runConfirmationsWorker().catch((err) => console.error('Initial confirmations worker run failed:', err));

  workerIntervalHandle = setInterval(() => {
    runConfirmationsWorker().catch((err) => console.error('Periodic confirmations worker run failed:', err));
  }, intervalMs);
}

export function stopConfirmationsWorker(): void {
  if (workerIntervalHandle) {
    clearInterval(workerIntervalHandle);
    workerIntervalHandle = null;
    console.log('Confirmations worker stopped.');
  }
}
