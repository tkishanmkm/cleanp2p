import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

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
  const norm = normalizeDepositNetwork(network);
  switch (norm) {
    case 'BEP20':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'ERC20':
    case 'ETH':
    default:
      return process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
  }
}

/**
 * Polls on-chain confirmation count for a given transaction hash and network
 */
async function fetchOnChainConfirmations(
  txHash: string,
  network: string
): Promise<{ confirmations: number; blockNumber?: number; fromAddress?: string } | null> {
  const norm = normalizeDepositNetwork(network);

  // Handle Tron TRC-20
  if (norm === 'TRC20') {
    try {
      const tronHost = (process.env.TRON_RPC_URL || 'https://api.trongrid.io').replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.TRON_PRO_API_KEY) {
        headers['TRON-PRO-API-KEY'] = process.env.TRON_PRO_API_KEY;
      }

      const res = await fetch(`${tronHost}/wallet/gettransactioninfobyid`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: txHash }),
      });

      if (!res.ok) return null;
      const data = await res.json();

      if (!data || !data.blockNumber) {
        return null;
      }

      const nowRes = await fetch(`${tronHost}/wallet/getnowblock`, {
        method: 'POST',
        headers,
      });
      const nowData = await nowRes.json();
      const currentBlock = nowData?.block_header?.raw_data?.number;

      if (currentBlock && data.blockNumber) {
        const confs = Math.max(1, currentBlock - data.blockNumber + 1);
        return { confirmations: confs, blockNumber: data.blockNumber };
      }

      return { confirmations: 19, blockNumber: data.blockNumber };
    } catch (tronErr) {
      console.warn(`Tron confirmation query error for ${txHash}:`, tronErr);
      return null;
    }
  }

  // Handle Bitcoin (BTC)
  if (norm === 'BTC') {
    try {
      const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
      const res = await fetch(`${btcApiBase}/tx/${txHash}/status`);
      if (!res.ok) return null;
      const statusData = await res.json();
      const confs = statusData.confirmed ? 2 : 0;
      return { confirmations: confs, blockNumber: statusData.block_height };
    } catch (btcErr) {
      console.warn(`BTC confirmation query error for ${txHash}:`, btcErr);
      return null;
    }
  }

  // Handle Litecoin (LTC)
  if (norm === 'LTC') {
    try {
      const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
      const res = await fetch(`${ltcApiBase}/tx/${txHash}/status`);
      if (!res.ok) return null;
      const statusData = await res.json();
      const confs = statusData.confirmed ? 6 : 0;
      return { confirmations: confs, blockNumber: statusData.block_height };
    } catch (ltcErr) {
      console.warn(`LTC confirmation query error for ${txHash}:`, ltcErr);
      return null;
    }
  }

  // Handle EVM networks (ERC20, BEP20, ETH)
  try {
    const rpcUrl = getRpcUrl(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const receiptPromise = provider.getTransactionReceipt(txHash);
    const blockPromise = provider.getBlockNumber();

    const [receipt, currentBlock] = await Promise.all([receiptPromise, blockPromise]);

    if (!receipt || !receipt.blockNumber) {
      return null; // Transaction still unmined
    }

    const confs = Math.max(1, currentBlock - receipt.blockNumber + 1);
    return {
      confirmations: confs,
      blockNumber: receipt.blockNumber,
      fromAddress: receipt.from?.toLowerCase(),
    };
  } catch (err: any) {
    console.warn(`EVM confirmation check failed for ${txHash} on ${network}:`, err?.message);
    return null;
  }
}

/**
 * Main worker logic: Polling and ingestion processor for pending deposits via canonical process_deposit_atomic RPC
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
      const normNet = normalizeDepositNetwork(deposit.network);
      const requiredConfs = deposit.required_confirmations || 12;
      const prevConfs = deposit.confirmations || 0;
      try {
        const onChainData = await fetchOnChainConfirmations(deposit.tx_hash, normNet);
        const currentConfirmations = onChainData?.confirmations ?? prevConfs;

        // Fail closed: this worker's chain lookups do not fully verify the
        // canonical transaction/output or token-transfer evidence, and the DB
        // RPC currently accepts caller-supplied confirmations. Never credit here.
        result.pendingCount++;
        result.details.push({
          depositId: deposit.id,
          txHash: deposit.tx_hash,
          network: normNet,
          previousConfirmations: prevConfs,
          newConfirmations: currentConfirmations,
          requiredConfirmations: requiredConfs,
          status: onChainData
            ? 'NOT_CREDITED_REQUIRES_CANONICAL_VERIFIER'
            : 'NOT_CREDITED_CHAIN_LOOKUP_UNAVAILABLE',
          error: onChainData
            ? 'Confirmation-only worker cannot establish all required transaction evidence; use the canonical verified ingestion path.'
            : 'Chain lookup failed; stored confirmations are informational only and cannot authorize credit.',
        });
      } catch (depositErr: any) {
        console.error(`Error processing pending deposit ${deposit.tx_hash}:`, depositErr);
        result.failedCount++;
        result.details.push({
          depositId: deposit.id,
          txHash: deposit.tx_hash,
          network: normNet,
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

let workerIntervalHandle: NodeJS.Timeout | null = null;

export function startConfirmationsWorker(intervalMs: number = 30000): void {
  if (workerIntervalHandle) {
    console.log('Confirmations worker already running.');
    return;
  }

  console.log(`Starting confirmations worker polling every ${intervalMs}ms...`);
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
