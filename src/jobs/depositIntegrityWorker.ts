import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { normalizeNetworkCode } from '@/lib/blockchain/providers';
import { hasSupabaseServiceConfig, supabaseService } from '@/lib/supabase/service-role';

type IntegrityOutcome = 'MATCH' | 'MISMATCH' | 'INCONCLUSIVE';

interface IntegrityInspection {
  outcome: IntegrityOutcome;
  provider: string;
  observedBlockHash: string | null;
  reason?: string;
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

function inconclusive(provider: string, reason: string): IntegrityInspection {
  return { outcome: 'INCONCLUSIVE', provider, observedBlockHash: null, reason };
}

async function inspectEvmBlock(
  network: 'ERC20' | 'BEP20',
  height: number,
  expectedHash: string
): Promise<IntegrityInspection> {
  const chainId = network === 'BEP20' ? 56n : 1n;
  const rpcUrl = network === 'BEP20'
    ? process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org'
    : process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
  const providerName = network === 'BEP20' ? 'bsc_json_rpc' : 'ethereum_json_rpc';

  try {
    let provider = evmProviderCache.get(rpcUrl);
    if (!provider) {
      provider = new ethers.JsonRpcProvider(rpcUrl);
      evmProviderCache.set(rpcUrl, provider);
    }
    const actualNetwork = await provider.getNetwork();
    if (actualNetwork.chainId !== chainId) {
      return inconclusive(providerName, 'rpc_chain_id_mismatch');
    }

    const block = await provider.getBlock(height);
    if (!block || typeof block.hash !== 'string' || !validBlockHash(network, block.hash)) {
      return inconclusive(providerName, 'canonical_block_unavailable_or_invalid');
    }

    return {
      outcome: block.hash.toLowerCase() === expectedHash.toLowerCase() ? 'MATCH' : 'MISMATCH',
      provider: providerName,
      observedBlockHash: block.hash,
    };
  } catch {
    return inconclusive(providerName, 'rpc_request_failed');
  }
}

async function inspectUtxoBlock(
  network: 'BTC' | 'LTC',
  height: number,
  expectedHash: string
): Promise<IntegrityInspection> {
  const configured = network === 'BTC' ? process.env.BTC_MEMPOOL_API : process.env.LTC_MEMPOOL_API;
  const fallback = network === 'BTC'
    ? 'https://mempool.space/api'
    : 'https://litecoinspace.org/api';
  let base: string;

  try {
    const url = new URL((configured || fallback).trim().replace(/\/+$/, ''));
    if (url.protocol !== 'https:') return inconclusive('utxo_block_explorer', 'explorer_must_use_https');
    base = url.toString().replace(/\/+$/, '');
  } catch {
    return inconclusive('utxo_block_explorer', 'explorer_url_invalid');
  }

  try {
    const response = await fetch(`${base}/block-height/${height}`, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!response.ok) return inconclusive('utxo_block_explorer', `explorer_http_${response.status}`);

    const canonicalHash = (await response.text()).trim();
    if (!/^[a-fA-F0-9]{64}$/.test(canonicalHash)) {
      return inconclusive('utxo_block_explorer', 'canonical_hash_invalid');
    }

    return {
      outcome: canonicalHash.toLowerCase() === expectedHash.toLowerCase() ? 'MATCH' : 'MISMATCH',
      provider: 'utxo_block_explorer',
      observedBlockHash: canonicalHash,
    };
  } catch {
    return inconclusive('utxo_block_explorer', 'explorer_request_failed');
  }
}

async function inspectTronBlock(height: number, expectedHash: string): Promise<IntegrityInspection> {
  const host = (process.env.TRON_RPC_URL || 'https://api.trongrid.io').replace(/\/+$/, '');
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
    if (!response.ok) return inconclusive('tron_solidity_node', `solidity_node_http_${response.status}`);

    const block: any = await response.json();
    const canonicalHash = block?.blockID;
    if (
      block?.block_header?.raw_data?.number !== height ||
      typeof canonicalHash !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(canonicalHash)
    ) {
      return inconclusive('tron_solidity_node', 'solidified_block_unavailable_or_invalid');
    }

    return {
      outcome: canonicalHash.toLowerCase() === expectedHash.toLowerCase() ? 'MATCH' : 'MISMATCH',
      provider: 'tron_solidity_node',
      observedBlockHash: canonicalHash,
    };
  } catch {
    return inconclusive('tron_solidity_node', 'solidity_node_request_failed');
  }
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
