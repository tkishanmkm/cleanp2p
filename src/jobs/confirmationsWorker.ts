import { supabaseService as serviceRoleClient } from '@/lib/supabase/service-role';
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { verifyUtxoDepositOutput } from '@/lib/blockchain/verify-utxo-deposit';
import { verifyEvmDepositEvidence } from '@/lib/blockchain/verify-evm-deposit';
import { verifyTronTransferEvent } from '@/lib/blockchain/verify-tron-deposit';

// Initialize Supabase admin client with service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// This worker mutates financial state and must never fall back to an anon key or placeholder.
// No anon-key or placeholder fallback is permitted for balance-credit workers.
const supabaseAdmin = supabaseUrl && supabaseKey ? serviceRoleClient : null;

const REQUIRED_DEPOSIT_CONFIRMATIONS: Record<string, number> = {
  BTC: 3,
  LTC: 6,
  ETH: 12,
  ERC20: 12,
  BEP20: 15,
  TRC20: 19,
};

function getRequiredDepositConfirmations(network: string): number | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_DEPOSIT_CONFIRMATIONS, network)
    ? REQUIRED_DEPOSIT_CONFIRMATIONS[network]
    : null;
}

function isPositiveDecimalAmount(value: unknown): value is string | number {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return false;
  try {
    return BigInt(text.replace('.', '')) > 0n;
  } catch {
    return false;
  }
}

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
  network: string,
  destinationAddress?: string,
  outputIndex = 0,
  expectedAmount?: string | number
): Promise<{ confirmations: number; blockNumber?: number; blockHash: string; fromAddress?: string } | null> {
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
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });

      if (!res.ok) return null;
      const data = await res.json();

      if (!data || typeof data.id !== 'string' || data.id.toLowerCase() !== txHash.toLowerCase() ||
          !Number.isSafeInteger(data.blockNumber) || data.blockNumber <= 0 ||
          data.receipt?.result !== 'SUCCESS') {
        return null;
      }

      // A full-node receipt is not finality proof. Require the transaction to be
      // present in the Solidity-node block at the reported height (solidified view).
      const solidifiedBlockRes = await fetch(`${tronHost}/walletsolidity/getblockbynum`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ num: data.blockNumber }),
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!solidifiedBlockRes.ok) return null;
      const solidifiedBlock = await solidifiedBlockRes.json();
      const solidifiedTransactions = Array.isArray(solidifiedBlock?.transactions)
        ? solidifiedBlock.transactions
        : [];
      if (
        solidifiedBlock?.block_header?.raw_data?.number !== data.blockNumber ||
        typeof solidifiedBlock?.blockID !== 'string' ||
        !/^[a-fA-F0-9]{64}$/.test(solidifiedBlock.blockID) ||
        !solidifiedTransactions.some((item: any) =>
          typeof item?.txID === 'string' && item.txID.toLowerCase() === txHash.toLowerCase()
        )
      ) {
        return null;
      }

      // Count only solidified blocks, never the potentially unconfirmed full-node tip.
      const nowRes = await fetch(`${tronHost}/walletsolidity/getnowblock`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (!nowRes.ok) return null;
      const nowData = await nowRes.json();
      const currentBlock = nowData?.block_header?.raw_data?.number;

      if (!Number.isSafeInteger(currentBlock) || !Number.isSafeInteger(data.blockNumber) ||
          currentBlock < data.blockNumber || data.blockNumber <= 0) {
        return null;
      }

      // A successful TRON receipt is not enough: verify the exact canonical USDT
      // Transfer event, destination, raw amount, event index and block before credit.
      if (!destinationAddress || !isPositiveDecimalAmount(expectedAmount)) {
        return null;
      }
      const tokenContract = CANONICAL_USDT_CONTRACTS['TRC20'];
      const eventsRes = await fetch(
        `${tronHost}/v1/transactions/${encodeURIComponent(txHash)}/events?only_confirmed=true&limit=200`,
        { headers, signal: AbortSignal.timeout(8000), cache: 'no-store' }
      );
      if (!eventsRes.ok || !tokenContract) return null;
      const events = await eventsRes.json();
      const verifiedEvent = verifyTronTransferEvent({
        txHash,
        destinationAddress,
        expectedAmount,
        outputIndex,
        tokenContract,
        blockNumber: data.blockNumber,
        events,
      });
      if (!verifiedEvent) return null;

      const confs = currentBlock - data.blockNumber + 1;
      return {
        confirmations: confs,
        blockNumber: data.blockNumber,
        blockHash: solidifiedBlock.blockID,
        fromAddress: verifiedEvent.fromAddress,
      };
    } catch (tronErr) {
      console.warn(`Tron confirmation query error for ${txHash}:`, tronErr);
      return null;
    }
  }

  // UTXO confirmation counts must come from the actual tip height, and the exact
  // output address/value must match the pending deposit record before credit is attempted.
  if (norm === 'BTC' || norm === 'LTC') {
    try {
      const expected = expectedAmount;
      if (!destinationAddress || !isPositiveDecimalAmount(expected)) return null;
      const verified = await verifyUtxoDepositOutput(
        norm,
        txHash,
        destinationAddress,
        outputIndex
      );
      if (!verified) return null;
      let expectedUnits: bigint;
      let verifiedUnits: bigint;
      try {
        expectedUnits = ethers.parseUnits(String(expected).trim(), 8);
        verifiedUnits = ethers.parseUnits(verified.amount, 8);
      } catch {
        return null;
      }
      if (expectedUnits <= 0n || verifiedUnits !== expectedUnits) return null;
      return {
        confirmations: verified.confirmations,
        blockNumber: verified.blockHeight ?? undefined,
        blockHash: verified.blockHash,
      };
    } catch (utxoErr) {
      console.warn(`${norm} deposit verification failed for ${txHash}:`, utxoErr);
      return null;
    }
  }

  // Handle EVM networks (ERC20, BEP20, ETH)
  try {
    const rpcUrl = getRpcUrl(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const receiptPromise = provider.getTransactionReceipt(txHash);
    const transactionPromise = provider.getTransaction(txHash);
    const blockPromise = provider.getBlockNumber();
    const providerNetworkPromise = provider.getNetwork();

    const [receipt, transaction, currentBlock, providerNetwork] = await Promise.all([
      receiptPromise,
      transactionPromise,
      blockPromise,
      providerNetworkPromise,
    ]);

    if (norm !== 'ETH' && norm !== 'ERC20' && norm !== 'BEP20') return null;
    const expectedChainId = norm === 'BEP20' ? 56n : 1n;
    if (providerNetwork.chainId !== expectedChainId) {
      console.error(`[Confirmations Worker] Refusing EVM deposit verification: RPC chain ID mismatch for ${norm}.`);
      return null;
    }
    const tokenContract = CANONICAL_USDT_CONTRACTS[norm] || null;
    // A receipt can refer to a block that has since been orphaned. Fetch the
    // canonical block at its height and require its hash to match both receipt
    // and transaction before this evidence can authorize a deposit credit.
    const canonicalBlock = receipt && Number.isSafeInteger(receipt.blockNumber) && receipt.blockNumber > 0
      ? await provider.getBlock(receipt.blockNumber)
      : null;
    const verified = verifyEvmDepositEvidence({
      network: norm,
      chainId: providerNetwork.chainId,
      txHash,
      destinationAddress: destinationAddress || '',
      expectedAmount: expectedAmount ?? '',
      outputIndex,
      tokenContract,
      transaction,
      receipt,
      currentBlock,
      canonicalBlockHash: typeof canonicalBlock?.hash === 'string' ? canonicalBlock.hash : null,
    });
    if (!verified) {
      return null; // Success alone is insufficient; exact transfer evidence must match.
    }
    return verified;
  } catch (err: any) {
    console.warn(`EVM confirmation check failed for ${txHash} on ${network}:`, err?.message);
    return null;
  }
}

/**
 * Main worker logic: Polling and ingestion processor for pending deposits via canonical process_deposit_atomic RPC
 */
async function executeConfirmationsWorker(): Promise<ConfirmationWorkerResult> {
  const result: ConfirmationWorkerResult = {
    totalScanned: 0,
    confirmedCount: 0,
    pendingCount: 0,
    failedCount: 0,
    details: [],
  };

  try {
    if (!supabaseAdmin) {
      console.error('[Confirmations Worker] Missing Supabase URL or service-role key; refusing to run financial writes.');
      result.failedCount = 1;
      return result;
    }

    // Claim a bounded batch in Postgres before contacting any blockchain provider.
    // SKIP LOCKED + an owner token prevents separate worker processes from verifying
    // and crediting the same pending row concurrently.
    const workerLeaseToken = randomUUID();
    const { data: pendingDeposits, error: claimError } = await supabaseAdmin.rpc(
      'claim_pending_deposit_confirmations',
      {
        p_owner_token: workerLeaseToken,
        p_limit: 10,
        p_lease_seconds: 300,
      }
    );
    if (claimError) {
      console.error('[Confirmations Worker] Could not claim pending deposits:', claimError.message);
      result.failedCount++;
      return result;
    }
    if (!Array.isArray(pendingDeposits) || pendingDeposits.length === 0) return result;

    const releaseDepositClaim = async (depositId: string): Promise<void> => {
      const { error } = await supabaseAdmin.rpc('release_pending_deposit_confirmation_claim', {
        p_deposit_id: depositId,
        p_owner_token: workerLeaseToken,
      });
      if (error) {
        console.error('[Confirmations Worker] Could not release a deposit lease:', {
          depositId,
          code: error.code || null,
        });
      }
    };

    result.totalScanned = pendingDeposits.length;

    // 2. Iterate only rows claimed by this worker process. Every path releases
    // an unconsumed lease; successful DB crediting finalizes the lease atomically.
    for (const deposit of pendingDeposits) {
      const normNet = normalizeDepositNetwork(deposit.network);
      const prevConfs = deposit.confirmations || 0;
      const requiredConfs = getRequiredDepositConfirmations(normNet);
      if (requiredConfs === null || deposit.required_confirmations !== requiredConfs) {
        result.failedCount++;
        result.details.push({
          depositId: deposit.id,
          txHash: deposit.tx_hash,
          network: normNet,
          previousConfirmations: prevConfs,
          newConfirmations: 0,
          requiredConfirmations: requiredConfs ?? 0,
          status: 'ERROR',
          error: requiredConfs === null
            ? 'Unsupported deposit network; refusing credit.'
            : `Stored confirmation threshold mismatch: expected ${requiredConfs}, found ${deposit.required_confirmations}. Reconciliation required; no credit attempted.`,
        });
        await releaseDepositClaim(deposit.id);
        continue;
      }
      const destinationAddress = deposit.to_address || deposit.address;
      const assetSymbol = (deposit.asset_symbol || 'USDT').toUpperCase().trim();
      // Native ETH is verified as a transaction, so its canonical index is zero.
      // Token transfers and UTXO deposits must carry the exact persisted event/output index;
      // never guess zero when the index is absent.
      const outputIndex = normNet === 'ETH' && assetSymbol === 'ETH'
        ? 0
        : (deposit.output_index ?? deposit.log_index ?? -1);
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

      if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) {
        result.pendingCount++;
        result.details.push({
          depositId: deposit.id,
          txHash: deposit.tx_hash,
          network: normNet,
          previousConfirmations: prevConfs,
          newConfirmations: 0,
          requiredConfirmations: requiredConfs,
          status: 'PENDING',
          error: 'Missing or invalid persisted transaction output/event index; no credit attempted.',
        });
        await releaseDepositClaim(deposit.id);
        continue;
      }

      try {
        const onChainData = await fetchOnChainConfirmations(
          deposit.tx_hash,
          normNet,
          destinationAddress,
          outputIndex,
          deposit.amount
        );

        // Never use stale DB confirmations when the chain provider is unavailable or
        // the transaction/output cannot be independently verified. In particular, do
        // not call the crediting RPC with previously stored confirmations.
        if (!onChainData) {
          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: 0,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
            error: 'Independent on-chain verification unavailable or mismatched; no credit attempted.',
          });
          continue;
        }

        const currentConfirmations = onChainData.confirmations;
        const blockNumber = onChainData.blockNumber ?? null;
        const blockHash = onChainData.blockHash;
        const fromAddress = onChainData.fromAddress ?? null;

        // The canonical credit RPC derives its effective confirmation count from this
        // submitted value. Keep the worker-side threshold gate as an independent guard:
        // the RPC is never called until current chain evidence meets the network threshold.
        if (currentConfirmations < requiredConfs) {
          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
            error: 'Verified chain confirmations are below threshold; credit RPC not called.',
          });
          continue;
        }

        // The leased wrapper checks ownership and the exact deposit identity under
        // row lock, then calls the canonical financial RPC in the same transaction.
        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic_with_lease', {
          p_deposit_id: deposit.id,
          p_lease_token: workerLeaseToken,
          p_destination_address: destinationAddress,
          p_asset_symbol: assetSymbol,
          p_network_code: normNet,
          p_amount: deposit.amount,
          p_tx_hash: deposit.tx_hash,
          p_output_index: outputIndex,
          p_block_number: blockNumber,
          p_block_hash: blockHash,
          p_from_address: fromAddress,
          p_token_contract: tokenContract,
          p_confirmations: currentConfirmations,
          p_provider: 'confirmations_worker',
        });

        if (rpcErr) {
          console.error(`RPC process_deposit_atomic failed for ${deposit.tx_hash}:`, rpcErr);
          result.failedCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'ERROR',
            error: rpcErr.message || 'Deposit credit RPC failed.',
          });
        } else {
          const parsedRes = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
          // Accept only the exact deployed SQL RPC success/replay shapes. A status
          // string or compatibility alias must never independently authorize credit.
          const isCredited = parsedRes?.success === true && (
            (
              parsedRes?.status === 'CONFIRMED' &&
              parsedRes?.credited === true &&
              parsedRes?.already_credited === false
            ) || (
              parsedRes?.status === 'ALREADY_CREDITED' &&
              parsedRes?.credited === false &&
              parsedRes?.already_credited === true
            )
          );

          if (isCredited) {
            result.confirmedCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: currentConfirmations,
              requiredConfirmations: requiredConfs,
              status: 'CREDITED',
            });
          } else {
            result.failedCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: currentConfirmations,
              requiredConfirmations: requiredConfs,
              status: 'ERROR',
              error: typeof parsedRes?.code === 'string'
                ? 'Credit RPC rejected deposit: ' + parsedRes.code
                : 'Credit RPC returned an unrecognized or unsuccessful response; credit not confirmed.',
            });
          }
        }
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
      } finally {
        await releaseDepositClaim(deposit.id);
      }
    }

    return result;
  } catch (err: any) {
    console.error('Fatal error in runConfirmationsWorker:', err);
    result.failedCount++;
    return result;
  }
}

let activeWorkerRun: Promise<ConfirmationWorkerResult> | null = null;

/**
 * Share one in-flight run within this Node.js process so route invocations and
 * the optional interval scheduler cannot process the same batch concurrently.
 * Cross-process coordination still requires a database claim/lease.
 */
export function runConfirmationsWorker(): Promise<ConfirmationWorkerResult> {
  if (activeWorkerRun) return activeWorkerRun;

  activeWorkerRun = executeConfirmationsWorker().finally(() => {
    activeWorkerRun = null;
  });
  return activeWorkerRun;
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
