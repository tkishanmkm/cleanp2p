import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS, getBtcMempoolApi, verifyUtxoDepositOutput, verifyEvmNativeDeposit, verifyEvmTokenDeposit, verifyTronTokenDeposit } from '@/jobs/depositIngestion';
import { SUPPORTED_EVM_CHAINS, getEvmProvider } from '@/lib/blockchain/providers';

// Privileged confirmation processing must fail closed: never fall back to the public anon key.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim();

if (!supabaseUrl) {
  throw new Error(
    'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for privileged deposit processing; refusing to connect to a hard-coded project.'
  );
}
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (
  !supabaseKey ||
  supabaseKey === 'placeholder-key' ||
  supabaseKey === 'placeholder-anon-key'
) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is required for privileged deposit confirmation processing but is missing or not configured.'
  );
}

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
): Promise<{ confirmations: number; blockNumber?: number; blockHash?: string; fromAddress?: string } | null> {
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
      if (!nowRes.ok) return null;

      const nowData = await nowRes.json();
      const currentBlock = nowData?.block_header?.raw_data?.number;

      // Never assume confirmations when the node cannot provide the current block height.
      if (
        !Number.isSafeInteger(currentBlock) ||
        currentBlock < data.blockNumber ||
        !Number.isSafeInteger(data.blockNumber) ||
        data.blockNumber <= 0
      ) {
        return null;
      }

      const confs = currentBlock - data.blockNumber + 1;
      return { confirmations: confs, blockNumber: data.blockNumber };
    } catch (tronErr) {
      console.warn(`Tron confirmation query error for ${txHash}:`, tronErr);
      return null;
    }
  }

  // Handle Bitcoin (BTC)
  if (norm === 'BTC') {
    try {
      const btcApiBase = (process.env.BTC_MEMPOOL_API || 'https://mempool.space/api').replace(/\/$/, '');
      const res = await fetch(`${btcApiBase}/tx/${txHash}/status`);
      if (!res.ok) return null;
      const statusData = await res.json();
      const tipRes = await fetch(`${btcApiBase}/blocks/tip/height`);
      if (!tipRes.ok) return null;
      const tipRaw = (await tipRes.text()).trim();
      if (!/^\d+$/.test(tipRaw)) return null;
      const tipHeight = Number(tipRaw);
      const blockHeight = statusData.block_height;
      const reportedHash = String(statusData.block_hash || '').toLowerCase();
      if (!statusData.confirmed || !Number.isSafeInteger(blockHeight) || blockHeight <= 0 ||
          !Number.isSafeInteger(tipHeight) || tipHeight < blockHeight ||
          !/^[0-9a-f]{64}$/.test(reportedHash)) return null;
      const [canonicalRes, txidsRes] = await Promise.all([
        fetch(`${btcApiBase}/block-height/${blockHeight}`),
        fetch(`${btcApiBase}/block/${reportedHash}/txids`),
      ]);
      if (!canonicalRes.ok || !txidsRes.ok) return null;
      const canonicalHash = (await canonicalRes.text()).trim().toLowerCase();
      const blockTxids = await txidsRes.json();
      if (canonicalHash !== reportedHash || !Array.isArray(blockTxids) ||
          !blockTxids.some((id: unknown) => typeof id === 'string' && id.toLowerCase() === txHash.toLowerCase())) return null;
      return { confirmations: tipHeight - blockHeight + 1, blockNumber: blockHeight, blockHash: canonicalHash };
    } catch (btcErr) {
      console.warn(`BTC confirmation query error for ${txHash}:`, btcErr);
      return null;
    }
  }

  // Handle Litecoin (LTC)
  if (norm === 'LTC') {
    try {
      const ltcApiBase = (process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api').replace(/\/$/, '');
      const res = await fetch(`${ltcApiBase}/tx/${txHash}/status`);
      if (!res.ok) return null;
      const statusData = await res.json();
      const tipRes = await fetch(`${ltcApiBase}/blocks/tip/height`);
      if (!tipRes.ok) return null;
      const tipRaw = (await tipRes.text()).trim();
      if (!/^\d+$/.test(tipRaw)) return null;
      const tipHeight = Number(tipRaw);
      const blockHeight = statusData.block_height;
      const reportedHash = String(statusData.block_hash || '').toLowerCase();
      if (!statusData.confirmed || !Number.isSafeInteger(blockHeight) || blockHeight <= 0 ||
          !Number.isSafeInteger(tipHeight) || tipHeight < blockHeight ||
          !/^[0-9a-f]{64}$/.test(reportedHash)) return null;
      const [canonicalRes, txidsRes] = await Promise.all([
        fetch(`${ltcApiBase}/block-height/${blockHeight}`),
        fetch(`${ltcApiBase}/block/${reportedHash}/txids`),
      ]);
      if (!canonicalRes.ok || !txidsRes.ok) return null;
      const canonicalHash = (await canonicalRes.text()).trim().toLowerCase();
      const blockTxids = await txidsRes.json();
      if (canonicalHash !== reportedHash || !Array.isArray(blockTxids) ||
          !blockTxids.some((id: unknown) => typeof id === 'string' && id.toLowerCase() === txHash.toLowerCase())) return null;
      return { confirmations: tipHeight - blockHeight + 1, blockNumber: blockHeight, blockHash: canonicalHash };
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

    // A mined but failed EVM transaction did not transfer funds.
    if (receipt.status !== 1) {
      return null;
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
 * Read-only audit of already-confirmed deposits against the current canonical chain.
 * This intentionally never changes balances, statuses, confirmations, or ledger rows.
 * A mismatch is a review signal, not permission to reverse a credit automatically.
 */
export interface ConfirmedDepositReorgAuditResult {
  scanned: number;
  matched: number;
  suspectedReorg: number;
  unverifiable: number;
  hasMore: boolean;
  nextCursor: string | null;
  details: Array<{
    depositId: string;
    txHash: string;
    network: string;
    status: 'MATCH' | 'REORG_SUSPECTED' | 'UNVERIFIABLE';
    storedBlockHash: string | null;
    observedBlockHash: string | null;
    note: string;
  }>;
}

function normalizeBlockHash(hash: unknown): string | null {
  if (typeof hash !== 'string') return null;
  const normalized = hash.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export async function runConfirmedDepositReorgAudit(
  limit: number = 100,
  afterId: string | null = null
): Promise<ConfirmedDepositReorgAuditResult> {
  const result: ConfirmedDepositReorgAuditResult = {
    scanned: 0,
    matched: 0,
    suspectedReorg: 0,
    unverifiable: 0,
    hasMore: false,
    nextCursor: null,
    details: [],
  };
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, limit)) : 100;

  if (afterId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(afterId)) {
    throw new Error('Invalid confirmed-deposit reorg audit cursor; expected a UUID.');
  }

  let query = supabaseAdmin
    .from('onchain_deposits')
    // The canonical credit RPC records credited on-chain rows as CREDITED.
    // Include CONFIRMED for legacy rows so the audit does not silently skip them.
    .select('*')
    .in('status', ['CONFIRMED', 'CREDITED'])
    .order('id', { ascending: true })
    .limit(safeLimit);
  if (afterId !== null) query = query.gt('id', afterId);

  const { data: deposits, error } = await query;

  if (error) {
    throw new Error(`Confirmed-deposit reorg audit query failed: ${error.message}`);
  }

  const batch = deposits || [];
  result.hasMore = batch.length === safeLimit;
  result.nextCursor = result.hasMore ? String(batch[batch.length - 1]?.id || '') || null : null;

  for (const deposit of batch) {
    result.scanned++;
    const network = normalizeDepositNetwork(deposit.network || deposit.network_code || '');
    const storedHash = normalizeBlockHash(deposit.block_hash);
    const destination = deposit.to_address || deposit.address;
    const index = deposit.output_index ?? deposit.log_index;
    const symbol = String(deposit.asset_symbol || deposit.asset || 'USDT').toUpperCase().trim();
    let observedHash: string | null = null;
    let verificationError = 'No supported independent verifier for this deposit network/asset.';

    try {
      if ((network === 'BTC' || network === 'LTC') && index != null) {
        const base = network === 'BTC'
          ? getBtcMempoolApi()
          : (process.env.LTC_MEMPOOL_API?.trim() || 'https://litecoinspace.org/api');
        const verified = await verifyUtxoDepositOutput(base, deposit.tx_hash, index, destination, deposit.amount);
        observedHash = verified?.blockHash || null;
        if (!verified) verificationError = 'BTC/LTC transaction output or canonical block could not be independently verified.';
      } else if (network === 'TRC20' && symbol === 'USDT' && index != null) {
        const verified = await verifyTronTokenDeposit(deposit.tx_hash, index, destination, deposit.amount);
        observedHash = verified?.blockHash || null;
        if (!verified) verificationError = 'TRON Transfer event or canonical block could not be independently verified.';
      } else if (SUPPORTED_EVM_CHAINS[network]) {
        const chain = SUPPORTED_EVM_CHAINS[network];
        if (symbol === 'USDT' && index != null) {
          const verified = await verifyEvmTokenDeposit(
            getEvmProvider(network), deposit.tx_hash, index, destination, deposit.amount,
            CANONICAL_USDT_CONTRACTS[network] || chain.usdtContractAddress || '',
            chain.usdtDecimals ?? 6
          );
          observedHash = verified?.blockHash || null;
          if (!verified) verificationError = 'EVM Transfer event or canonical block could not be independently verified.';
        } else {
          const verified = await verifyEvmNativeDeposit(
            getEvmProvider(network), deposit.tx_hash, destination, deposit.amount, chain.nativeDecimals
          );
          observedHash = verified?.blockHash || null;
          if (!verified) verificationError = 'EVM native transfer or canonical block could not be independently verified.';
        }
      }

      const normalizedObserved = normalizeBlockHash(observedHash);
      let status: 'MATCH' | 'REORG_SUSPECTED' | 'UNVERIFIABLE';
      let note: string;
      if (!storedHash || !normalizedObserved) {
        status = 'UNVERIFIABLE';
        note = !storedHash && normalizedObserved
          ? 'Current canonical block was verified, but no stored block hash exists for comparison. Treat as a backfill candidate; no records or funds were changed.'
          : verificationError;
        result.unverifiable++;
      } else if (storedHash !== normalizedObserved) {
        status = 'REORG_SUSPECTED';
        note = 'Stored and currently observed canonical block hashes differ. Manual reconciliation is required; no funds or records were changed.';
        result.suspectedReorg++;
      } else {
        status = 'MATCH';
        note = 'Stored block hash matches the independently observed canonical block.';
        result.matched++;
      }
      result.details.push({
        depositId: String(deposit.id),
        txHash: String(deposit.tx_hash),
        network,
        status,
        storedBlockHash: storedHash,
        observedBlockHash: normalizedObserved,
        note,
      });
    } catch (err: any) {
      result.unverifiable++;
      result.details.push({
        depositId: String(deposit.id),
        txHash: String(deposit.tx_hash),
        network,
        status: 'UNVERIFIABLE',
        storedBlockHash: storedHash,
        observedBlockHash: normalizeBlockHash(observedHash),
        note: err?.message || verificationError,
      });
    }
  }
  return result;
}

/**
 * Persist audit findings to the review queue only. This function never modifies
 * deposit, wallet, balance, or ledger rows and must only be called after the
 * incident-table migration has been applied and verified.
 */
export async function recordConfirmedDepositReorgIncidents(
  audit: ConfirmedDepositReorgAuditResult
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const counts = { inserted: 0, updated: 0, skipped: 0 };

  for (const detail of audit.details) {
    if (detail.status === 'MATCH') {
      counts.skipped++;
      continue;
    }

    const network = String(detail.network || '').trim().toUpperCase();
    const txHash = String(detail.txHash || '').trim().toLowerCase();
    if (!network || !txHash || !detail.depositId) {
      counts.skipped++;
      continue;
    }

    // The audit detail currently does not expose output index. Resolve it from
    // the confirmed on-chain row so the incident identity is transaction-output scoped.
    const { data: sourceDeposit, error: sourceError } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, network, tx_hash, output_index, log_index')
      .eq('id', detail.depositId)
      .maybeSingle();

    if (sourceError || !sourceDeposit) {
      console.error('Could not resolve source deposit for reorg incident:', sourceError?.message || detail.depositId);
      counts.skipped++;
      continue;
    }

    const sourceNetwork = String(sourceDeposit.network || '').trim().toUpperCase();
    const sourceTxHash = String(sourceDeposit.tx_hash || '').trim().toLowerCase();
    const sourceOutputIndex = sourceDeposit.output_index ?? sourceDeposit.log_index;
    if (
      sourceNetwork !== network ||
      sourceTxHash !== txHash ||
      !Number.isSafeInteger(sourceOutputIndex) ||
      sourceOutputIndex < 0
    ) {
      console.error('Skipping reorg incident because source deposit identity/output index is invalid or mismatched:', detail.depositId);
      counts.skipped++;
      continue;
    }
    const outputIndex = sourceOutputIndex;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('deposit_reorg_incidents')
      .select('id, stored_block_hash, observed_block_hash, review_status, observation_count')
      .eq('network', network)
      .eq('tx_hash', txHash)
      .eq('output_index', outputIndex)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Could not inspect existing deposit reorg incident: ${existingError.message}`);
    }

    const incidentType = detail.status === 'REORG_SUSPECTED'
      ? 'REORG_SUSPECTED'
      : (!detail.storedBlockHash && detail.observedBlockHash
        ? 'MISSING_STORED_HASH'
        : 'UNVERIFIABLE');
    const now = new Date().toISOString();
    const hashChanged = Boolean(existing && (
      (existing.stored_block_hash || null) !== (detail.storedBlockHash || null)
      || (existing.observed_block_hash || null) !== (detail.observedBlockHash || null)
    ));

    const row = {
      network,
      tx_hash: txHash,
      output_index: outputIndex,
      deposit_id: detail.depositId,
      incident_type: incidentType,
      stored_block_hash: detail.storedBlockHash,
      observed_block_hash: detail.observedBlockHash,
      last_seen_at: now,
      observation_count: (existing?.observation_count || 0) + 1,
      metadata: { note: detail.note, auditStatus: detail.status },
      ...(existing ? {} : { first_seen_at: now, review_status: 'OPEN' }),
      ...(existing && hashChanged ? { review_status: 'OPEN' } : {}),
    };

    const { error: writeError } = existing
      ? await supabaseAdmin.from('deposit_reorg_incidents').update(row).eq('id', existing.id)
      : await supabaseAdmin.from('deposit_reorg_incidents').insert(row);

    if (writeError) {
      throw new Error(`Could not record deposit reorg incident: ${writeError.message}`);
    }

    if (existing) counts.updated++;
    else counts.inserted++;
  }

  return counts;
}

// In-memory keyset cursor prevents the same first 50 long-pending deposits from
// monopolizing every poll. The cursor is intentionally a fairness optimization,
// not a durable recovery checkpoint; the worker wraps around after reaching the end.
let pendingDepositCursor: string | null = null;

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
    // 1. Fetch a bounded page of pending on-chain deposits using a rotating keyset cursor.
    let query = supabaseAdmin
      .from('onchain_deposits')
      .select('*')
      .eq('status', 'PENDING')
      .order('id', { ascending: true })
      .limit(50);

    if (pendingDepositCursor) {
      query = query.gt('id', pendingDepositCursor);
    }

    let { data: pendingDeposits, error } = await query;

    if (error) {
      console.error('Failed to query pending deposits:', error.message);
      // Do not report a successful-looking empty result when the queue query failed.
      result.failedCount++;
      return result;
    }

    // Wrap around so rows before the cursor are revisited on later cycles.
    if ((!pendingDeposits || pendingDeposits.length === 0) && pendingDepositCursor) {
      const wrapped = await supabaseAdmin
        .from('onchain_deposits')
        .select('*')
        .eq('status', 'PENDING')
        .order('id', { ascending: true })
        .limit(50);
      pendingDeposits = wrapped.data;
      error = wrapped.error;
      if (error) {
        console.error('Failed to wrap pending-deposit queue:', error.message);
        result.failedCount++;
        return result;
      }
    }

    if (!pendingDeposits || pendingDeposits.length === 0) {
      pendingDepositCursor = null;
      return result;
    }

    result.totalScanned = pendingDeposits.length;

    // 2. Iterate through each pending deposit
    for (const deposit of pendingDeposits) {
      const normNet = normalizeDepositNetwork(deposit.network);
      const requiredConfs = deposit.required_confirmations || 12;
      const prevConfs = deposit.confirmations || 0;
      const destinationAddress = deposit.to_address || deposit.address;
      const outputIndex = deposit.output_index ?? deposit.log_index ?? 0;
      const assetSymbol = (deposit.asset_symbol || 'USDT').toUpperCase().trim();
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

      try {
        // Output/log index is part of the identity for UTXO outputs and token
        // transfer events. Never default a missing index to zero for these assets.
        const indexRequired =
          normNet === 'BTC' ||
          normNet === 'LTC' ||
          (assetSymbol === 'USDT' && (
            normNet === 'TRC20' ||
            Boolean(SUPPORTED_EVM_CHAINS[normNet])
          ));
        if (indexRequired && deposit.output_index == null && deposit.log_index == null) {
          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: 0,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
            error: 'Required output/event index is missing; credit RPC not called.',
          });
          continue;
        }

        const onChainData = await fetchOnChainConfirmations(deposit.tx_hash, normNet);

        // Fail closed when the chain provider cannot independently confirm this
        // transaction. Never reuse database-stored confirmations to authorize credit.
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
            error: 'On-chain transaction/confirmation check unavailable; credit RPC not called.',
          });
          continue;
        }

        // A TRON transaction's confirmation count does not prove a matching TRC-20
        // Transfer event. Keep it pending until this worker validates contract, log
        // index, destination, and raw amount independently.
        let verifiedTronBlockHash: string | null = null;
        if (normNet === 'TRC20' && assetSymbol === 'USDT') {
          if (deposit.output_index == null && deposit.log_index == null) {
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: onChainData.confirmations,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
              error: 'Stored TRC-20 event index is missing; credit RPC not called.',
            });
            continue;
          }

          const verified = await verifyTronTokenDeposit(
            deposit.tx_hash,
            outputIndex,
            destinationAddress,
            deposit.amount
          );
          if (!verified) {
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: onChainData.confirmations,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
              error: 'Exact TRC-20 event verification failed; credit RPC not called.',
            });
            continue;
          }
          onChainData.confirmations = verified.confirmations;
          onChainData.blockNumber = verified.blockNumber;
          onChainData.fromAddress = verified.fromAddress;
          verifiedTronBlockHash = verified.blockHash;
        }

        let currentConfirmations = onChainData.confirmations;
        let blockNumber = onChainData.blockNumber ?? deposit.block_number;
        let fromAddress = onChainData.fromAddress ?? deposit.from_address;
        let verifiedBlockHash: string | null = verifiedTronBlockHash || onChainData.blockHash || null;

        // BTC/LTC transaction inclusion alone is not enough: independently verify
        // the exact output index, destination, and satoshi amount before crediting.
        if (normNet === 'BTC' || normNet === 'LTC') {
          const utxoApiBase = normNet === 'BTC'
            ? getBtcMempoolApi()
            : (process.env.LTC_MEMPOOL_API?.trim() || 'https://litecoinspace.org/api');
          const verified = await verifyUtxoDepositOutput(
            utxoApiBase,
            deposit.tx_hash,
            outputIndex,
            destinationAddress,
            deposit.amount
          );
          if (!verified || !verified.blockHash || verified.blockHeight === null) {
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: verified?.confirmations ?? 0,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
              error: 'Exact BTC/LTC output or canonical block verification failed; credit RPC not called.',
            });
            continue;
          }
          currentConfirmations = verified.confirmations;
          blockNumber = verified.blockHeight;
          verifiedBlockHash = verified.blockHash;
        }

        // For EVM USDT, transaction success alone is insufficient: prove that the
        // exact receipt log matches the configured contract, index, recipient, and amount.
        if (assetSymbol === 'USDT' && SUPPORTED_EVM_CHAINS[normNet]) {
          const chain = SUPPORTED_EVM_CHAINS[normNet];
          const verified = await verifyEvmTokenDeposit(
            getEvmProvider(normNet),
            deposit.tx_hash,
            outputIndex,
            destinationAddress,
            deposit.amount,
            tokenContract || chain.usdtContractAddress || '',
            chain.usdtDecimals ?? 6,
            chain.chainId
          );
          if (!verified) {
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: onChainData.confirmations,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
              error: 'Exact ERC-20 Transfer log validation failed; credit RPC not called.',
            });
            continue;
          }
          currentConfirmations = verified.confirmations;
          blockNumber = verified.blockNumber;
          fromAddress = verified.fromAddress;
          verifiedBlockHash = verified.blockHash;
        } else if (SUPPORTED_EVM_CHAINS[normNet]) {
          // For native coins, verify the exact tx.to and tx.value against the
          // stored deposit before invoking the privileged credit RPC.
          const chain = SUPPORTED_EVM_CHAINS[normNet];
          const verified = await verifyEvmNativeDeposit(
            getEvmProvider(normNet),
            deposit.tx_hash,
            destinationAddress,
            deposit.amount,
            chain.nativeDecimals,
            chain.chainId
          );
          if (!verified) {
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: onChainData.confirmations,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
              error: 'Exact native transaction destination/value verification failed; credit RPC not called.',
            });
            continue;
          }
          currentConfirmations = verified.confirmations;
          blockNumber = verified.blockNumber;
          fromAddress = verified.fromAddress;
          verifiedBlockHash = verified.blockHash;
        }

        // Never invoke the privileged credit RPC without a valid canonical
        // block height and hash returned by independent network verification.
        // Do not fall back to a database-stored height to authorize credit.
        if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
            error: 'Verified canonical block height is missing or invalid; credit RPC not called.',
          });
          continue;
        }

        const canonicalVerifiedBlockHash = normalizeBlockHash(verifiedBlockHash);
        if (!canonicalVerifiedBlockHash) {
          result.pendingCount++;
          result.details.push({
            depositId: deposit.id,
            txHash: deposit.tx_hash,
            network: normNet,
            previousConfirmations: prevConfs,
            newConfirmations: currentConfirmations,
            requiredConfirmations: requiredConfs,
            status: 'PENDING',
            error: 'Verified canonical block hash is missing or invalid; credit RPC not called.',
          });
          continue;
        }

        // Call authoritative canonical RPC process_deposit_atomic
        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: assetSymbol,
          p_network_code: normNet,
          p_amount: deposit.amount,
          p_tx_hash: deposit.tx_hash,
          p_output_index: outputIndex,
          p_block_number: blockNumber,
          p_from_address: fromAddress,
          p_token_contract: assetSymbol === 'USDT' ? tokenContract : null,
          p_confirmations: currentConfirmations,
          p_provider: 'confirmations_worker',
          p_block_hash: canonicalVerifiedBlockHash,
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
            error: rpcErr.message,
          });
        } else {
          const parsedRes = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
          const isCredited = parsedRes?.status === 'credited' || parsedRes?.status === 'CONFIRMED' || parsedRes?.status === 'ALREADY_CREDITED';

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
            result.pendingCount++;
            result.details.push({
              depositId: deposit.id,
              txHash: deposit.tx_hash,
              network: normNet,
              previousConfirmations: prevConfs,
              newConfirmations: currentConfirmations,
              requiredConfirmations: requiredConfs,
              status: 'PENDING',
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
      }
    }

    // Advance only after this page has been processed. Rows that remain PENDING
    // will be revisited after the cursor wraps around.
    pendingDepositCursor = String(pendingDeposits[pendingDeposits.length - 1].id);

    return result;
  } catch (err: any) {
    console.error('Fatal error in runConfirmationsWorker:', err);
    // Surface top-level worker failures in the result consumed by monitoring.
    result.failedCount++;
    return result;
  }
}

let workerIntervalHandle: NodeJS.Timeout | null = null;
let confirmationCycleInProgress = false;

async function runScheduledConfirmationCycle(): Promise<void> {
  if (confirmationCycleInProgress) {
    console.warn('Previous confirmation cycle is still running; skipping overlapping scheduled cycle.');
    return;
  }

  confirmationCycleInProgress = true;
  try {
    const result = await runConfirmationsWorker();
    if (result.failedCount > 0) {
      console.error(`Confirmation worker cycle completed with ${result.failedCount} failure(s).`);
    }
  } catch (err) {
    console.error('Scheduled confirmation worker cycle failed:', err);
  } finally {
    confirmationCycleInProgress = false;
  }
}

export function startConfirmationsWorker(intervalMs: number = 30000): void {
  if (workerIntervalHandle) {
    console.log('Confirmations worker already running.');
    return;
  }

  console.log(`Starting confirmations worker polling every ${intervalMs}ms...`);
  void runScheduledConfirmationCycle();

  workerIntervalHandle = setInterval(() => {
    void runScheduledConfirmationCycle();
  }, intervalMs);
}

export function stopConfirmationsWorker(): void {
  if (workerIntervalHandle) {
    clearInterval(workerIntervalHandle);
    workerIntervalHandle = null;
    console.log('Confirmations worker stopped.');
  }
}
