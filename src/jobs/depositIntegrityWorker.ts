import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { normalizeNetworkCode, SUPPORTED_EVM_CHAINS } from '@/lib/blockchain/providers';
import { hasSupabaseServiceConfig, supabaseService } from '@/lib/supabase/service-role';

type IntegrityOutcome = 'MATCH' | 'MISMATCH' | 'INCONCLUSIVE';

interface ProviderObservation {
  provider: string;
  blockHash: string | null;
  reason?: string;
}

interface IntegrityInspection {
  outcome: IntegrityOutcome;
  provider: string;
  observedBlockHash: string | null;
  reason?: string;
  providerEvidence?: ProviderObservation[];
}

interface ClaimedDeposit {
  id: string;
  network: string;
  tx_hash: string;
  block_number: number | string;
  block_hash: string;
}

const supabaseAdmin = hasSupabaseServiceConfig() ? supabaseService : null;
let activeRun: Promise<{ scanned: number; mismatches: number; inconclusive: number }> | null = null;
let missingMigrationNoticeLogged = false;
const evmProviderCache = new Map<string, ethers.JsonRpcProvider>();

function validBlockHash(network: string, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeNetworkCode(network);
  return normalized === 'ERC20' || normalized === 'BEP20'
    ? /^0x[a-fA-F0-9]{64}$/.test(value)
    : /^(?!0x)[a-fA-F0-9]{64}$/.test(value);
}

function inconclusive(
  provider: string,
  reason: string,
  providerEvidence?: ProviderObservation[]
): IntegrityInspection {
  return { outcome: 'INCONCLUSIVE', provider, observedBlockHash: null, reason, providerEvidence };
}

function distinctHttpsUrls(values: string[]): string[] {
  const origins = new Set<string>();
  const urls: string[] = [];

  for (const value of values) {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password || origins.has(url.origin)) continue;
      origins.add(url.origin);
      urls.push(url.toString().replace(/\/$/, ''));
    } catch {
      // Invalid optional providers are ignored; fewer than two valid origins
      // causes the observation to remain inconclusive.
    }
    if (urls.length === 3) break;
  }

  return urls;
}

/** Two independent origins must agree on the active-chain hash. */
function resolveProviderQuorum(
  providerGroup: string,
  expectedHash: string,
  observations: ProviderObservation[]
): IntegrityInspection {
  const votes = new Map<string, string[]>();
  for (const observation of observations) {
    if (!observation.blockHash) continue;
    const hash = observation.blockHash.toLowerCase();
    const group = votes.get(hash) || [];
    group.push(observation.provider);
    votes.set(hash, group);
  }

  const quorum = Array.from(votes.entries()).find(([, providers]) => providers.length >= 2);
  if (!quorum) {
    return inconclusive(
      providerGroup,
      'independent_provider_quorum_unavailable_or_disagreeing',
      observations
    );
  }

  const [observedHash, providers] = quorum;
  return {
    outcome: observedHash === expectedHash.toLowerCase() ? 'MATCH' : 'MISMATCH',
    provider: providers.join(','),
    observedBlockHash: observations.find(
      (item) => item.blockHash?.toLowerCase() === observedHash
    )?.blockHash || null,
    providerEvidence: observations,
  };
}

async function inspectEvmBlock(
  network: 'ERC20' | 'BEP20',
  height: number,
  expectedHash: string
): Promise<IntegrityInspection> {
  const chain = network === 'BEP20'
    ? SUPPORTED_EVM_CHAINS.BEP20
    : SUPPORTED_EVM_CHAINS.ERC20;
  const providerGroup = network === 'BEP20' ? 'bsc_rpc_quorum' : 'ethereum_rpc_quorum';
  const urls = distinctHttpsUrls(chain.rpcUrls);
  if (urls.length < 2) {
    return inconclusive(providerGroup, 'fewer_than_two_independent_rpc_origins_configured');
  }

  const chainId = BigInt(chain.chainId);
  const observations = await Promise.all(urls.map(async (rpcUrl): Promise<ProviderObservation> => {
    let provider: ethers.JsonRpcProvider;
    try {
      provider = evmProviderCache.get(rpcUrl) || new ethers.JsonRpcProvider(rpcUrl);
      evmProviderCache.set(rpcUrl, provider);
      const [actualNetwork, block] = await Promise.all([
        provider.getNetwork(),
        provider.getBlock(height),
      ]);
      const hostname = new URL(rpcUrl).hostname;

      if (actualNetwork.chainId !== chainId) {
        return { provider: hostname, blockHash: null, reason: 'rpc_chain_id_mismatch' };
      }
      if (!block || typeof block.hash !== 'string' || !validBlockHash(network, block.hash)) {
        return { provider: hostname, blockHash: null, reason: 'canonical_block_unavailable_or_invalid' };
      }
      return { provider: hostname, blockHash: block.hash };
    } catch {
      return { provider: new URL(rpcUrl).hostname, blockHash: null, reason: 'rpc_request_failed' };
    }
  }));

  return resolveProviderQuorum(providerGroup, expectedHash, observations);
}

async function inspectUtxoBlock(
  network: 'BTC' | 'LTC',
  height: number,
  expectedHash: string
): Promise<IntegrityInspection> {
  const primary = network === 'BTC'
    ? process.env.BTC_MEMPOOL_API || 'https://mempool.space/api'
    : process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
  const backup = network === 'BTC'
    ? process.env.BTC_MEMPOOL_BACKUP_API
    : process.env.LTC_MEMPOOL_BACKUP_API;
  const providerGroup = network === 'BTC' ? 'bitcoin_explorer_quorum' : 'litecoin_explorer_quorum';
  const urls = distinctHttpsUrls([primary, backup || '']);
  if (urls.length < 2) {
    return inconclusive(
      providerGroup,
      network === 'BTC'
        ? 'configure_BTC_MEMPOOL_BACKUP_API_for_independent_verification'
        : 'configure_LTC_MEMPOOL_BACKUP_API_for_independent_verification'
    );
  }

  const observations = await Promise.all(urls.map(async (base): Promise<ProviderObservation> => {
    const hostname = new URL(base).hostname;
    try {
      const response = await fetch(`${base}/block-height/${height}`, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (!response.ok) {
        return { provider: hostname, blockHash: null, reason: `explorer_http_${response.status}` };
      }

      const canonicalHash = (await response.text()).trim();
      if (!/^[a-fA-F0-9]{64}$/.test(canonicalHash)) {
        return { provider: hostname, blockHash: null, reason: 'canonical_hash_invalid' };
      }
      return { provider: hostname, blockHash: canonicalHash };
    } catch {
      return { provider: hostname, blockHash: null, reason: 'explorer_request_failed' };
    }
  }));

  return resolveProviderQuorum(providerGroup, expectedHash, observations);
}

async function inspectTronBlock(height: number, expectedHash: string): Promise<IntegrityInspection> {
  const primary = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  const backup = process.env.TRON_BACKUP_RPC_URL || '';
  const urls = distinctHttpsUrls([primary, backup]);
  if (urls.length < 2) {
    return inconclusive('tron_solidity_node_quorum', 'configure_TRON_BACKUP_RPC_URL_for_independent_verification');
  }

  const observations = await Promise.all(urls.map(async (host): Promise<ProviderObservation> => {
    const hostname = new URL(host).hostname;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.TRON_PRO_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRON_PRO_API_KEY;

    try {
      const response = await fetch(`${host}/walletsolidity/getblockbynum`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ num: height }),
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      if (!response.ok) {
        return { provider: hostname, blockHash: null, reason: `solidity_node_http_${response.status}` };
      }

      const block: any = await response.json();
      const canonicalHash = block?.blockID;
      if (
        block?.block_header?.raw_data?.number !== height ||
        typeof canonicalHash !== 'string' ||
        !/^[a-fA-F0-9]{64}$/.test(canonicalHash)
      ) {
        return { provider: hostname, blockHash: null, reason: 'solidified_block_unavailable_or_invalid' };
      }
      return { provider: hostname, blockHash: canonicalHash };
    } catch {
      return { provider: hostname, blockHash: null, reason: 'solidity_node_request_failed' };
    }
  }));

  return resolveProviderQuorum('tron_solidity_node_quorum', expectedHash, observations);
}

/**
 * Reads only the canonical block identity at the height persisted when the
 * deposit was credited. A different hash is an integrity signal requiring
 * manual review; it never authorizes an automated financial reversal.
 */
async function inspectCanonicalBlock(row: ClaimedDeposit): Promise<IntegrityInspection> {
  const normalizedNetwork = normalizeNetworkCode(row.network);
  const height = Number(row.block_number);

  if (!Number.isSafeInteger(height) || height <= 0 || !validBlockHash(normalizedNetwork, row.block_hash)) {
    return inconclusive('identity_validation', 'persisted_block_identity_invalid');
  }

  if (normalizedNetwork === 'ERC20' || normalizedNetwork === 'BEP20') {
    return inspectEvmBlock(normalizedNetwork, height, row.block_hash);
  }
  if (normalizedNetwork === 'BTC' || normalizedNetwork === 'LTC') {
    return inspectUtxoBlock(normalizedNetwork, height, row.block_hash);
  }
  if (normalizedNetwork === 'TRC20') {
    return inspectTronBlock(height, row.block_hash);
  }

  return inconclusive('unsupported_network', 'network_not_supported_by_integrity_monitor');
}

async function executeIntegrityMonitor(): Promise<{ scanned: number; mismatches: number; inconclusive: number }> {
  const result = { scanned: 0, mismatches: 0, inconclusive: 0 };
  if (!supabaseAdmin) {
    console.warn('[Deposit Integrity] Service-role Supabase configuration unavailable; monitor skipped.');
    return result;
  }

  const ownerToken = randomUUID();
  const { data, error } = await supabaseAdmin.rpc('claim_deposit_integrity_checks', {
    p_owner_token: ownerToken,
    p_limit: 20,
    p_lease_seconds: 600,
  });

  if (error) {
    if (['PGRST202', '42883'].includes(String(error.code || ''))) {
      if (!missingMigrationNoticeLogged) {
        console.warn('[Deposit Integrity] Integrity-monitor migration is not installed; monitor remains dormant.');
        missingMigrationNoticeLogged = true;
      }
      return result;
    }
    console.error('[Deposit Integrity] Could not claim integrity checks:', {
      code: error.code || null,
      message: error.message || 'unknown database error',
    });
    return result;
  }

  missingMigrationNoticeLogged = false;
  const rows = Array.isArray(data) ? data as ClaimedDeposit[] : [];
  result.scanned = rows.length;

  for (const row of rows) {
    let inspection: IntegrityInspection;
    try {
      inspection = await inspectCanonicalBlock(row);
    } catch {
      inspection = inconclusive('integrity_monitor', 'unexpected_inspection_error');
    }

    const nextCheckSeconds = inspection.outcome === 'MATCH' ? 3600 : 300;
    const evidence = {
      outcome: inspection.outcome,
      reason: inspection.reason || null,
      providers: inspection.providerEvidence || [],
      quorum_required: 2,
      checked_at: new Date().toISOString(),
      check: 'canonical_block_at_persisted_height',
    };

    const { data: completed, error: completeError } = await supabaseAdmin.rpc(
      'complete_deposit_integrity_check',
      {
        p_deposit_id: row.id,
        p_owner_token: ownerToken,
        p_outcome: inspection.outcome,
        p_observed_block_hash: inspection.observedBlockHash,
        p_provider: inspection.provider,
        p_evidence: evidence,
        p_next_check_seconds: nextCheckSeconds,
      }
    );

    if (completeError || completed !== true) {
      console.error('[Deposit Integrity] Could not complete leased check:', {
        depositId: row.id,
        code: completeError?.code || null,
        leaseCompleted: completed === true,
      });
      continue;
    }

    if (inspection.outcome === 'MISMATCH') {
      result.mismatches++;
      console.error('[Deposit Integrity] Canonical block identity mismatch; manual review required.', {
        depositId: row.id,
        network: row.network,
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        provider: inspection.provider,
      });
    } else if (inspection.outcome === 'INCONCLUSIVE') {
      result.inconclusive++;
      console.warn('[Deposit Integrity] Canonical block could not be verified; retry scheduled.', {
        depositId: row.id,
        network: row.network,
        provider: inspection.provider,
        reason: inspection.reason,
      });
    }
  }

  if (result.scanned > 0) {
    console.log('[Deposit Integrity] Batch complete:', result);
  }
  return result;
}

/** Prevent overlapping local runs; database leases coordinate separate processes. */
export function runDepositChainIntegrityMonitor(): Promise<{
  scanned: number;
  mismatches: number;
  inconclusive: number;
}> {
  if (activeRun) return activeRun;
  activeRun = executeIntegrityMonitor().finally(() => {
    activeRun = null;
  });
  return activeRun;
}
