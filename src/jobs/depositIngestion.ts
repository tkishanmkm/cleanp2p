import { ethers } from 'ethers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  SUPPORTED_EVM_CHAINS,
  getEvmProvider,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import { TRON_CONFIG, getTronWeb, isValidTronAddress } from '@/lib/blockchain/tron';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';

// Resolve privileged credentials only when an ingestion operation actually runs.
// This keeps build-time module loading possible without ever falling back to an anon key.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabaseAdminClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// These are the canonical mainnet USDT contracts enforced by process_deposit_atomic.
// Do not allow environment overrides to make ingestion and database validation disagree.
export const CANONICAL_USDT_CONTRACTS: Record<string, string> = {
  ERC20: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  BEP20: '0x55d398326f99059fF775485246999027B3197955',
  TRC20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
};

export function getBtcMempoolApi(): string {
  if (
    process.env.BTC_MEMPOOL_API &&
    process.env.BTC_MEMPOOL_API.trim() !== ''
  ) {
    return process.env.BTC_MEMPOOL_API.trim();
  }

  return (
    process.env.BTC_MEMPOOL_API?.trim() ||
    'https://mempool.space/api'
  );
}

export interface IngestionResult {
  network: string;
  scannedBlocks?: number;
  depositsDetected: number;
  depositsCredited: number;
  errors: string[];
}

/**
 * Loads all active user deposit addresses across all chains
 */
export async function getMonitoredAddresses(): Promise<{
  evmAddresses: Set<string>;
  tronAddresses: Set<string>;
  btcAddresses: Set<string>;
  ltcAddresses: Set<string>;
}> {
  const evmAddresses = new Set<string>();
  const tronAddresses = new Set<string>();
  const btcAddresses = new Set<string>();
  const ltcAddresses = new Set<string>();

  try {
    // 1. Fetch from deposit_addresses
    const { data: primaryAddresses, error: pErr } = await supabaseAdmin
      .from('deposit_addresses')
      .select('address, network_code, asset_code');

    if (!pErr && primaryAddresses) {
      for (const row of primaryAddresses) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeDepositNetwork(row.network_code || '');
        const normAsset = (row.asset_code || '').toUpperCase().trim();

        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (
          normNet === 'BTC' ||
          normAsset === 'BTC' ||
          clean.startsWith('bc1') ||
          clean.startsWith('1') ||
          clean.startsWith('3')
        ) {
          btcAddresses.add(clean);
        } else if (normNet === 'LTC' || normAsset === 'LTC' || clean.startsWith('ltc1') || clean.startsWith('L') || clean.startsWith('M')) {
          ltcAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }

    // 2. Fetch from user_deposit_addresses
    const { data: fallbackAddresses, error: fErr } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('address, network, coin');

    if (!fErr && fallbackAddresses) {
      for (const row of fallbackAddresses) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeDepositNetwork(row.network || '');
        const normCoin = (row.coin || '').toUpperCase().trim();

        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (
          normNet === 'BTC' ||
          normCoin === 'BTC' ||
          clean.startsWith('bc1') ||
          clean.startsWith('1') ||
          clean.startsWith('3')
        ) {
          btcAddresses.add(clean);
        } else if (normNet === 'LTC' || normCoin === 'LTC' || clean.startsWith('ltc1') || clean.startsWith('L') || clean.startsWith('M')) {
          ltcAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }

    // 3. Fetch from wallets (User dashboard wallets)
    const { data: userWallets, error: wErr } = await supabaseAdmin
      .from('wallets')
      .select('address, chain, currency');

    if (!wErr && userWallets) {
      for (const row of userWallets) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeDepositNetwork(row.chain || '');
        const normCoin = (row.currency || '').toUpperCase().trim();

        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (
          normNet === 'BTC' ||
          normCoin === 'BTC' ||
          clean.startsWith('bc1') ||
          clean.startsWith('1') ||
          clean.startsWith('3')
        ) {
          btcAddresses.add(clean);
        } else if (normNet === 'LTC' || normCoin === 'LTC' || clean.startsWith('ltc1') || clean.startsWith('L') || clean.startsWith('M')) {
          ltcAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }
  } catch (err) {
    // Do not run a partial scan: silently omitting an address source can cause
    // deposits to be missed while the worker appears healthy. Fail this cycle
    // so the next run retries after the database/query issue is resolved.
    console.error('[Deposit Ingestion] Failed to load the complete monitored-address set; aborting this cycle.');
    throw err;
  }

  return { evmAddresses, tronAddresses, btcAddresses, ltcAddresses };
}

/**
 * Scans EVM logs for incoming ERC-20 token transfers targeting monitored addresses
 */
async function scanEvmTokenDeposits(
  network: string,
  monitoredEvmAddresses: Set<string>,
  fromBlock: number,
  toBlock: number
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  const normNet = normalizeDepositNetwork(network);
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
  const tokenContractAddress = CANONICAL_USDT_CONTRACTS[normNet] || chainConfig?.usdtContractAddress;

  if (!chainConfig || !tokenContractAddress) {
    return { detected: 0, credited: 0, errors: [] };
  }

  const provider = getEvmProvider(normNet);
  const tokenDecimals = chainConfig.usdtDecimals ?? 6;

  try {
    const erc20Interface = new ethers.Interface(ERC20_ABI);
    const transferTopic = erc20Interface.getEvent('Transfer')?.topicHash;

    if (!transferTopic) {
      return { detected: 0, credited: 0, errors: ['Failed to compute Transfer topic'] };
    }

    // Query event logs in configured block window
    const logs = await provider.getLogs({
      fromBlock,
      toBlock,
      address: tokenContractAddress,
      topics: [transferTopic],
    });

    const latestBlock = await provider.getBlockNumber();

    for (const log of logs) {
      try {
        const parsed = erc20Interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed || parsed.name !== 'Transfer') continue;

        const fromAddress = (parsed.args[0] as string).toLowerCase();
        const toAddress = (parsed.args[1] as string).toLowerCase();
        if (!monitoredEvmAddresses.has(toAddress)) {
          continue; // Not a platform deposit address
        }

        const rawValue = parsed.args[2] as bigint;
        if (rawValue <= 0n) continue;
        const formattedAmount = ethers.formatUnits(rawValue, tokenDecimals);

        detected++;
        const confirmations = latestBlock >= log.blockNumber ? latestBlock - log.blockNumber + 1 : 0;

        // Call canonical atomic deposit RPC
        const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: toAddress,
          p_asset_symbol: 'USDT',
          p_network_code: normNet,
          p_amount: formattedAmount,
          p_tx_hash: log.transactionHash,
          p_output_index: log.index,
          p_block_number: log.blockNumber,
          p_from_address: fromAddress,
          p_token_contract: tokenContractAddress,
          p_confirmations: confirmations,
          p_provider: 'deposit_ingestion',
        });

        if (error) {
          errors.push(`RPC error on tx ${log.transactionHash}: ${error.message}`);
        } else {
          const res = typeof data === 'string' ? JSON.parse(data) : data;
          if (res?.success === false) errors.push(`Deposit RPC rejected tx ${log.transactionHash}: ${res.code || res.status || 'unknown'}`);
          if (res?.status === 'credited' || (res?.success && confirmations >= chainConfig.requiredConfirmations)) {
            credited++;
          }
        }
      } catch (logErr: any) {
        errors.push(`Error processing EVM log ${log.transactionHash}: ${logErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Failed to query EVM logs on ${network}: ${err.message}`);
  }

  return { detected, credited, errors };
}

/**
 * Scans EVM blocks for native asset transfers (ETH) targeting monitored addresses
 */
async function scanEvmNativeDeposits(
  network: string,
  monitoredEvmAddresses: Set<string>,
  fromBlock: number,
  toBlock: number
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  const normNet = normalizeDepositNetwork(network);
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
  if (!chainConfig) return { detected: 0, credited: 0, errors: [] };

  const provider = getEvmProvider(normNet);

  try {
    const latestBlock = await provider.getBlockNumber();

    // 1. Direct address balance and Alchemy Asset Transfers check for instant accurate ingestion
    for (const address of Array.from(monitoredEvmAddresses)) {
      try {
        const bal = await provider.getBalance(address);
        if (bal > BigInt(0)) {
          try {
            const transfers: any = await provider.send('alchemy_getAssetTransfers', [
              {
                fromBlock: '0x0',
                toBlock: 'latest',
                toAddress: address,
                category: ['external'],
                order: 'desc',
                maxCount: '0xa',
              },
            ]);

            if (transfers?.transfers && Array.isArray(transfers.transfers) && transfers.transfers.length > 0) {
              for (const tx of transfers.transfers) {
                const txHash = tx.hash;
                const txBlock = parseInt(tx.blockNum, 16);

                // Never credit from an indexer summary alone. Verify the transaction and
                // successful receipt against the configured chain RPC, including the
                // actual recipient, native value, and mined block.
                let canonicalNativeValue: bigint;
                try {
                  const [canonicalTx, receipt] = await Promise.all([
                    provider.getTransaction(txHash),
                    provider.getTransactionReceipt(txHash),
                  ]);
                  if (
                    !canonicalTx ||
                    !receipt ||
                    receipt.status !== 1 ||
                    !Number.isSafeInteger(txBlock) ||
                    receipt.blockNumber !== txBlock ||
                    canonicalTx.blockNumber !== txBlock ||
                    !canonicalTx.to ||
                    canonicalTx.to.toLowerCase() !== address.toLowerCase() ||
                    canonicalTx.value <= 0n
                  ) {
                    continue;
                  }
                  canonicalNativeValue = canonicalTx.value;
                } catch {
                  // Do not advance the durable scan cursor when canonical verification
                  // is unavailable; retry this block range on the next worker cycle.
                  errors.push(`Unable to verify indexed native transaction ${txHash} on ${normNet}`);
                  continue;
                }

                const formattedNativeAmount = ethers.formatUnits(canonicalNativeValue, chainConfig.nativeDecimals);
                const assetSymbol = chainConfig.nativeSymbol.toUpperCase();
                const confirmations = latestBlock >= txBlock ? latestBlock - txBlock + 1 : 0;

                detected++;
                const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
                  p_destination_address: address.toLowerCase(),
                  p_asset_symbol: assetSymbol === 'ETH' ? 'ETH' : assetSymbol,
                  p_network_code: 'ETH',
                  p_amount: formattedNativeAmount,
                  p_tx_hash: txHash,
                  p_output_index: 0,
                  p_block_number: isNaN(txBlock) ? null : txBlock,
                  p_from_address: tx.from?.toLowerCase() || null,
                  p_token_contract: null,
                  p_confirmations: confirmations,
                  p_provider: 'deposit_ingestion',
                });

                if (!error) {
                  const res = typeof data === 'string' ? JSON.parse(data) : data;
                  if (res?.success === false) errors.push(`Deposit RPC rejected indexed native tx ${txHash}: ${res.code || res.status || 'unknown'}`);
                  if (res?.status === 'credited' || (res?.success && confirmations >= chainConfig.requiredConfirmations)) {
                    credited++;
                  }
                }
              }
            }
          } catch (_) {
            // If provider is standard RPC without alchemy_getAssetTransfers, fallback gracefully
          }
        }
      } catch (addrErr: any) {
        // Continue scanning other addresses
      }
    }

    // 2. Iterate through blocks in range (constrained to max 25 blocks for native scan)
    for (let b = fromBlock; b <= toBlock; b++) {
      const block = await provider.getBlock(b, true);
      if (!block || !block.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to) continue;
        const toClean = tx.to.toLowerCase();

        if (monitoredEvmAddresses.has(toClean) && tx.value > BigInt(0)) {
          // A transaction may be included in a block but still have reverted.
          // Require a successful canonical receipt before any balance-changing RPC.
          let receipt: Awaited<ReturnType<typeof provider.getTransactionReceipt>>;
          try {
            receipt = await provider.getTransactionReceipt(tx.hash);
          } catch {
            errors.push(`Unable to fetch receipt for native transaction ${tx.hash} on ${normNet}`);
            continue;
          }
          if (!receipt) {
            errors.push(`Missing receipt for mined native transaction ${tx.hash} on ${normNet}`);
            continue;
          }
          if (receipt.status !== 1) {
            continue; // Canonical reverted transaction; it cannot be a deposit.
          }
          if (receipt.blockNumber !== b) {
            errors.push(`Receipt block mismatch for native transaction ${tx.hash} on ${normNet}`);
            continue;
          }

          detected++;
          const formattedAmount = ethers.formatUnits(tx.value, chainConfig.nativeDecimals);
          const confirmations = latestBlock >= b ? latestBlock - b + 1 : 0;

          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toClean,
            p_asset_symbol: chainConfig.nativeSymbol === 'ETH' ? 'ETH' : chainConfig.nativeSymbol,
            p_network_code: normNet === 'ERC20' ? 'ETH' : normNet,
            p_amount: formattedAmount,
            p_tx_hash: tx.hash,
            p_output_index: 0,
            p_block_number: b,
            p_from_address: tx.from?.toLowerCase() || null,
            p_token_contract: null,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for native transfer ${tx.hash}: ${error.message}`);
          } else {
            const res = typeof data === 'string' ? JSON.parse(data) : data;
            if (res?.success === false) errors.push(`Deposit RPC rejected native tx ${tx.hash}: ${res.code || res.status || 'unknown'}`);
            if (res?.status === 'credited' || (res?.success && confirmations >= chainConfig.requiredConfirmations)) {
              credited++;
            }
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Failed to scan native transfers on ${network}: ${err.message}`);
  }

  return { detected, credited, errors };
}

type TronEventScan = {
  events: any[];
  newestEventKey: string | null;
  complete: boolean;
  nextBackfillFingerprint: string | null;
  backfillComplete: boolean;
};

function tronEventKey(event: any): string | null {
  const txId = String(event?.transaction_id || '');
  const index = Number(event?.event_index);
  return txId && Number.isSafeInteger(index) && index >= 0 ? `${txId}_${index}` : null;
}

async function fetchTronUsdtEventsSinceCursor(
  tronGridHost: string,
  headers: Record<string, string>,
  contractAddress: string
): Promise<TronEventScan> {
  const { data: cursor, error: cursorError } = await supabaseAdmin
    .from('tron_deposit_scan_cursors')
    .select('last_seen_event_key, backfill_fingerprint, backfill_complete')
    .eq('network_code', 'TRC20')
    .maybeSingle();
  if (cursorError) throw new Error(`Unable to load TRON deposit cursor: ${cursorError.message}`);

  const fetchPage = async (fingerprint?: string | null): Promise<{ events: any[]; fingerprint: string | null }> => {
    const query = new URLSearchParams({
      event_name: 'Transfer',
      limit: '50',
      order_by: 'block_timestamp,desc',
      only_confirmed: 'true',
    });
    if (fingerprint) query.set('fingerprint', fingerprint);
    const response = await fetch(`${tronGridHost}/v1/contracts/${contractAddress}/events?${query.toString()}`, { headers });
    if (!response.ok) throw new Error(`TRON event query failed with HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error('TRON event API returned an invalid response');
    return {
      events: body.data,
      fingerprint: body?.meta?.fingerprint ? String(body.meta.fingerprint) : null,
    };
  };

  const firstPage = await fetchPage();
  const newestEventKey = tronEventKey(firstPage.events[0]) || cursor?.last_seen_event_key || null;
  const lastSeenEventKey = cursor?.last_seen_event_key ? String(cursor.last_seen_event_key) : null;

  if (!lastSeenEventKey) {
    const needsBackfill = firstPage.events.length >= 50;
    if (needsBackfill && !firstPage.fingerprint) {
      return { events: firstPage.events, newestEventKey, complete: false, nextBackfillFingerprint: null, backfillComplete: false };
    }
    return {
      events: firstPage.events,
      newestEventKey,
      complete: true,
      nextBackfillFingerprint: needsBackfill ? firstPage.fingerprint : null,
      backfillComplete: !needsBackfill,
    };
  }

  const events: any[] = [];
  let page = firstPage;
  let pagesRead = 0;
  let incrementalComplete = false;
  while (true) {
    let reachedCursor = false;
    for (const event of page.events) {
      if (tronEventKey(event) === lastSeenEventKey) {
        reachedCursor = true;
        break;
      }
      events.push(event);
    }

    if (reachedCursor || page.events.length < 50) {
      incrementalComplete = true;
      break;
    }
    if (!page.fingerprint || ++pagesRead >= 100) {
      return {
        events,
        newestEventKey,
        complete: false,
        nextBackfillFingerprint: cursor?.backfill_fingerprint || null,
        backfillComplete: cursor?.backfill_complete === true,
      };
    }
    page = await fetchPage(page.fingerprint);
  }

  let nextBackfillFingerprint = cursor?.backfill_fingerprint ? String(cursor.backfill_fingerprint) : null;
  let backfillComplete = cursor?.backfill_complete === true || !nextBackfillFingerprint;
  if (!backfillComplete && nextBackfillFingerprint) {
    const olderPage = await fetchPage(nextBackfillFingerprint);
    events.push(...olderPage.events);
    if (olderPage.events.length < 50) {
      nextBackfillFingerprint = null;
      backfillComplete = true;
    } else if (olderPage.fingerprint) {
      nextBackfillFingerprint = olderPage.fingerprint;
    } else {
      return {
        events,
        newestEventKey,
        complete: false,
        nextBackfillFingerprint,
        backfillComplete: false,
      };
    }
  }

  return {
    events,
    newestEventKey,
    complete: incrementalComplete,
    nextBackfillFingerprint,
    backfillComplete,
  };
}

async function persistTronDepositCursor(scan: TronEventScan): Promise<void> {
  if (!scan.newestEventKey) return;
  const { error } = await supabaseAdmin
    .from('tron_deposit_scan_cursors')
    .upsert({
      network_code: 'TRC20',
      last_seen_event_key: scan.newestEventKey,
      backfill_fingerprint: scan.nextBackfillFingerprint,
      backfill_complete: scan.backfillComplete,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'network_code' });
  if (error) throw new Error(`Unable to persist TRON deposit cursor: ${error.message}`);
}

/**
 * Scans TRON TRC-20 token transfers targeting monitored TRON addresses
 * Supports Alchemy TRON JSON-RPC (eth_getLogs) with automatic chunking and recovery
 */
async function scanTronDeposits(
  monitoredTronAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  if (monitoredTronAddresses.size === 0) {
    return { detected: 0, credited: 0, errors: [] };
  }

  try {
    const tronWeb = getTronWeb(false);
    const tronHost = (process.env.TRON_RPC_URL || TRON_CONFIG.fullHost || 'https://api.trongrid.io').replace(/\/$/, '');

    // Determine TronGrid REST host (Mainnet)
    const getTronGridHost = (rpcUrl: string): string => {
      const customGrid = process.env.TRONGRID_API_URL || process.env.TRON_EVENT_SERVER;
      if (customGrid) return customGrid.replace(/\/$/, '');
      if ((rpcUrl || '').toLowerCase().includes('api.trongrid.io')) {
        return rpcUrl.replace(/\/$/, '');
      }
      return 'https://api.trongrid.io';
    };

    const tronGridHost = getTronGridHost(tronHost);
    const tronGridHeaders: Record<string, string> = { Accept: 'application/json' };
    const gridKey = process.env.TRON_GRID_API_KEY || process.env.TRONGRID_API_KEY || TRON_CONFIG.apiKey;
    if (gridKey) {
      tronGridHeaders['TRON-PRO-API-KEY'] = gridKey;
    }

    // Build list of known USDT contracts for the network
    const knownContracts: string[] = [];
    const addKnownContract = (addr: string) => {
      if (addr && !knownContracts.includes(addr)) {
        knownContracts.push(addr);
      }
    };
    addKnownContract(CANONICAL_USDT_CONTRACTS.TRC20); // Canonical mainnet TRC-20 USDT

    // Build contract addresses hex filter for eth_getLogs
    const contractAddressesHex: string[] = [];
    const addContractHex = (base58: string) => {
      try {
        const hex = '0x' + tronWeb.address.toHex(base58).slice(2);
        if (!contractAddressesHex.includes(hex.toLowerCase())) {
          contractAddressesHex.push(hex.toLowerCase());
        }
      } catch (_) {}
    };
    for (const c of knownContracts) {
      addContractHex(c);
    }

    // 1. Determine latest block height
    let latestBlock = 0;
    try {
      const blockRes = await fetch(tronHost, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      if (blockRes.ok) {
        const bData = await blockRes.json();
        if (bData.result) {
          latestBlock = parseInt(bData.result, 16);
        }
      }
    } catch (_) {}

    if (!latestBlock) {
      try {
        const nowBlockRes = await fetch(`${tronHost}/wallet/getnowblock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (nowBlockRes.ok) {
          const nbData = await nowBlockRes.json();
          latestBlock = nbData?.block_header?.raw_data?.number || 0;
        }
      } catch (_) {}
    }

    if (!latestBlock) {
      try {
        const curBlock = await tronWeb.trx.getCurrentBlock();
        latestBlock = curBlock?.block_header?.raw_data?.number || 0;
      } catch (_) {}
    }

    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const seenTxIndices = new Set<string>();
    const errorsBeforeTronScan = errors.length;

    // Match each reported event to a successful canonical TRON receipt log.
    // The receipt-log index becomes the stable idempotency key for that transfer.
    const findCanonicalTransferIndex = (
      info: any,
      toAddress: string,
      fromAddress: string | null,
      rawAmount: bigint
    ): number => {
      const logs = Array.isArray(info?.log) ? info.log : [];
      for (let index = 0; index < logs.length; index++) {
        const log = logs[index];
        const topics: string[] = Array.isArray(log?.topics) ? log.topics : [];
        if ((topics[0] || '').replace(/^0x/i, '').toLowerCase() !== transferTopic.slice(2)) continue;

        let logContract = '';
        let logTo = '';
        let logFrom = '';
        let logAmount = -1n;
        try {
          const rawContract = String(log.address || '').replace(/^0x/i, '');
          logContract = tronWeb.address.fromHex(rawContract.length === 42 ? rawContract : `41${rawContract.slice(-40)}`);
          if (topics.length < 3) continue;
          logFrom = tronWeb.address.fromHex(`41${topics[1].replace(/^0x/i, '').slice(-40)}`);
          logTo = tronWeb.address.fromHex(`41${topics[2].replace(/^0x/i, '').slice(-40)}`);
          const rawData = String(log.data || '').replace(/^0x/i, '');
          if (!/^[0-9a-f]+$/i.test(rawData)) continue;
          logAmount = BigInt(`0x${rawData}`);
        } catch {
          continue;
        }

        if (
          logContract === CANONICAL_USDT_CONTRACTS.TRC20 &&
          logTo === toAddress &&
          (!fromAddress || logFrom === fromAddress) &&
          logAmount === rawAmount
        ) return index;
      }
      return -1;
    };

    // 2. Strategy A: Direct Monitored Account TRC-20 Transaction Ingestion via TronGrid
    // Queries each monitored TRON address for incoming TRC-20 transfers (works reliably regardless of block depth)
    for (const monitoredAddr of monitoredTronAddresses) {
      try {
        const accountUrl = `${tronGridHost}/v1/accounts/${monitoredAddr}/transactions/trc20?limit=20`;
        const res = await fetch(accountUrl, { headers: tronGridHeaders });
        if (res.ok) {
          const json = await res.json();
          const items = Array.isArray(json?.data) ? json.data : [];
          for (const item of items) {
            if (item.type !== 'Transfer') continue;

            let toAddr = item.to || '';
            try {
              if (toAddr.startsWith('41') || toAddr.startsWith('0x')) {
                toAddr = tronWeb.address.fromHex(toAddr);
              }
            } catch (_) {}

            if (toAddr !== monitoredAddr && !monitoredTronAddresses.has(toAddr)) {
              continue;
            }

            const txId = item.transaction_id;
            if (!txId) continue;

            // Accept only the canonical mainnet USDT contract. Account history APIs
            // can return transfers for arbitrary TRC-20 tokens.
            let observedContract = String(item.token_info?.address || '');
            try {
              if (observedContract.startsWith('41') || observedContract.startsWith('0x')) {
                observedContract = tronWeb.address.fromHex(observedContract);
              }
            } catch {
              continue;
            }
            if (observedContract !== CANONICAL_USDT_CONTRACTS.TRC20) continue;

            // Confirm the canonical transaction actually succeeded and has a mined block.
            let canonicalInfo: any;
            try {
              canonicalInfo = await tronWeb.trx.getTransactionInfo(txId);
            } catch {
              continue;
            }
            if (!canonicalInfo?.blockNumber || canonicalInfo?.receipt?.result !== 'SUCCESS') continue;

            let fromAddr: string | null = item.from || null;
            try {
              if (fromAddr && (fromAddr.startsWith('41') || fromAddr.startsWith('0x'))) {
                fromAddr = tronWeb.address.fromHex(fromAddr);
              }
            } catch (_) {}

            // Canonical USDT on TRON has six decimals; do not trust token metadata.
            const rawVal = BigInt(item.value || '0');
            if (rawVal <= 0n) continue;
            const outputIndex = findCanonicalTransferIndex(canonicalInfo, toAddr, fromAddr, rawVal);
            if (outputIndex < 0) continue;
            const deduplicationKey = `${txId}_${outputIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;
            seenTxIndices.add(deduplicationKey);
            const formattedAmount = ethers.formatUnits(rawVal, 6);

            const tokenContract = CANONICAL_USDT_CONTRACTS.TRC20;

            // Fetch block number from TRON RPC if missing from account event
            const eventBlock = Number(canonicalInfo.blockNumber);
            const confirmations = latestBlock > 0 && latestBlock >= eventBlock
              ? latestBlock - eventBlock + 1
              : 0;

            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toAddr,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: outputIndex,
              p_block_number: eventBlock || null,
              p_from_address: fromAddr,
              p_token_contract: tokenContract,
              p_confirmations: confirmations,
              p_provider: 'deposit_ingestion',
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              if (r?.success === false) errors.push(`Deposit RPC rejected TRON tx ${txId}: ${r.code || r.status || 'unknown'}`);
              if (r?.status === 'credited' || (r?.success && confirmations >= TRON_CONFIG.requiredConfirmations)) {
                credited++;
              }
            }
          }
        }
      } catch (acctErr: any) {
        errors.push(`TronGrid account TRC20 error for ${monitoredAddr}: ${acctErr.message}`);
      }
    }

    // 3. Strategy B: durable, paginated TronGrid contract-event ingestion.
    for (const cAddr of knownContracts) {
      try {
        const eventScan = await fetchTronUsdtEventsSinceCursor(tronGridHost, tronGridHeaders, cAddr);
        for (const evt of eventScan.events) {
            const txId = evt.transaction_id;
            const fromHex = evt.result?.from;
            const toHex = evt.result?.to;
            const rawValue = evt.result?.value;
            if (!toHex || !rawValue) continue;

            let toBase58 = toHex;
            let fromBase58: string | null = fromHex || null;
            try {
              if (toHex.startsWith('41') || toHex.startsWith('0x')) {
                toBase58 = tronWeb.address.fromHex(toHex);
              }
              if (fromHex && (fromHex.startsWith('41') || fromHex.startsWith('0x'))) {
                fromBase58 = tronWeb.address.fromHex(fromHex);
              }
            } catch (_) {}

            if (!monitoredTronAddresses.has(toBase58)) continue;

            const rawValBig = BigInt(rawValue);
            if (rawValBig <= 0n) continue;
            let canonicalInfo: any;
            try {
              canonicalInfo = await tronWeb.trx.getTransactionInfo(txId);
            } catch {
              continue;
            }
            if (!canonicalInfo?.blockNumber || canonicalInfo?.receipt?.result !== 'SUCCESS') continue;

            const outputIndex = findCanonicalTransferIndex(canonicalInfo, toBase58, fromBase58, rawValBig);
            if (outputIndex < 0) continue;
            const deduplicationKey = `${txId}_${outputIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;
            seenTxIndices.add(deduplicationKey);

            detected++;
            const formattedAmount = ethers.formatUnits(rawValBig, 6);
            const eventBlock = Number(canonicalInfo.blockNumber);
            const confirmations = latestBlock > 0 && latestBlock >= eventBlock
              ? latestBlock - eventBlock + 1
              : 0;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toBase58,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: outputIndex,
              p_block_number: eventBlock || null,
              p_from_address: fromBase58,
              p_token_contract: cAddr,
              p_confirmations: confirmations,
              p_provider: 'deposit_ingestion',
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              if (r?.success === false) {
                errors.push(`Deposit RPC rejected TRON tx ${txId}: ${r.code || r.status || 'unknown'}`);
              } else if (r?.status === 'credited' || (r?.success && confirmations >= TRON_CONFIG.requiredConfirmations)) {
                credited++;
              }
            }
        }

        if (eventScan.complete && eventScan.newestEventKey && errors.length === errorsBeforeTronScan) {
          await persistTronDepositCursor(eventScan);
        } else if (!eventScan.complete) {
          errors.push('TRON event history is incomplete; cursor was not advanced');
        }
      } catch (evtErr: any) {
        errors.push(`TronGrid contract events error for ${cAddr}: ${evtErr.message}`);
      }
    }

    // 4. Strategy C: JSON-RPC eth_getLogs on configured RPC endpoint (Alchemy TRON compatible)
    if (latestBlock && (tronHost.includes('alchemy.com') || tronHost.includes('rpc'))) {
      try {
        const scanWindow = 100;
        const fromBlock = Math.max(0, latestBlock - scanWindow);
        const ranges: Array<{ from: number; to: number }> = [];
        for (let b = fromBlock; b <= latestBlock; b += 9) {
          ranges.push({ from: b, to: Math.min(b + 8, latestBlock) });
        }

        const allLogs: any[] = [];
        for (let i = 0; i < ranges.length; i += 5) {
          const batch = ranges.slice(i, i + 5);
          const chunkResults = await Promise.all(
            batch.map(async (r) => {
              if (r.from > latestBlock) return null;
              const clampedTo = Math.min(r.to, latestBlock);
              if (r.from > clampedTo) return null;

              const res = await fetch(tronHost, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'eth_getLogs',
                  params: [
                    {
                      fromBlock: '0x' + r.from.toString(16),
                      toBlock: '0x' + clampedTo.toString(16),
                      address: contractAddressesHex.length === 1 ? contractAddressesHex[0] : contractAddressesHex,
                      topics: [transferTopic],
                    },
                  ],
                }),
              });
              if (!res.ok) return null;
              const json = await res.json();
              if (json.error) return null;
              return json.result || [];
            })
          );

          for (const logs of chunkResults) {
            if (Array.isArray(logs)) {
              allLogs.push(...logs);
            }
          }
        }

        for (const log of allLogs) {
          if (!log.topics || log.topics.length < 3) continue;
          if ((log.topics[0] || '').toLowerCase() !== transferTopic) continue;

          const txHash = (log.transactionHash || '').replace(/^0x/, '');
          const outputIndex = parseInt(log.logIndex || '0x0', 16) || 0;
          const deduplicationKey = `${txHash}_${outputIndex}`;
          if (seenTxIndices.has(deduplicationKey)) continue;

          let toBase58 = '';
          try {
            const toHex = '41' + (log.topics[2] || '').slice(-40);
            toBase58 = tronWeb.address.fromHex(toHex);
          } catch (_) {
            continue;
          }

          if (!monitoredTronAddresses.has(toBase58)) continue;
          seenTxIndices.add(deduplicationKey);

          let fromBase58: string | null = null;
          try {
            const fromHex = '41' + (log.topics[1] || '').slice(-40);
            fromBase58 = tronWeb.address.fromHex(fromHex);
          } catch (_) {}

          let formattedAmount: string;
          try {
            const rawValue = BigInt(log.data || '0x0');
            if (rawValue <= 0n) continue;
            formattedAmount = ethers.formatUnits(rawValue, 6);
          } catch (_) {
            continue;
          }

          const eventBlock = parseInt(log.blockNumber || '0x0', 16) || 0;
          const confirmations = latestBlock >= eventBlock && eventBlock > 0 ? latestBlock - eventBlock + 1 : 0;

          let eventContractBase58 = '';
          try {
            const logAddrHex = (log.address || '').toLowerCase().replace(/^0x/, '');
            eventContractBase58 = tronWeb.address.fromHex('41' + logAddrHex);
          } catch (_) {}

          detected++;

          const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toBase58,
            p_asset_symbol: 'USDT',
            p_network_code: 'TRC20',
            p_amount: formattedAmount,
            p_tx_hash: txHash,
            p_output_index: outputIndex,
            p_block_number: eventBlock,
            p_from_address: fromBase58,
            p_token_contract: eventContractBase58,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for TRON deposit ${txHash}: ${error.message}`);
          } else {
            const res = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
            if (res?.success === false) errors.push(`Deposit RPC rejected TRON tx ${txHash}: ${res.code || res.status || 'unknown'}`);
            if (res?.status === 'credited' || (res?.success && confirmations >= TRON_CONFIG.requiredConfirmations)) {
              credited++;
            }
          }
        }
      } catch (rpcErr: any) {
        errors.push(`eth_getLogs query error: ${rpcErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Failed scanning TRON deposits: ${err.message}`);
  }

  return { detected, credited, errors };
}

type UtxoAddressScan = {
  transactions: any[];
  newestTxid: string | null;
  complete: boolean;
  nextBackfillCursor: string | null;
  backfillComplete: boolean;
};

/**
 * Fetch new address transactions since the incremental cursor and one page of
 * older history per cycle. This catches up after outages and incrementally
 * backfills pre-existing address history without blocking the worker forever.
 */
async function fetchUtxoAddressTransactionsSinceCursor(
  apiBase: string,
  address: string,
  network: 'BTC' | 'LTC'
): Promise<UtxoAddressScan> {
  const { data: cursor, error: cursorError } = await supabaseAdmin
    .from('utxo_deposit_scan_cursors')
    .select('last_seen_txid, backfill_cursor_txid, backfill_complete')
    .eq('network_code', network)
    .eq('address', address)
    .maybeSingle();
  if (cursorError) throw new Error(`Unable to load ${network} scan cursor: ${cursorError.message}`);

  const firstResponse = await fetch(`${apiBase}/address/${encodeURIComponent(address)}/txs`);
  if (!firstResponse.ok) throw new Error(`Address transaction query failed with HTTP ${firstResponse.status}`);
  const firstPage = await firstResponse.json();
  if (!Array.isArray(firstPage)) throw new Error('Address transaction API returned an invalid response');

  const newestTxid = firstPage[0]?.txid ? String(firstPage[0].txid) : null;
  const cursorTxid = cursor?.last_seen_txid ? String(cursor.last_seen_txid) : null;

  if (!cursorTxid) {
    const oldestOnPage = firstPage.length > 0 ? String(firstPage[firstPage.length - 1]?.txid || '') : '';
    return {
      transactions: firstPage,
      newestTxid,
      complete: true,
      nextBackfillCursor: firstPage.length >= 25 && oldestOnPage ? oldestOnPage : null,
      backfillComplete: firstPage.length < 25,
    };
  }

  const transactions: any[] = [];
  let page: any[] = firstPage;
  let pagesRead = 0;
  let incrementalComplete = false;
  while (true) {
    let reachedCursor = false;
    for (const tx of page) {
      if (String(tx?.txid || '') === cursorTxid) {
        reachedCursor = true;
        break;
      }
      if (tx?.txid) transactions.push(tx);
    }

    if (reachedCursor || page.length < 25) {
      incrementalComplete = true;
      break;
    }
    if (++pagesRead >= 200) {
      return {
        transactions,
        newestTxid,
        complete: false,
        nextBackfillCursor: cursor?.backfill_cursor_txid || null,
        backfillComplete: cursor?.backfill_complete === true,
      };
    }

    const lastTxid = String(page[page.length - 1]?.txid || '');
    if (!lastTxid) return {
      transactions, newestTxid, complete: false,
      nextBackfillCursor: cursor?.backfill_cursor_txid || null,
      backfillComplete: cursor?.backfill_complete === true,
    };

    const nextResponse = await fetch(
      `${apiBase}/address/${encodeURIComponent(address)}/txs/chain/${encodeURIComponent(lastTxid)}`
    );
    if (!nextResponse.ok) throw new Error(`Address history pagination failed with HTTP ${nextResponse.status}`);
    const nextPage = await nextResponse.json();
    if (!Array.isArray(nextPage)) throw new Error('Address history pagination returned an invalid response');
    page = nextPage;
    if (page.length === 0) {
      incrementalComplete = true;
      break;
    }
  }

  let nextBackfillCursor = cursor?.backfill_cursor_txid ? String(cursor.backfill_cursor_txid) : null;
  let backfillComplete = cursor?.backfill_complete === true || !nextBackfillCursor;
  if (!backfillComplete && nextBackfillCursor) {
    const backfillResponse = await fetch(
      `${apiBase}/address/${encodeURIComponent(address)}/txs/chain/${encodeURIComponent(nextBackfillCursor)}`
    );
    if (!backfillResponse.ok) throw new Error(`Historical address backfill failed with HTTP ${backfillResponse.status}`);
    const backfillPage = await backfillResponse.json();
    if (!Array.isArray(backfillPage)) throw new Error('Historical address backfill returned an invalid response');

    transactions.push(...backfillPage.filter((tx: any) => tx?.txid));
    if (backfillPage.length < 25) {
      nextBackfillCursor = null;
      backfillComplete = true;
    } else {
      const oldestTxid = String(backfillPage[backfillPage.length - 1]?.txid || '');
      if (!oldestTxid) throw new Error('Historical address backfill page has no transaction ID');
      nextBackfillCursor = oldestTxid;
    }
  }

  return {
    transactions,
    newestTxid,
    complete: incrementalComplete,
    nextBackfillCursor,
    backfillComplete,
  };
}

async function persistUtxoAddressCursor(
  network: 'BTC' | 'LTC',
  address: string,
  scan: UtxoAddressScan
): Promise<void> {
  if (!scan.newestTxid) return;
  const { error } = await supabaseAdmin
    .from('utxo_deposit_scan_cursors')
    .upsert({
      network_code: network,
      address,
      last_seen_txid: scan.newestTxid,
      backfill_cursor_txid: scan.nextBackfillCursor,
      backfill_complete: scan.backfillComplete,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'network_code,address' });
  if (error) throw new Error(`Unable to persist ${network} scan cursor: ${error.message}`);
}

/**
 * Scans Bitcoin (BTC Native SegWit / Bech32) UTXO deposits for monitored addresses
 */
async function scanBtcDeposits(
  monitoredBtcAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  if (monitoredBtcAddresses.size === 0) {
    return { detected: 0, credited: 0, errors: [] };
  }

  const btcApiBase = getBtcMempoolApi();
  let btcTipHeight: number | null = null;
  try {
    const tipResponse = await fetch(`${btcApiBase}/blocks/tip/height`);
    if (tipResponse.ok) {
      const parsedTip = Number((await tipResponse.text()).trim());
      if (Number.isSafeInteger(parsedTip) && parsedTip >= 0) btcTipHeight = parsedTip;
    }
  } catch {
    // Without an authoritative tip height, keep confirmations at zero.
  }

  for (const btcAddr of Array.from(monitoredBtcAddresses)) {
    try {
      const scan = await fetchUtxoAddressTransactionsSinceCursor(btcApiBase, btcAddr, 'BTC');
      const errorsBeforeAddress = errors.length;
      const txs = scan.transactions;

      for (const tx of txs) {
        for (let i = 0; i < (tx.vout || []).length; i++) {
          const out = tx.vout[i];
          if (out.scriptpubkey_address !== btcAddr) continue;

          const outputAmountSat = BigInt(out.value || 0);
          if (outputAmountSat <= 0n) continue;

          detected++;
          const btcAmount = ethers.formatUnits(outputAmountSat, 8);
          const blockHeight = tx.status?.block_height;
          const confirmations = tx.status?.confirmed === true &&
            blockHeight !== undefined && btcTipHeight !== null && btcTipHeight >= blockHeight
            ? btcTipHeight - blockHeight + 1
            : 0;

          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: btcAddr,
            p_asset_symbol: 'BTC',
            p_network_code: 'BTC',
            p_amount: btcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: blockHeight || null,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for BTC deposit ${tx.txid}:${i}: ${error.message}`);
          } else {
            const result = typeof data === 'string' ? JSON.parse(data) : data;
            if (result?.success === false) errors.push(`Deposit RPC rejected BTC tx ${tx.txid}:${i}: ${result.code || result.status || 'unknown'}`);
            if (result?.status === 'credited') credited++;
          }
        }
      }

      if (scan.complete && scan.newestTxid && errors.length === errorsBeforeAddress) {
        await persistUtxoAddressCursor('BTC', btcAddr, scan);
      } else if (!scan.complete) {
        errors.push(`BTC history backlog for ${btcAddr} exceeds this cycle's page limit; cursor was not advanced`);
      }
    } catch (err: any) {
      errors.push(`Failed scanning BTC for ${btcAddr}: ${err?.message}`);
    }
  }

  return { detected, credited, errors };
}

/**
 * Scans Litecoin (LTC Native SegWit / Bech32) UTXO deposits for monitored addresses
 */
async function scanLtcDeposits(
  monitoredLtcAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  if (monitoredLtcAddresses.size === 0) {
    return { detected: 0, credited: 0, errors: [] };
  }

  const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
  let ltcTipHeight: number | null = null;
  try {
    const tipResponse = await fetch(`${ltcApiBase}/blocks/tip/height`);
    if (tipResponse.ok) {
      const parsedTip = Number((await tipResponse.text()).trim());
      if (Number.isSafeInteger(parsedTip) && parsedTip >= 0) ltcTipHeight = parsedTip;
    }
  } catch {
    // Without an authoritative tip height, keep confirmations at zero.
  }

  for (const ltcAddr of Array.from(monitoredLtcAddresses)) {
    try {
      const scan = await fetchUtxoAddressTransactionsSinceCursor(ltcApiBase, ltcAddr, 'LTC');
      const errorsBeforeAddress = errors.length;
      const txs = scan.transactions;

      for (const tx of txs) {
        for (let i = 0; i < (tx.vout || []).length; i++) {
          const out = tx.vout[i];
          if (out.scriptpubkey_address !== ltcAddr) continue;

          const outputAmountLit = BigInt(out.value || 0);
          if (outputAmountLit <= 0n) continue;

          detected++;
          const ltcAmount = ethers.formatUnits(outputAmountLit, 8);
          const blockHeight = tx.status?.block_height;
          const confirmations = tx.status?.confirmed === true &&
            blockHeight !== undefined && ltcTipHeight !== null && ltcTipHeight >= blockHeight
            ? ltcTipHeight - blockHeight + 1
            : 0;

          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: ltcAddr,
            p_asset_symbol: 'LTC',
            p_network_code: 'LTC',
            p_amount: ltcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: blockHeight || null,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for LTC deposit ${tx.txid}:${i}: ${error.message}`);
          } else {
            const result = typeof data === 'string' ? JSON.parse(data) : data;
            if (result?.success === false) errors.push(`Deposit RPC rejected LTC tx ${tx.txid}:${i}: ${result.code || result.status || 'unknown'}`);
            if (result?.status === 'credited') credited++;
          }
        }
      }

      if (scan.complete && scan.newestTxid && errors.length === errorsBeforeAddress) {
        await persistUtxoAddressCursor('LTC', ltcAddr, scan);
      } else if (!scan.complete) {
        errors.push(`LTC history backlog for ${ltcAddr} exceeds this cycle's page limit; cursor was not advanced`);
      }
    } catch (err: any) {
      errors.push(`Failed scanning LTC for ${ltcAddr}: ${err?.message}`);
    }
  }

  return { detected, credited, errors };
}

/**
 * Re-scans previously pending deposits in the database to credit them once required confirmations are reached
 */
/**
 * Compatibility wrapper for older callers. Pending deposits are verified by the
 * dedicated confirmation worker so there is only one canonical verification path.
 */
export async function refreshPendingDepositConfirmations(): Promise<{
  checked: number;
  newlyCredited: number;
}> {
  const { runConfirmationsWorker } = await import('./confirmationsWorker');
  const result = await runConfirmationsWorker();
  return {
    checked: result.totalScanned,
    newlyCredited: result.confirmedCount,
  };
}

/**
 * Main deposit ingestion cycle execution
 */
export async function runDepositIngestion(): Promise<{
  results: IngestionResult[];
  pendingRecheck: { checked: number; newlyCredited: number };
}> {
  const { evmAddresses, tronAddresses, btcAddresses, ltcAddresses } = await getMonitoredAddresses();
  const results: IngestionResult[] = [];

  // 1. Scan EVM Chains (ERC20, BEP20)
  for (const [netKey, chain] of Object.entries(SUPPORTED_EVM_CHAINS)) {
    const netResult: IngestionResult = {
      network: netKey,
      depositsDetected: 0,
      depositsCredited: 0,
      errors: [],
    };

    try {
      const provider = getEvmProvider(netKey);
      const latestBlock = await provider.getBlockNumber();
      const { data: cursor, error: cursorError } = await supabaseAdmin
        .from('deposit_scan_cursors')
        .select('last_scanned_block')
        .eq('network_code', netKey)
        .maybeSingle();
      if (cursorError) {
        throw new Error(`Unable to load ${netKey} deposit scan cursor: ${cursorError.message}`);
      }

      const lastScanned = cursor?.last_scanned_block == null
        ? null
        : Number(cursor.last_scanned_block);
      const configuredStart = Number(process.env[`DEPOSIT_SCAN_START_BLOCK_${netKey}`]);
      let fromBlock: number;
      if (lastScanned === null) {
        // Never silently skip historical deposits on first boot. Operators can
        // set an explicit start block to bound the initial backfill; otherwise
        // begin at genesis and advance in bounded chunks until the chain tip.
        fromBlock = Number.isSafeInteger(configuredStart) && configuredStart >= 0
          ? configuredStart
          : 0;
      } else if (lastScanned > latestBlock) {
        // A node endpoint may have changed or a reorg may have lowered the tip.
        fromBlock = Math.max(0, latestBlock - 99);
      } else if (lastScanned >= latestBlock - 20) {
        // Re-scan a trailing overlap to catch short reorgs; RPC crediting is idempotent.
        fromBlock = Math.max(0, lastScanned - 20);
      } else {
        fromBlock = lastScanned + 1;
      }
      const toBlock = Math.min(latestBlock, fromBlock + 99);
      netResult.scannedBlocks = Math.max(0, toBlock - fromBlock + 1);

      if (evmAddresses.size > 0 && fromBlock <= toBlock) {
        // Scan ERC20 / BEP20 USDT
        const tokenRes = await scanEvmTokenDeposits(netKey, evmAddresses, fromBlock, toBlock);
        netResult.depositsDetected += tokenRes.detected;
        netResult.depositsCredited += tokenRes.credited;
        netResult.errors.push(...tokenRes.errors);

        // Native-asset deposit support is ETH-only; do not treat BNB as ETH.
        if (netKey === 'ERC20' || normalizeDepositNetwork(netKey) === 'ETH') {
          const nativeRes = await scanEvmNativeDeposits(netKey, evmAddresses, fromBlock, toBlock);
          netResult.depositsDetected += nativeRes.detected;
          netResult.depositsCredited += nativeRes.credited;
          netResult.errors.push(...nativeRes.errors);
        }

        // Advance only after all applicable scans succeeded. If behind, the next
        // cycle continues at the next chunk instead of silently jumping to latest.
        if (netResult.errors.length === 0) {
          const { error: cursorWriteError } = await supabaseAdmin
            .from('deposit_scan_cursors')
            .upsert({
              network_code: netKey,
              last_scanned_block: toBlock,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'network_code' });
          if (cursorWriteError) {
            netResult.errors.push(`Unable to persist ${netKey} deposit scan cursor: ${cursorWriteError.message}`);
          }
        }
      }
    } catch (chainErr: any) {
      netResult.errors.push(`Chain scan failed: ${chainErr.message}`);
    }

    results.push(netResult);
  }

  // 2. Scan TRON
  const tronResult: IngestionResult = {
    network: 'TRC20',
    depositsDetected: 0,
    depositsCredited: 0,
    errors: [],
  };

  if (tronAddresses.size > 0) {
    const tRes = await scanTronDeposits(tronAddresses);
    tronResult.depositsDetected += tRes.detected;
    tronResult.depositsCredited += tRes.credited;
    tronResult.errors.push(...tRes.errors);
  }
  results.push(tronResult);

  // 3. Scan Bitcoin (BTC)
  const btcResult: IngestionResult = {
    network: 'BTC',
    depositsDetected: 0,
    depositsCredited: 0,
    errors: [],
  };

  if (btcAddresses.size > 0) {
    const bRes = await scanBtcDeposits(btcAddresses);
    btcResult.depositsDetected += bRes.detected;
    btcResult.depositsCredited += bRes.credited;
    btcResult.errors.push(...bRes.errors);
  }
  results.push(btcResult);

  // 4. Scan Litecoin (LTC)
  const ltcResult: IngestionResult = {
    network: 'LTC',
    depositsDetected: 0,
    depositsCredited: 0,
    errors: [],
  };

  if (ltcAddresses.size > 0) {
    const lRes = await scanLtcDeposits(ltcAddresses);
    ltcResult.depositsDetected += lRes.detected;
    ltcResult.depositsCredited += lRes.credited;
    ltcResult.errors.push(...lRes.errors);
  }
  results.push(ltcResult);

  // Pending confirmation reconciliation is handled by the dedicated
  // confirmations worker; avoid running two independent verifiers concurrently.
  return { results, pendingRecheck: { checked: 0, newlyCredited: 0 } };
}

let ingestionInterval: NodeJS.Timeout | null = null;

export function startDepositIngestionWorker(intervalMs: number = 30000): void {
  if (ingestionInterval) return;
  console.log(`[Deposit Ingestion] Background worker started, polling every ${intervalMs}ms...`);
  runDepositIngestion().catch((e) => console.error('[Deposit Ingestion] Cycle failed:', e));
  ingestionInterval = setInterval(() => {
    runDepositIngestion().catch((e) => console.error('[Deposit Ingestion] Cycle failed:', e));
  }, intervalMs);
}

export function stopDepositIngestionWorker(): void {
  if (ingestionInterval) {
    clearInterval(ingestionInterval);
    ingestionInterval = null;
  }
}
