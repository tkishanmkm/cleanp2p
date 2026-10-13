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
 * Legacy status-only probes retained temporarily for diagnostics.
 * They do NOT prove the exact output/log, amount, recipient, asset, or
 * successful execution. Their result must never authorize a deposit credit.
 */
async function fetchOnChainConfirmations(
  txHash: string,
  network: string
): Promise<{ confirmations: number; blockNumber?: number; fromAddress?: string } | null> {
  const norm = normalizeDepositNetwork(network);

  if (norm === 'TRC20') {
    try {
      const tronHost = (process.env.TRON_RPC_URL || 'https://api.trongrid.io').replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.TRON_PRO_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRON_PRO_API_KEY;
      const res = await fetch(`${tronHost}/wallet/gettransactioninfobyid`, {
        method: 'POST', headers, body: JSON.stringify({ value: txHash }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.blockNumber) return null;
      const nowRes = await fetch(`${tronHost}/wallet/getnowblock`, { method: 'POST', headers });
      if (!nowRes.ok) return null;
      const nowData = await nowRes.json();
      const currentBlock = nowData?.block_header?.raw_data?.number;
      if (typeof currentBlock === 'number' && typeof data.blockNumber === 'number') {
        return { confirmations: Math.max(0, currentBlock - data.blockNumber + 1), blockNumber: data.blockNumber };
      }
      return null;
    } catch (err) {
      console.warn(`Tron confirmation query error for ${txHash}:`, err);
      return null;
    }
  }

  if (norm === 'BTC' || norm === 'LTC') {
    try {
      const base = norm === 'BTC'
        ? (process.env.BTC_MEMPOOL_API || 'https://mempool.space/api')
        : (process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api');
      const res = await fetch(`${base}/tx/${txHash}`);
      if (!res.ok) return null;
      const tx = await res.json();
      const status = tx?.status;
      if (!status?.confirmed || !Number.isSafeInteger(status.block_height) || status.block_height <= 0) return null;
      const tipRes = await fetch(`${base}/blocks/tip/height`);
      if (!tipRes.ok) return null;
      const tip = Number((await tipRes.text()).trim());
      if (!Number.isSafeInteger(tip) || tip < status.block_height) return null;
      return { confirmations: tip - status.block_height + 1, blockNumber: status.block_height };
    } catch (err) {
      console.warn(`${norm} confirmation query error for ${txHash}:`, err);
      return null;
    }
  }

  try {
    const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
    const [receipt, currentBlock] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);
    if (!receipt || receipt.blockNumber == null || receipt.status !== 1) return null;
    const confs = Math.max(0, currentBlock - receipt.blockNumber + 1);
    return { confirmations: confs, blockNumber: receipt.blockNumber, fromAddress: receipt.from?.toLowerCase() };
  } catch (err: any) {
    console.warn(`EVM confirmation check failed for ${txHash} on ${network}:`, err?.message);
    return null;
  }
}

/**
 * Safety containment: this worker currently has only status/depth probes, not
 * exact-event verification. Do not pass their output (or stored row values) to
 * the SECURITY DEFINER credit RPC. Re-enable credit only after a shared verifier
 * proves network, canonical inclusion, success, recipient, asset/contract,
 * exact output/log index and integer base-unit value for each supported chain.
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
    const { data: pendingDeposits, error } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, tx_hash, network, confirmations, required_confirmations')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Failed to query pending deposits:', error.message);
      result.failedCount++;
      return result;
    }
    if (!pendingDeposits?.length) return result;

    result.totalScanned = pendingDeposits.length;
    for (const deposit of pendingDeposits) {
      const normNet = normalizeDepositNetwork(deposit.network);
      const previous = Number(deposit.confirmations || 0);
      const required = Number(deposit.required_confirmations || 12);

      // Probe only to produce diagnostics. Even a high depth is not proof that
      // the stored destination, amount, asset, contract, and output/log are real.
      const probe = await fetchOnChainConfirmations(deposit.tx_hash, normNet);
      const observed = probe?.confirmations ?? 0;
      result.pendingCount++;
      result.details.push({
        depositId: deposit.id,
        txHash: deposit.tx_hash,
        network: normNet,
        previousConfirmations: previous,
        newConfirmations: observed,
        requiredConfirmations: required,
        status: 'VERIFICATION_REQUIRED',
        error: 'No exact-event chain proof is available; deposit credit RPC was not called.',
      });
    }

    return result;
  } catch (err: any) {
    console.error('Fatal error in runConfirmationsWorker:', err);
    result.failedCount++;
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
