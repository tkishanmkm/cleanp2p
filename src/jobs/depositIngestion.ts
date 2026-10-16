import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import {
  SUPPORTED_EVM_CHAINS,
  getEvmProvider,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import { TRON_CONFIG, getTronWeb, isValidTronAddress } from '@/lib/blockchain/tron';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';

// Initialize Supabase admin client with service role
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Never fall back to a public anon key: this client performs privileged deposit
// ingestion. The inert placeholder preserves build-time module initialization but
// cannot authenticate requests; worker operations fail closed until configured.
const supabaseKey = serviceRoleKey || 'missing-service-role-key';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[Deposit Ingestion] Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; privileged ingestion will fail closed.');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Canonical mainnet USDT contracts only. Environment overrides could cause
// an arbitrary token to be treated as USDT and credited to customer balances.
const CANONICAL_USDT_CONTRACTS: Record<string, string> = {
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
      .select('address, network_code, asset_code, is_active, status')
      .eq('is_active', true)
      .eq('status', 'active');

    if (pErr) {
      throw new Error(`Failed to load primary deposit addresses: ${pErr.message}`);
    }
    if (primaryAddresses) {
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
      .select('address, network, network_code, asset_code');

    if (fErr) {
      throw new Error(`Failed to load fallback deposit addresses: ${fErr.message}`);
    }
    if (fallbackAddresses) {
      for (const row of fallbackAddresses) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeDepositNetwork(row.network_code || row.network || '');
        const normCoin = (row.asset_code || '').toUpperCase().trim();

        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (
          normNet === 'BTC' ||
          normNet === 'BITCOIN' ||
          normCoin === 'BTC' ||
          clean.startsWith('bc1') ||
          clean.startsWith('1') ||
          clean.startsWith('3')
        ) {
          btcAddresses.add(clean);
        } else if (normNet === 'LTC' || normNet === 'LITECOIN' || normCoin === 'LTC' || clean.startsWith('ltc1') || clean.startsWith('L') || clean.startsWith('M')) {
          ltcAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }

    // Do not scan the generic wallets table as a deposit-address source.
    // It may contain withdrawal, trading, or otherwise non-deposit addresses.

  } catch (err) {
    console.error('[Deposit Ingestion] Cannot safely scan deposits because monitored-address loading failed:', err);
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
  // Only explicitly pinned canonical USDT contracts may trigger USDT credits.
  // Do not fall back to per-chain configuration or environment-derived addresses.
  const tokenContractAddress = CANONICAL_USDT_CONTRACTS[normNet];

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

    const providerNetwork = await provider.getNetwork();
    if (providerNetwork.chainId !== BigInt(chainConfig.chainId)) {
      return { detected, credited, errors: [`EVM token RPC chain ID mismatch for ${normNet}`] };
    }

    const latestBlock = await provider.getBlockNumber();
    if (
      !Number.isSafeInteger(fromBlock) ||
      !Number.isSafeInteger(toBlock) ||
      fromBlock < 0 ||
      toBlock < fromBlock ||
      !Number.isSafeInteger(latestBlock) ||
      latestBlock < 0
    ) {
      return { detected, credited, errors: ['Invalid EVM token scan block range or provider tip'] };
    }
    if (fromBlock > latestBlock) {
      return { detected, credited, errors: ['EVM token scan start is above the provider tip'] };
    }

    // Clamp to the current chain tip and keep each provider request bounded.
    // A caller must advance its scan window separately to catch up older blocks.
    const scanToBlock = Math.min(toBlock, latestBlock);
    const scanFromBlock = Math.max(fromBlock, scanToBlock - 99);
    const logs = await provider.getLogs({
      fromBlock: scanFromBlock,
      toBlock: scanToBlock,
      address: tokenContractAddress,
      topics: [transferTopic],
    });

    for (const log of logs) {
      try {
        if (
          !log.address ||
          log.address.toLowerCase() !== tokenContractAddress.toLowerCase() ||
          !Number.isSafeInteger(log.index) ||
          log.index < 0 ||
          !Number.isSafeInteger(log.blockNumber) ||
          log.blockNumber < scanFromBlock ||
          log.blockNumber > scanToBlock ||
          !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash || '') ||
          !/^0x[0-9a-fA-F]{64}$/.test(log.blockHash || '') ||
          !Array.isArray(log.topics) ||
          log.topics.length !== 3 ||
          log.topics.some((topic) => typeof topic !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(topic)) ||
          log.topics[0].replace(/^0x/i, '').toLowerCase() !== transferTopic.slice(2).toLowerCase().toLowerCase() ||
          typeof log.data !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(log.data)
        ) {
          errors.push('Rejected EVM token log with invalid identifiers');
          continue;
        }

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
        if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(formattedAmount)) {
          errors.push(`Invalid token amount for tx ${log.transactionHash}`);
          continue;
        }

        if (!Number.isSafeInteger(log.blockNumber) || log.blockNumber <= 0 || log.blockNumber > latestBlock) {
          errors.push(`Invalid or non-canonical block height for tx ${log.transactionHash}`);
          continue;
        }
        // A log's block height alone does not protect against a stale/reorged
        // provider response. Re-check the canonical block hash before crediting.
        const canonicalBlock = await provider.getBlock(log.blockNumber);
        if (!canonicalBlock ||
            canonicalBlock.number !== log.blockNumber ||
            typeof canonicalBlock.hash !== 'string' ||
            !/^0x[0-9a-fA-F]{64}$/.test(canonicalBlock.hash) ||
            canonicalBlock.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
          errors.push(`Rejected EVM token log from a non-canonical block for tx ${log.transactionHash}`);
          continue;
        }
        const confirmations = latestBlock - log.blockNumber + 1;
        detected++;

        // Call canonical atomic deposit RPC using the exact decimal amount string.
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
          let res: any;
          try {
            res = typeof data === 'string' ? JSON.parse(data) : data;
          } catch {
            errors.push(`Invalid RPC result for token transfer ${log.transactionHash}`);
            continue;
          }
          if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.status !== 'string') {
            errors.push(`Malformed RPC result for token transfer ${log.transactionHash}`);
            continue;
          }
          if (res.status === 'credited') {
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

  // The canonical deposit-credit RPC currently supports native ETH only.
  // Do not scan BNB (or any future native asset) as if it were creditable.
  if (chainConfig.nativeSymbol !== 'ETH' || normNet !== 'ERC20') {
    return {
      detected: 0,
      credited: 0,
      errors: [`Native deposit scanning is disabled for unsupported asset/network ${chainConfig.nativeSymbol}/${normNet}`],
    };
  }

  const provider = getEvmProvider(normNet);

  try {
    const providerNetwork = await provider.getNetwork();
    if (providerNetwork.chainId !== BigInt(chainConfig.chainId)) {
      return { detected, credited, errors: [`EVM native RPC chain ID mismatch for ${normNet}`] };
    }

    const latestBlock = await provider.getBlockNumber();
    if (
      !Number.isSafeInteger(fromBlock) ||
      !Number.isSafeInteger(toBlock) ||
      !Number.isSafeInteger(latestBlock) ||
      fromBlock < 0 ||
      toBlock < fromBlock ||
      latestBlock < 0
    ) {
      return { detected, credited, errors: ['Invalid EVM native scan block range or provider tip'] };
    }
    if (fromBlock > latestBlock) {
      return { detected, credited, errors: ['EVM native scan start is above the provider tip'] };
    }

    // Scan only canonical recent blocks. Do not ingest provider-supplied historical
    // asset-transfer summaries: they can be incomplete, use ambiguous output indexes,
    // and may replay old transactions outside the intended scan window.
    // Iterate through a bounded, canonical range. Never request blocks above
    // the provider's current tip, and report unavailable blocks instead of silently
    // treating a partial scan as complete.
    const end = Math.min(toBlock, latestBlock);
    const start = Math.max(fromBlock, end - 24);
    for (let b = start; b <= end; b++) {
      const block = await provider.getBlock(b, true);
      if (!block) {
        errors.push(`Provider returned no block for native deposit scan at height ${b}`);
        continue;
      }
      if (block.number !== b ||
          typeof block.hash !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
        errors.push(`Provider returned an invalid block identity for native deposit scan at height ${b}`);
        continue;
      }
      if (!Array.isArray(block.prefetchedTransactions)) {
        errors.push(`Provider returned an invalid transaction list for block ${b}`);
        continue;
      }

      for (const tx of block.prefetchedTransactions) {
        if (
          !tx.to ||
          !/^0x[0-9a-fA-F]{40}$/.test(tx.to) ||
          typeof tx.from !== 'string' ||
          !/^0x[0-9a-fA-F]{40}$/.test(tx.from) ||
          !/^0x[0-9a-fA-F]{64}$/.test(tx.hash || '') ||
          tx.blockNumber !== b ||
          typeof tx.blockHash !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(tx.blockHash) ||
          tx.blockHash.toLowerCase() !== block.hash.toLowerCase() ||
          typeof tx.value !== 'bigint' ||
          tx.value < 0n
        ) {
          continue;
        }
        const toClean = tx.to.toLowerCase();

        if (monitoredEvmAddresses.has(toClean) && tx.value > BigInt(0)) {
          const formattedAmount = ethers.formatUnits(tx.value, chainConfig.nativeDecimals);
          // Keep the exact decimal string from bigint formatting; converting native
          // coin amounts to Number can silently round financially meaningful digits.
          if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(formattedAmount) || tx.value <= 0n) {
            errors.push(`Invalid native transfer amount for ${tx.hash}`);
            continue;
          }
          if (!Number.isSafeInteger(b) || b <= 0 || b > latestBlock) {
            errors.push(`Invalid or non-canonical block height for native tx ${tx.hash}`);
            continue;
          }
          const confirmations = latestBlock - b + 1;
          detected++;

          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toClean,
            p_asset_symbol: chainConfig.nativeSymbol,
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
            let res: any;
            try {
              res = typeof data === 'string' ? JSON.parse(data) : data;
            } catch {
              errors.push(`Invalid RPC response for native transfer ${tx.hash}`);
              continue;
            }
            if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.status !== 'string') {
              errors.push(`Malformed RPC response for native transfer ${tx.hash}`);
              continue;
            }
            if (res.status === 'credited') {
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
    const contractAddress = CANONICAL_USDT_CONTRACTS.TRC20;

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
    // Only the independently verified TRON mainnet USDT contract is trusted.
    // Environment overrides must not silently authorize an arbitrary token as USDT.
    addKnownContract('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');

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
        if (
          !bData?.error &&
          typeof bData?.result === 'string' &&
          /^0x[0-9a-fA-F]+$/.test(bData.result)
        ) {
          const parsedBlock = Number.parseInt(bData.result.slice(2), 16);
          if (Number.isSafeInteger(parsedBlock) && parsedBlock > 0) {
            latestBlock = parsedBlock;
          }
        } else if (bData?.error) {
          errors.push('TRON JSON-RPC returned an error while fetching latest block');
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
          const candidate = nbData?.block_header?.raw_data?.number;
          if (Number.isSafeInteger(candidate) && candidate > 0) {
            latestBlock = candidate;
          } else {
            errors.push('TRON getnowblock returned an invalid block height');
          }
        } else {
          errors.push(`TRON getnowblock failed with HTTP ${nowBlockRes.status}`);
        }
      } catch (_) {}
    }

    if (!latestBlock) {
      try {
        const curBlock = await tronWeb.trx.getCurrentBlock();
        const candidate = curBlock?.block_header?.raw_data?.number;
        if (Number.isSafeInteger(candidate) && candidate > 0) {
          latestBlock = candidate;
        } else {
          errors.push('TRON SDK returned an invalid current block height');
        }
      } catch (_) {}
    }

    // Never ingest TRON deposits without a validated current chain height;
    // otherwise confirmation calculations could be based on a fabricated zero.
    if (!Number.isSafeInteger(latestBlock) || latestBlock <= 0) {
      errors.push('Unable to determine a valid TRON latest block; scan aborted');
      return { detected, credited, errors };
    }

    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const seenTxIndices = new Set<string>();

    // 2. Strategy A: Direct Monitored Account TRC-20 Transaction Ingestion via TronGrid
    // Queries each monitored TRON address for incoming TRC-20 transfers (works reliably regardless of block depth)
    for (const monitoredAddr of monitoredTronAddresses) {
      try {
        const accountUrl = tronGridHost + '/v1/accounts/' + encodeURIComponent(monitoredAddr) + '/transactions/trc20?limit=200&only_confirmed=true&contract_address=' + encodeURIComponent(CANONICAL_USDT_CONTRACTS.TRC20);
        // Collect a bounded set of TronGrid pages. If the provider cannot supply
        // a progressing cursor, report an incomplete scan rather than implying
        // the address history was fully checked.
        const items: any[] = [];
        const seenFingerprints = new Set<string>();
        let fingerprint: string | null = null;
        let paginationIncomplete = false;
        const maxPages = 20;
        for (let page = 0; page < maxPages; page++) {
          const pageUrl = new URL(accountUrl);
          if (fingerprint) pageUrl.searchParams.set('fingerprint', fingerprint);
          let res: Response;
          try {
            res = await fetch(pageUrl.toString(), { headers: tronGridHeaders });
          } catch (pageErr) {
            errors.push(`TronGrid account-transfer request failed for a monitored address: ${pageErr instanceof Error ? pageErr.message : 'network error'}`);
            paginationIncomplete = true;
            break;
          }
          if (!res.ok) {
            errors.push(`TronGrid account-transfer request failed with HTTP ${res.status}`);
            paginationIncomplete = true;
            break;
          }
          let json: any;
          try {
            json = await res.json();
          } catch {
            errors.push('TronGrid account-transfer response was not valid JSON');
            paginationIncomplete = true;
            break;
          }
          if (!json || !Array.isArray(json.data)) {
            errors.push('TronGrid account-transfer response had an invalid data shape');
            paginationIncomplete = true;
            break;
          }
          items.push(...json.data);
          const nextFingerprint = json.meta?.fingerprint;
          if (typeof nextFingerprint !== 'string' || nextFingerprint.length === 0) {
            if (json.data.length >= 200) {
              errors.push('TRON account-transfer page limit reached without a usable pagination cursor; scan is incomplete');
              paginationIncomplete = true;
            }
            break;
          }
          if (seenFingerprints.has(nextFingerprint) || nextFingerprint === fingerprint) {
            errors.push('TRON account-transfer pagination cursor repeated; scan is incomplete');
            paginationIncomplete = true;
            break;
          }
          seenFingerprints.add(nextFingerprint);
          fingerprint = nextFingerprint;
          if (page === maxPages - 1) {
            errors.push('TRON account-transfer pagination safety limit reached; scan is incomplete');
            paginationIncomplete = true;
          }
        }
        if (paginationIncomplete) {
          errors.push(`TRON deposit scan may be incomplete for monitored address ${monitoredAddr}`);
        }
          for (const item of items) {
            if (item.type !== 'Transfer') continue;

            let toAddr = item.to || '';
            try {
              if (toAddr.startsWith('41') || toAddr.startsWith('0x')) {
                toAddr = tronWeb.address.fromHex(toAddr);
              }
            } catch (err) {
          console.error('[Deposit Ingestion] Invalid TRON recipient address from provider event; event skipped:', err instanceof Error ? err.message : 'unknown provider error');
        }

            if (toAddr !== monitoredAddr && !monitoredTronAddresses.has(toAddr)) {
              continue;
            }

            const txId = item.transaction_id;
            // Reject malformed provider identifiers and raw token values before
            // deduplication or numeric conversion.
            if (!/^[0-9a-fA-F]{64}$/.test(txId || '')) {
              errors.push('Rejected TRON transfer with invalid transaction identifier');
              continue;
            }
            if (typeof item.value !== 'string' || !/^\d+$/.test(item.value)) {
              errors.push(`Rejected TRON transfer with invalid raw amount: ${txId}`);
              continue;
            }

            let fromAddr: string | null = item.from || null;
            try {
              if (fromAddr && (fromAddr.startsWith('41') || fromAddr.startsWith('0x'))) {
                fromAddr = tronWeb.address.fromHex(fromAddr);
              }
            } catch (err) {
          console.error('[Deposit Ingestion] Invalid TRON sender address from provider event; sender omitted:', err instanceof Error ? err.message : 'unknown provider error');
        }

            // Never trust provider metadata to choose the token or its decimals:
            // a malicious/unsupported TRC-20 token could otherwise be credited as USDT.
            const tokenContract = item.token_info?.address || '';
            if (tokenContract !== 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') {
              continue;
            }

            const rawVal = BigInt(item.value);
            if (rawVal <= 0n) continue;
            const formattedAmount = ethers.formatUnits(rawVal, 6);
            if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(formattedAmount)) continue;

            // The account-transfer endpoint may return multiple TRC-20 Transfer
            // events for one transaction. Never collapse them to output index 0:
            // that can suppress a legitimate deposit or collide with another event.
            const rawEventIndex = item.event_index ?? item.eventIndex ?? item.log_index ?? item.logIndex;
            const eventIndex = typeof rawEventIndex === 'number'
              ? rawEventIndex
              : typeof rawEventIndex === 'string' && /^\d+$/.test(rawEventIndex)
                ? Number(rawEventIndex)
                : Number.NaN;
            if (!Number.isSafeInteger(eventIndex) || eventIndex < 0) {
              errors.push(`Rejected TRON account transfer without a reliable event index: ${txId}`);
              continue;
            }

            // Check duplicates now, but reserve the key only after the event's
            // block height is validated so malformed provider data cannot suppress
            // a valid observation from another scanner strategy.
            const deduplicationKey = `${txId}_${eventIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;

            // Fetch block number from TRON RPC if missing from account event
            let eventBlock = item.block_number || 0;
            if (!eventBlock) {
              try {
                const txInfoRes = await fetch(`${tronHost}/wallet/gettransactioninfobyid`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ value: txId }),
                });
                if (txInfoRes.ok) {
                  const txInfo = await txInfoRes.json();
                  eventBlock = txInfo.blockNumber || 0;
                }
              } catch (err) {
          console.error('[Deposit Ingestion] Could not fetch TRON transaction info for event block fallback:', err instanceof Error ? err.message : 'unknown provider error');
        }
            }

            // Never treat missing/unverified chain height as one confirmation.
            // Without both heights, fail closed and let a later scan retry.
            if (
              !Number.isSafeInteger(eventBlock) ||
              eventBlock <= 0 ||
              !Number.isSafeInteger(latestBlock) ||
              latestBlock <= 0 ||
              eventBlock > latestBlock
            ) {
              errors.push(`Rejected TRON deposit with unavailable or invalid block height: ${txId}`);
              continue;
            }

            // Verify that the transaction itself is included at the claimed height;
            // a valid block at that height alone does not bind this transfer to it.
            const txInfoRes = await fetch(`${tronHost}/wallet/gettransactioninfobyid`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: txId }),
            });
            if (!txInfoRes.ok) {
              errors.push(`TRON transaction-info request failed with HTTP ${txInfoRes.status} for ${txId}`);
              continue;
            }
            let txInfo: any;
            try {
              txInfo = await txInfoRes.json();
            } catch {
              errors.push(`Invalid TRON transaction-info JSON for ${txId}`);
              continue;
            }
            if (
              !txInfo ||
              typeof txInfo !== 'object' ||
              Array.isArray(txInfo) ||
              typeof txInfo.id !== 'string' ||
              !/^[0-9a-fA-F]{64}$/.test(txInfo.id) ||
              txInfo.id.toLowerCase() !== txId.toLowerCase() ||
              !Number.isSafeInteger(txInfo.blockNumber) ||
              txInfo.blockNumber !== eventBlock
            ) {
              errors.push(`Rejected TRON account transfer with unverifiable transaction inclusion: ${txId}`);
              continue;
            }

            // A mined transaction can still have failed its TRON smart-contract
            // execution. Require an explicit successful receipt before treating a
            // provider-listed TRC-20 event as creditable.
            if (txInfo?.receipt?.result !== 'SUCCESS') {
              errors.push(`Rejected TRON account transfer without a successful execution receipt: ${txId}`);
              continue;
            }

            // Do not trust TronGrid's account endpoint alone for token amount or
            // recipient. Bind the reported event to a successful on-chain receipt log.
            const receiptLogs = txInfo?.log;
            if (!Array.isArray(receiptLogs)) {
              errors.push(`TRON transaction receipt has no verifiable logs: ${txId}`);
              continue;
            }
            let expectedContractHex = '';
            let expectedRecipientHex = '';
            let expectedSenderHex = '';
            try {
              expectedContractHex = tronWeb.address.toHex(CANONICAL_USDT_CONTRACTS.TRC20).replace(/^0x/i, '').toLowerCase();
              expectedRecipientHex = tronWeb.address.toHex(toAddr).replace(/^0x/i, '').toLowerCase();
              if (fromAddr) expectedSenderHex = tronWeb.address.toHex(fromAddr).replace(/^0x/i, '').toLowerCase();
            } catch {
              errors.push(`TRON account transfer contains an invalid sender or recipient address: ${txId}`);
              continue;
            }
            const expectedRawAmount = BigInt(item.value).toString(16).padStart(64, '0').toLowerCase();
            const receiptLogMatches = receiptLogs.some((log: any) => {
              if (!log || typeof log !== 'object' || Array.isArray(log)) return false;
              const logAddress = typeof log.address === 'string'
                ? log.address.replace(/^0x/i, '').toLowerCase()
                : '';
              const topics = log.topics;
              if (
                logAddress !== expectedContractHex &&
                logAddress !== expectedContractHex.replace(/^41/, '')
              ) return false;
              if (!Array.isArray(topics) || topics.length !== 3 ||
                  topics.some((topic: unknown) => typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic)) ||
                  topics[0].toLowerCase() !== transferTopic) return false;
              const topicSender = topics[1].replace(/^0x/i, '').slice(-40).toLowerCase();
              const topicRecipient = topics[2].replace(/^0x/i, '').slice(-40).toLowerCase();
              const recipientHex20 = expectedRecipientHex.slice(-40);
              const senderHex20 = expectedSenderHex.slice(-40);
              const data = typeof log.data === 'string' ? log.data.replace(/^0x/i, '') : '';
              if (!/^[0-9a-fA-F]{64}$/.test(data) || data.toLowerCase() !== expectedRawAmount) return false;
              if (topicRecipient !== recipientHex20) return false;
              if (expectedSenderHex && topicSender !== senderHex20) return false;
              return true;
            });
            if (!receiptLogMatches) {
              errors.push(`Rejected TRON account transfer not matched by an exact successful receipt Transfer log: ${txId}`);
              continue;
            }

            // Confirm the account API's block assignment against the chain RPC
            // before reserving the event key or attempting a credit.
            const canonicalRes = await fetch(`${tronHost}/wallet/getblockbynum`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ num: eventBlock }),
            });
            if (!canonicalRes.ok) {
              errors.push(`TRON canonical block request failed with HTTP ${canonicalRes.status} at block ${eventBlock}`);
              continue;
            }
            let canonicalJson: any;
            try {
              canonicalJson = await canonicalRes.json();
            } catch {
              errors.push(`Invalid TRON canonical-block JSON at block ${eventBlock}`);
              continue;
            }
            if (!canonicalJson || typeof canonicalJson !== 'object' || Array.isArray(canonicalJson)) {
              errors.push(`Invalid TRON canonical-block response shape at block ${eventBlock}`);
              continue;
            }
            const canonicalBlockNumber = canonicalJson?.block_header?.raw_data?.number;
            const canonicalBlockId = canonicalJson?.blockID;
            const providerBlockId = item.block_hash ?? item.blockHash;
            if (
              canonicalJson?.Error ||
              canonicalBlockNumber !== eventBlock ||
              typeof canonicalBlockId !== 'string' ||
              !/^[0-9a-fA-F]{64}$/.test(canonicalBlockId) ||
              (providerBlockId != null &&
                (typeof providerBlockId !== 'string' ||
                  !/^[0-9a-fA-F]{64}$/.test(providerBlockId) ||
                  providerBlockId.toLowerCase() !== canonicalBlockId.toLowerCase()))
            ) {
              errors.push(`Rejected TRON account transfer with unverifiable block identity: ${txId}`);
              continue;
            }

            // Do not pass a negative/zero confirmation count to the privileged
            // credit RPC if the provider's event is ahead of the observed chain tip.
            if (eventBlock > latestBlock) {
              errors.push(`Rejected TRON account transfer above observed chain tip: ${txId}`);
              continue;
            }
            const confirmations = latestBlock - eventBlock + 1;
            if (!Number.isSafeInteger(confirmations) || confirmations <= 0) {
              errors.push(`Rejected TRON account transfer with invalid confirmation count: ${txId}`);
              continue;
            }
            seenTxIndices.add(deduplicationKey);

            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toAddr,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: eventIndex,
              p_block_number: eventBlock || null,
              p_from_address: fromAddr,
              p_token_contract: tokenContract,
              p_confirmations: confirmations,
              p_provider: 'deposit_ingestion',
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              let r: any;
              try {
                r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              } catch {
                errors.push(`Invalid RPC result for TRON deposit ${txId}`);
                continue;
              }
              if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.status !== 'string') {
                errors.push(`Malformed RPC result for TRON deposit ${txId}`);
                continue;
              }
              if (r.status === 'credited') {
                credited++;
              }
            }
          }
        }
      } catch (acctErr: any) {
        errors.push(`TronGrid account TRC20 error for ${monitoredAddr}: ${acctErr.message}`);
      }
    }

    // 3. Strategy B: TronGrid Contract Event Ingestion (Transfer events on known USDT contracts)
    for (const cAddr of knownContracts) {
      try {
        const eventUrl = `${tronGridHost}/v1/contracts/${cAddr}/events?event_name=Transfer&limit=50&order_by=block_timestamp,desc`;
        const res = await fetch(eventUrl, { headers: tronGridHeaders });
        if (!res.ok) {
          errors.push(`TronGrid contract-event request failed with HTTP ${res.status}`);
          continue;
        }
        {
          const data = await res.json();
          if (!data || !Array.isArray(data.data)) {
            errors.push('TronGrid contract-event response had an invalid data shape');
            continue;
          }
          for (const evt of data.data) {
            if (!evt || typeof evt !== 'object' || Array.isArray(evt)) {
              errors.push('Rejected malformed TRON contract event');
              continue;
            }
            const txId = evt.transaction_id;
            const outputIndex = Number(evt.event_index);
            // A transaction can contain multiple Transfer events. Never collapse
            // missing/invalid event indices to zero, or different events can collide.
            if (!/^[0-9a-fA-F]{64}$/.test(txId || '') ||
                !Number.isSafeInteger(outputIndex) || outputIndex < 0) {
              errors.push('Rejected TRON contract event with invalid transaction/event index');
              continue;
            }

            const fromHex = evt.result?.from;
            const toHex = evt.result?.to;
            const rawValue = evt.result?.value;
            // ERC-20/TRC-20 uint256 values are at most 78 decimal digits; cap input before BigInt parsing.
            if (!toHex || typeof rawValue !== 'string' || rawValue.length > 78 || !/^\d+$/.test(rawValue)) continue;

            let toBase58 = toHex;
            let fromBase58: string | null = fromHex || null;
            try {
              if (toHex.startsWith('41') || toHex.startsWith('0x')) {
                toBase58 = tronWeb.address.fromHex(toHex);
              }
              if (fromHex && (fromHex.startsWith('41') || fromHex.startsWith('0x'))) {
                fromBase58 = tronWeb.address.fromHex(fromHex);
              }
            } catch (err) {
          console.error('[Deposit Ingestion] Could not normalize TRON sender address from log:', err instanceof Error ? err.message : 'unknown provider error');
        }

            if (!monitoredTronAddresses.has(toBase58)) continue;

            const actualContract = evt.contract_address || evt.contractAddress;
            if (actualContract !== CANONICAL_USDT_CONTRACTS.TRC20) continue;
            const rawValBig = BigInt(rawValue);
            if (rawValBig <= 0n) continue;
            const deduplicationKey = `${txId}_${outputIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;
            const formattedAmount = ethers.formatUnits(rawValBig, 6);
            if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(formattedAmount)) continue;
            const eventBlock = Number(evt.block_number || 0);
            if (!Number.isSafeInteger(eventBlock) || eventBlock <= 0 || !latestBlock || latestBlock < eventBlock) continue;

            // Verify TronGrid's event block against the TRON node before
            // reserving the event key or passing it to the credit RPC.
            const canonicalRes = await fetch(`${tronHost}/wallet/getblockbynum`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ num: eventBlock }),
            });
            if (!canonicalRes.ok) {
              errors.push(`TRON canonical block request failed with HTTP ${canonicalRes.status} at block ${eventBlock}`);
              continue;
            }
            const canonicalJson = await canonicalRes.json();
            const canonicalBlockNumber = canonicalJson?.block_header?.raw_data?.number;
            const canonicalBlockId = canonicalJson?.blockID;
            const providerBlockId = evt.block_hash ?? evt.blockHash;
            if (
              canonicalJson?.Error ||
              canonicalBlockNumber !== eventBlock ||
              typeof canonicalBlockId !== 'string' ||
              !/^[0-9a-fA-F]{64}$/.test(canonicalBlockId) ||
              (typeof providerBlockId === 'string' &&
                (!/^[0-9a-fA-F]{64}$/.test(providerBlockId) ||
                  providerBlockId.toLowerCase() !== canonicalBlockId.toLowerCase()))
            ) {
              errors.push(`Rejected TRON contract event with unverifiable block identity: ${txId}`);
              continue;
            }

            const confirmations = latestBlock - eventBlock + 1;
            seenTxIndices.add(deduplicationKey);
            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toBase58,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: outputIndex,
              p_block_number: eventBlock || null,
              p_from_address: fromBase58,
              // Pass the contract that was actually validated, never an
              // environment- or provider-selected alias.
              p_token_contract: actualContract,
              p_confirmations: confirmations,
              p_provider: 'deposit_ingestion',
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              let r: any;
              try {
                r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              } catch {
                errors.push(`Invalid RPC result for TRON contract event ${txId}`);
                continue;
              }
              if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.status !== 'string') {
                errors.push(`Malformed RPC result for TRON contract event ${txId}`);
                continue;
              }
              if (r.status === 'credited') {
                credited++;
              }
            }
          }
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
              if (!res.ok) {
                throw new Error(`TRON eth_getLogs HTTP ${res.status} for blocks ${r.from}-${clampedTo}`);
              }
              const json = await res.json();
              if (!json || json.error) {
                throw new Error(`TRON eth_getLogs provider error for blocks ${r.from}-${clampedTo}`);
              }
              if (!Array.isArray(json.result)) {
                throw new Error(`TRON eth_getLogs returned an invalid result for blocks ${r.from}-${clampedTo}`);
              }
              return json.result;
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
          const logIndexHex = log.logIndex;
          if (
            !/^[0-9a-fA-F]{64}$/.test(txHash) ||
            typeof logIndexHex !== 'string' ||
            !/^0x[0-9a-fA-F]+$/.test(logIndexHex)
          ) {
            errors.push('Rejected TRON RPC log with invalid transaction hash or log index');
            continue;
          }
          const outputIndex = Number.parseInt(logIndexHex.slice(2), 16);
          if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) {
            errors.push('Rejected TRON RPC log with invalid log index');
            continue;
          }
          const deduplicationKey = `${txHash}_${outputIndex}`;
          if (seenTxIndices.has(deduplicationKey)) continue;

          // Validate the emitting token contract and ABI fields before decoding
          // or reserving this event's idempotency key.
          const logAddrHex = (log.address || '').toLowerCase().replace(/^0x/, '');
          if (!/^[0-9a-f]{40}$/.test(logAddrHex)) continue;
          let eventContractBase58 = '';
          try {
            eventContractBase58 = tronWeb.address.fromHex('41' + logAddrHex);
          } catch (_) {
            continue;
          }
          if (eventContractBase58 !== CANONICAL_USDT_CONTRACTS.TRC20) continue;
          if (
            !/^0x[0-9a-fA-F]{64}$/.test(log.topics[1] || '') ||
            !/^0x[0-9a-fA-F]{64}$/.test(log.topics[2] || '') ||
            !/^0x[0-9a-fA-F]{64}$/.test(log.data || '')
          ) continue;

          let toBase58 = '';
          try {
            const toHex = '41' + (log.topics[2] || '').slice(-40);
            toBase58 = tronWeb.address.fromHex(toHex);
          } catch (_) {
            continue;
          }

          if (!monitoredTronAddresses.has(toBase58)) continue;

          let fromBase58: string | null = null;
          try {
            const fromHex = '41' + (log.topics[1] || '').slice(-40);
            fromBase58 = tronWeb.address.fromHex(fromHex);
          } catch (err) {
          console.error('[Deposit Ingestion] Could not normalize TRON log sender address:', err instanceof Error ? err.message : 'unknown provider error');
        }

          let formattedAmount = '';
          try {
            const rawValue = BigInt(log.data || '0x0');
            if (rawValue <= 0n) continue;
            formattedAmount = ethers.formatUnits(rawValue, 6);
            if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(formattedAmount)) continue;
          } catch (_) {
            continue;
          }

          const blockHex = log.blockNumber;
          if (typeof blockHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(blockHex)) continue;
          const eventBlock = Number.parseInt(blockHex.slice(2), 16);
          if (!Number.isSafeInteger(eventBlock) || eventBlock <= 0 || eventBlock > latestBlock) continue;

          // Do not credit an event whose block is missing or no longer canonical.
          const logBlockHash = log.blockHash;
          if (typeof logBlockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(logBlockHash)) {
            errors.push(`Rejected TRON RPC log with invalid block hash: ${txHash}`);
            continue;
          }
          const canonicalRes = await fetch(tronHost, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_getBlockByNumber',
              params: [blockHex, false],
            }),
          });
          if (!canonicalRes.ok) {
            errors.push(`TRON canonical block request failed with HTTP ${canonicalRes.status} at block ${eventBlock}`);
            continue;
          }
          const canonicalJson = await canonicalRes.json();
          const canonicalBlock = canonicalJson?.result;
          if (
            canonicalJson?.error ||
            !canonicalBlock ||
            canonicalBlock.number !== blockHex ||
            typeof canonicalBlock.hash !== 'string' ||
            !/^0x[0-9a-fA-F]{64}$/.test(canonicalBlock.hash) ||
            canonicalBlock.hash.toLowerCase() !== logBlockHash.toLowerCase()
          ) {
            errors.push(`Rejected TRON RPC log from a non-canonical or unverifiable block: ${txHash}`);
            continue;
          }
          const confirmations = latestBlock - eventBlock + 1;

          seenTxIndices.add(deduplicationKey);
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
            let res: any;
            try {
              res = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
            } catch {
              errors.push(`Invalid RPC result for TRON JSON-RPC deposit ${txHash}`);
              continue;
            }
            if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.status !== 'string') {
              errors.push(`Malformed RPC result for TRON JSON-RPC deposit ${txHash}`);
              continue;
            }
            if (res.status === 'credited') {
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

/**
 * Scans Bitcoin (BTC Native SegWit / Bech32) UTXO deposits for monitored addresses
 */
async function scanBtcDeposits(
  monitoredBtcAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];
  if (monitoredBtcAddresses.size === 0) return { detected, credited, errors };

  try {
    const btcApiBase = getBtcMempoolApi();
    const tipResponse = await fetch(`${btcApiBase}/blocks/tip/height`);
    if (!tipResponse.ok) return { detected, credited, errors: [`Unable to retrieve BTC tip height (HTTP ${tipResponse.status})`] };
    const tipHeight = Number((await tipResponse.text()).trim());
    if (!Number.isSafeInteger(tipHeight) || tipHeight < 0) return { detected, credited, errors: ['Invalid BTC tip height response'] };

    for (const address of monitoredBtcAddresses) {
      try {
        const response = await fetch(`${btcApiBase}/address/${address}/txs`);
        if (!response.ok) { errors.push(`BTC address query failed (HTTP ${response.status})`); continue; }
        const txs = await response.json();
        if (!Array.isArray(txs)) { errors.push('Invalid BTC transaction list response'); continue; }

        for (const tx of txs) {
          if (
            typeof tx?.txid !== 'string' ||
            !/^[0-9a-fA-F]{64}$/.test(tx.txid) ||
            !Array.isArray(tx.vout)
          ) {
            errors.push('Rejected BTC transaction with invalid identifier or outputs');
            continue;
          }
          const confirmedHeight = tx.status?.confirmed === true ? tx.status?.block_height : null;
          if (
            confirmedHeight !== null &&
            (!Number.isSafeInteger(confirmedHeight) || confirmedHeight <= 0 || confirmedHeight > tipHeight)
          ) {
            errors.push(`Rejected BTC transaction with invalid confirmation height: ${tx.txid}`);
            continue;
          }
          for (let index = 0; index < tx.vout.length; index++) {
            const output = tx.vout[index];
            if (output?.scriptpubkey_address !== address || !Number.isSafeInteger(output.value) || output.value <= 0) continue;
            detected++;
            const satoshis = BigInt(output.value);
            const amount = `${satoshis / 100_000_000n}.${(satoshis % 100_000_000n).toString().padStart(8, '0')}`.replace(/\.?0+$/, '');
            const blockHeight = tx.status?.block_height;
            const confirmations = tx.status?.confirmed === true && Number.isSafeInteger(blockHeight) && blockHeight > 0
              ? Math.max(0, tipHeight - blockHeight + 1) : 0;
            const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: address, p_asset_symbol: 'BTC', p_network_code: 'BTC',
              p_amount: amount, p_tx_hash: tx.txid, p_output_index: index,
              p_block_number: confirmations > 0 ? blockHeight : null, p_from_address: null,
              p_token_contract: null, p_confirmations: confirmations, p_provider: 'deposit_ingestion',
            });
            if (error) errors.push(`RPC error for BTC deposit ${tx.txid}:${index}: ${error.message}`);
            else {
              let result: any;
              try {
                result = typeof data === 'string' ? JSON.parse(data) : data;
              } catch {
                errors.push(`Invalid RPC result for BTC deposit ${tx.txid}:${index}`);
                continue;
              }
              if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
                errors.push(`Malformed RPC result for BTC deposit ${tx.txid}:${index}`);
                continue;
              }
              if (result.status === 'credited') credited++;
            }
          }
        }
      } catch (error: any) { errors.push(`BTC scan failed for an address: ${error?.message || 'unknown error'}`); }
    }
  } catch (error: any) { errors.push(`BTC scan failed: ${error?.message || 'unknown error'}`); }
  return { detected, credited, errors };
}

async function scanLtcDeposits(
  monitoredLtcAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];
  if (monitoredLtcAddresses.size === 0) return { detected, credited, errors };

  try {
    const ltcApiBase = (process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api').replace(/\/$/, '');
    const tipResponse = await fetch(`${ltcApiBase}/blocks/tip/height`);
    if (!tipResponse.ok) return { detected, credited, errors: [`Unable to retrieve LTC tip height (HTTP ${tipResponse.status})`] };
    const tipHeight = Number((await tipResponse.text()).trim());
    if (!Number.isSafeInteger(tipHeight) || tipHeight < 0) return { detected, credited, errors: ['Invalid LTC tip height response'] };

    for (const address of monitoredLtcAddresses) {
      try {
        const response = await fetch(`${ltcApiBase}/address/${address}/txs`);
        if (!response.ok) { errors.push(`LTC address query failed (HTTP ${response.status})`); continue; }
        const txs = await response.json();
        if (!Array.isArray(txs)) { errors.push('Invalid LTC transaction list response'); continue; }

        for (const tx of txs) {
          if (
            typeof tx?.txid !== 'string' ||
            !/^[0-9a-fA-F]{64}$/.test(tx.txid) ||
            !Array.isArray(tx.vout)
          ) {
            errors.push('Rejected LTC transaction with invalid identifier or outputs');
            continue;
          }
          const confirmedHeight = tx.status?.confirmed === true ? tx.status?.block_height : null;
          if (
            confirmedHeight !== null &&
            (!Number.isSafeInteger(confirmedHeight) || confirmedHeight <= 0 || confirmedHeight > tipHeight)
          ) {
            errors.push(`Rejected LTC transaction with invalid confirmation height: ${tx.txid}`);
            continue;
          }
          for (let index = 0; index < tx.vout.length; index++) {
            const output = tx.vout[index];
            if (output?.scriptpubkey_address !== address || !Number.isSafeInteger(output.value) || output.value <= 0) continue;
            detected++;
            const litoshis = BigInt(output.value);
            const amount = `${litoshis / 100_000_000n}.${(litoshis % 100_000_000n).toString().padStart(8, '0')}`.replace(/\.?0+$/, '');
            const blockHeight = tx.status?.block_height;
            const confirmations = tx.status?.confirmed === true && Number.isSafeInteger(blockHeight) && blockHeight > 0
              ? Math.max(0, tipHeight - blockHeight + 1) : 0;
            const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: address, p_asset_symbol: 'LTC', p_network_code: 'LTC',
              p_amount: amount, p_tx_hash: tx.txid, p_output_index: index,
              p_block_number: confirmations > 0 ? blockHeight : null, p_from_address: null,
              p_token_contract: null, p_confirmations: confirmations, p_provider: 'deposit_ingestion',
            });
            if (error) errors.push(`RPC error for LTC deposit ${tx.txid}:${index}: ${error.message}`);
            else {
              let result: any;
              try {
                result = typeof data === 'string' ? JSON.parse(data) : data;
              } catch {
                errors.push(`Invalid RPC result for LTC deposit ${tx.txid}:${index}`);
                continue;
              }
              if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
                errors.push(`Malformed RPC result for LTC deposit ${tx.txid}:${index}`);
                continue;
              }
              if (result.status === 'credited') credited++;
            }
          }
        }
      } catch (error: any) { errors.push(`LTC scan failed for an address: ${error?.message || 'unknown error'}`); }
    }
  } catch (error: any) { errors.push(`LTC scan failed: ${error?.message || 'unknown error'}`); }
  return { detected, credited, errors };
}

/**
 * Parse BTC/LTC decimal amounts exactly into integer base units (satoshis).
 * Returns null for malformed values or precision beyond the chain's 8 decimals.
 */
function parseBaseUnits8(value: unknown): bigint | null {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(raw);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] || '').padEnd(8, '0') || '0');
  return whole * 100_000_000n + fraction;
}

async function refreshPendingDepositConfirmations(): Promise<{
  checked: number;
  newlyCredited: number;
}> {
  let checked = 0;
  let newlyCredited = 0;

  try {
    const { data: pendingDeposits, error } = await supabaseAdmin
      .from('onchain_deposits')
      .select('*')
      .eq('status', 'PENDING')
      // Process the oldest pending rows first so a backlog larger than the batch
      // limit does not indefinitely starve older deposits.
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      throw new Error(`Failed to load pending deposits: ${error.message}`);
    }
    if (!pendingDeposits || pendingDeposits.length === 0) {
      return { checked: 0, newlyCredited: 0 };
    }

    checked = pendingDeposits.length;

    for (const dep of pendingDeposits) {
      const normNet = normalizeDepositNetwork(dep.network);
      if (normNet !== 'TRC20' && normNet !== 'BTC' && normNet !== 'LTC' &&
          !Object.prototype.hasOwnProperty.call(SUPPORTED_EVM_CHAINS, normNet)) {
        console.error('[Deposit Ingestion] Skipping pending deposit with unsupported network');
        continue;
      }
      // Validate persisted transaction identifiers before querying providers or
      // passing them back to the privileged credit RPC.
      const txHash = typeof dep.tx_hash === 'string' ? dep.tx_hash : '';
      const validTxHash = normNet === 'TRC20' || normNet === 'BTC' || normNet === 'LTC'
        ? /^[0-9a-fA-F]{64}$/.test(txHash)
        : /^0x[0-9a-fA-F]{64}$/.test(txHash);
      if (!validTxHash) {
        console.error('[Deposit Ingestion] Skipping pending deposit with malformed transaction hash');
        continue;
      }
      const destinationAddress = dep.to_address || dep.address;
      const rawOutputIndex = dep.output_index ?? dep.log_index;
      if (typeof destinationAddress !== 'string' || destinationAddress.trim() === '' ||
          !Number.isSafeInteger(rawOutputIndex) || rawOutputIndex < 0) {
        console.error('[Deposit Ingestion] Skipping pending deposit with invalid destination or output index');
        continue;
      }
      const outputIndex = rawOutputIndex;
      const assetSymbol = (dep.asset_symbol || 'USDT').toUpperCase().trim();
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

      if (normNet === 'TRC20') {
        // Do not credit pending TRC20 rows from transaction receipt metadata alone.
        // This recovery path must verify the canonical USDT Transfer event, exact
        // destination, raw amount and event index before calling the credit RPC.
        console.error('[Deposit Ingestion] Pending TRC20 recheck requires Transfer-event verification; deposit remains pending');
        continue;
      } else if (normNet === 'BTC') {
        if (assetSymbol !== 'BTC') {
          console.error('[Deposit Ingestion] Pending BTC row has a mismatched or missing asset symbol; deposit remains pending');
          continue;
        }
        const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
        try {
          const [txResponse, statusResponse, tipResponse] = await Promise.all([
            fetch(`${btcApiBase}/tx/${dep.tx_hash}`),
            fetch(`${btcApiBase}/tx/${dep.tx_hash}/status`),
            fetch(`${btcApiBase}/blocks/tip/height`),
          ]);
          if (txResponse.ok && statusResponse.ok && tipResponse.ok) {
            const tx = await txResponse.json();
            const statusData = await statusResponse.json();
            const tipHeight = Number((await tipResponse.text()).trim());
            if (typeof tx?.txid !== 'string' || tx.txid.toLowerCase() !== String(dep.tx_hash).toLowerCase()) {
              console.error('[Deposit Ingestion] Pending BTC/LTC provider returned a mismatched transaction id; deposit remains pending');
              continue;
            }
            const output = Array.isArray(tx.vout) ? tx.vout[outputIndex] : null;
            // Pending rechecks only advance mined transactions with a valid
            // confirmed block at or below the provider's current chain tip.
            if (!statusData?.confirmed || !Number.isSafeInteger(statusData.block_height) ||
                statusData.block_height <= 0 || !Number.isSafeInteger(tipHeight) ||
                tipHeight < statusData.block_height) {
              continue;
            }
            const storedBaseUnits = parseBaseUnits8(dep.amount);
            const observedBaseUnits = Number.isSafeInteger(output?.value) && output.value >= 0
              ? BigInt(output.value)
              : null;
            if (!output || output.scriptpubkey_address !== destinationAddress ||
                storedBaseUnits === null || storedBaseUnits <= 0n ||
                observedBaseUnits === null || observedBaseUnits !== storedBaseUnits ||
                !Number.isSafeInteger(tipHeight) || tipHeight < 0) {
              continue;
            }
            const confs = tipHeight - statusData.block_height + 1;
            if (confs < 3) {
              console.info('[Deposit Ingestion] Pending BTC deposit has not reached the required 3 confirmations; it remains pending');
              continue;
            }
            const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: destinationAddress,
              p_asset_symbol: 'BTC',
              p_network_code: 'BTC',
              p_amount: dep.amount,
              p_tx_hash: dep.tx_hash,
              p_output_index: outputIndex,
              p_block_number: statusData.block_height || null,
              p_from_address: null,
              p_token_contract: null,
              p_confirmations: confs,
              p_provider: 'confirmations_worker',
            });
            if (rpcErr) {
              console.error('[Deposit Ingestion] Pending BTC deposit credit RPC failed; row remains pending:', rpcErr.message);
            } else {
              let r: any;
              try {
                r = typeof data === 'string' ? JSON.parse(data) : data;
              } catch {
                console.error('[Deposit Ingestion] Invalid pending BTC credit RPC result; row remains pending');
                continue;
              }
              if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.status !== 'string') {
                console.error('[Deposit Ingestion] Malformed pending BTC credit RPC result; row remains pending');
                continue;
              }
              if (r.status === 'credited') newlyCredited++;
            }
          } else {
            console.error('[Deposit Ingestion] Pending BTC provider returned a non-success HTTP status; deposit remains pending', {
              txStatus: txResponse.status, statusStatus: statusResponse.status, tipStatus: tipResponse.status,
            });
          }
        } catch (err) {
          console.error('[Deposit Ingestion] Pending BTC/LTC verification failed; deposit left pending:', err instanceof Error ? err.message : 'unknown provider error');
        }
      } else if (normNet === 'LTC') {
        if (assetSymbol !== 'LTC') {
          console.error('[Deposit Ingestion] Pending LTC row has a mismatched or missing asset symbol; deposit remains pending');
          continue;
        }
        const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
        try {
          const [txResponse, statusResponse, tipResponse] = await Promise.all([
            fetch(`${ltcApiBase}/tx/${dep.tx_hash}`),
            fetch(`${ltcApiBase}/tx/${dep.tx_hash}/status`),
            fetch(`${ltcApiBase}/blocks/tip/height`),
          ]);
          if (txResponse.ok && statusResponse.ok && tipResponse.ok) {
            const tx = await txResponse.json();
            const statusData = await statusResponse.json();
            const tipHeight = Number((await tipResponse.text()).trim());
            if (typeof tx?.txid !== 'string' || tx.txid.toLowerCase() !== String(dep.tx_hash).toLowerCase()) {
              console.error('[Deposit Ingestion] Pending BTC/LTC provider returned a mismatched transaction id; deposit remains pending');
              continue;
            }
            const output = Array.isArray(tx.vout) ? tx.vout[outputIndex] : null;
            // Pending rechecks only advance mined transactions with a valid
            // confirmed block at or below the provider's current chain tip.
            if (!statusData?.confirmed || !Number.isSafeInteger(statusData.block_height) ||
                statusData.block_height <= 0 || !Number.isSafeInteger(tipHeight) ||
                tipHeight < statusData.block_height) {
              continue;
            }
            const storedBaseUnits = parseBaseUnits8(dep.amount);
            const observedBaseUnits = Number.isSafeInteger(output?.value) && output.value >= 0
              ? BigInt(output.value)
              : null;
            if (!output || output.scriptpubkey_address !== destinationAddress ||
                storedBaseUnits === null || storedBaseUnits <= 0n ||
                observedBaseUnits === null || observedBaseUnits !== storedBaseUnits ||
                !Number.isSafeInteger(tipHeight) || tipHeight < 0) {
              continue;
            }
            const confs = tipHeight - statusData.block_height + 1;
            if (confs < 12) {
              console.info('[Deposit Ingestion] Pending LTC deposit has not reached the required 12 confirmations; it remains pending');
              continue;
            }
            const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: destinationAddress,
              p_asset_symbol: 'LTC',
              p_network_code: 'LTC',
              p_amount: dep.amount,
              p_tx_hash: dep.tx_hash,
              p_output_index: outputIndex,
              p_block_number: statusData.block_height || null,
              p_from_address: null,
              p_token_contract: null,
              p_confirmations: confs,
              p_provider: 'confirmations_worker',
            });
            if (rpcErr) {
              console.error('[Deposit Ingestion] Pending LTC deposit credit RPC failed; row remains pending:', rpcErr.message);
            } else {
              let r: any;
              try {
                r = typeof data === 'string' ? JSON.parse(data) : data;
              } catch {
                console.error('[Deposit Ingestion] Invalid pending LTC credit RPC result; row remains pending');
                continue;
              }
              if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.status !== 'string') {
                console.error('[Deposit Ingestion] Malformed pending LTC credit RPC result; row remains pending');
                continue;
              }
              if (r.status === 'credited') newlyCredited++;
            }
          } else {
            console.error('[Deposit Ingestion] Pending LTC provider returned a non-success HTTP status; deposit remains pending', {
              txStatus: txResponse.status, statusStatus: statusResponse.status, tipStatus: tipResponse.status,
            });
          }
        } catch (err) {
          console.error('[Deposit Ingestion] Pending BTC/LTC verification failed; deposit left pending:', err instanceof Error ? err.message : 'unknown provider error');
        }
      } else {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        if (chain) {
          const provider = getEvmProvider(normNet);
          const receipt = await provider.getTransactionReceipt(dep.tx_hash);
          const evmTransaction = await provider.getTransaction(dep.tx_hash);
          if (!evmTransaction) {
            console.error('[Deposit Ingestion] Pending EVM transaction is unavailable from provider; deposit remains pending');
            continue;
          }
          if (evmTransaction && (!evmTransaction.hash || evmTransaction.hash.toLowerCase() !== String(dep.tx_hash).toLowerCase())) {
            console.error('[Deposit Ingestion] Pending EVM provider returned a mismatched transaction; deposit remains pending');
            continue;
          }
          if (receipt && evmTransaction && receipt.blockNumber !== null &&
              evmTransaction.blockNumber !== null && receipt.blockNumber !== evmTransaction.blockNumber) {
            console.error('[Deposit Ingestion] Pending EVM receipt/transaction block mismatch; deposit remains pending');
            continue;
          }
          if (receipt && (!receipt.hash || receipt.hash.toLowerCase() !== String(dep.tx_hash).toLowerCase())) {
            console.error('[Deposit Ingestion] Pending EVM provider returned a mismatched receipt transaction hash; deposit remains pending');
            continue;
          }
          // A mined receipt is not proof of a successful transaction. Never
          // advance a pending deposit from a reverted EVM transaction.
          if (receipt && receipt.status === 1 && receipt.blockNumber) {
            if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 ||
                typeof receipt.blockHash !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)) {
              console.error('[Deposit Ingestion] Pending EVM receipt has an invalid mined block identity; deposit remains pending');
              continue;
            }
            let canonicalBlock;
            try {
              canonicalBlock = await provider.getBlock(receipt.blockNumber);
            } catch {
              console.error('[Deposit Ingestion] Could not revalidate the canonical EVM block for a pending deposit; deposit remains pending');
              continue;
            }
            if (typeof canonicalBlock?.hash !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(canonicalBlock.hash) ||
                canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
              console.error('[Deposit Ingestion] Pending EVM receipt block is not canonical at recheck time; deposit remains pending');
              continue;
            }
            if (evmTransaction.blockNumber === null || evmTransaction.blockNumber !== receipt.blockNumber) {
              console.error('[Deposit Ingestion] Pending EVM transaction is not mined in the receipt block; deposit remains pending');
              continue;
            }
          // ERC-20 pending rows must match the canonical contract, exact receipt
          // log index, recipient and raw token amount before privileged credit.
          if (assetSymbol === 'USDT') {
            const canonicalContract = CANONICAL_USDT_CONTRACTS[normNet];
            const tokenDecimals = chain.usdtDecimals;
            const erc20Interface = new ethers.Interface(ERC20_ABI);
            const transferTopic = erc20Interface.getEvent('Transfer')?.topicHash;
            if (!canonicalContract || !Number.isSafeInteger(tokenDecimals) ||
                tokenDecimals < 0 || tokenDecimals > 36 || !transferTopic ||
                typeof dep.amount !== 'string' && typeof dep.amount !== 'number') {
              console.error('[Deposit Ingestion] Pending EVM USDT verification configuration or amount is invalid; deposit remains pending');
              continue;
            }
            if (!Array.isArray(receipt.logs) ||
                typeof receipt.blockHash !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)) {
              console.error('[Deposit Ingestion] Pending EVM USDT receipt has malformed logs or block hash; deposit remains pending');
              continue;
            }
            const matchingLogs = receipt.logs.filter((log) => log.index === outputIndex);
            if (matchingLogs.length !== 1) {
              console.error('[Deposit Ingestion] Pending EVM USDT receipt does not contain exactly one log at the stored index; deposit remains pending');
              continue;
            }
            const transferLog = matchingLogs[0];
            if (!transferLog ||
                typeof transferLog.address !== 'string' ||
                !/^0x[0-9a-fA-F]{40}$/.test(transferLog.address) ||
                typeof transferLog.transactionHash !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(transferLog.transactionHash) ||
                typeof transferLog.blockHash !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(transferLog.blockHash) ||
                !Number.isSafeInteger(transferLog.index) ||
                transferLog.index < 0 ||
                !Array.isArray(transferLog.topics) ||
                transferLog.topics.length !== 3 ||
                !transferLog.topics.every((topic) => typeof topic === 'string' && /^0x[0-9a-fA-F]{64}$/.test(topic)) ||
                typeof transferLog.data !== 'string' ||
                !/^0x[0-9a-fA-F]{64}$/.test(transferLog.data) ||
                transferLog.address.toLowerCase() !== canonicalContract.toLowerCase() ||
                transferLog.transactionHash.toLowerCase() !== String(dep.tx_hash).toLowerCase() ||
                transferLog.blockNumber !== receipt.blockNumber ||
                transferLog.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
                transferLog.topics[0].toLowerCase() !== transferTopic.toLowerCase()) {
              console.error('[Deposit Ingestion] Pending EVM USDT receipt log identity or contract mismatch; deposit remains pending');
              continue;
            }
            try {
              const parsedTransfer = erc20Interface.parseLog({
                topics: transferLog.topics as string[],
                data: transferLog.data,
              });
              const amountText = String(dep.amount);
              if (!parsedTransfer || parsedTransfer.name !== 'Transfer' ||
                  (parsedTransfer.args[1] as string).toLowerCase() !== destinationAddress.toLowerCase() ||
                  !/^(0|[1-9]\d*)(?:\.\d{1,36})?$/.test(amountText) ||
                  ethers.parseUnits(amountText, tokenDecimals) <= 0n ||
                  ethers.parseUnits(amountText, tokenDecimals) !== parsedTransfer.args[2]) {
                console.error('[Deposit Ingestion] Pending EVM USDT recipient or raw amount mismatch; deposit remains pending');
                continue;
              }
            } catch {
              console.error('[Deposit Ingestion] Pending EVM USDT Transfer log could not be decoded safely; deposit remains pending');
              continue;
            }
          }
          // Native-asset rows must use the chain's configured native symbol and
          // match the actual transaction recipient and exact wei value. ERC-20
          // rows were verified against their receipt Transfer log above.
          if (assetSymbol !== 'USDT') {
            if (assetSymbol !== chain.nativeSymbol) {
              console.error('[Deposit Ingestion] Pending EVM asset is neither canonical USDT nor the chain native asset; deposit remains pending');
              continue;
            }
            if (!evmTransaction.to ||
                !/^0x[0-9a-fA-F]{40}$/.test(destinationAddress) ||
                evmTransaction.to.toLowerCase() !== destinationAddress.toLowerCase() ||
                typeof dep.amount !== 'string' && typeof dep.amount !== 'number') {
              console.error('[Deposit Ingestion] Pending EVM native transfer recipient or amount is invalid; deposit remains pending');
              continue;
            }
            try {
              const amountText = String(dep.amount);
              if (!/^(0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amountText) ||
                  ethers.parseUnits(amountText, 18) <= 0n ||
                  ethers.parseUnits(amountText, 18) !== evmTransaction.value) {
                console.error('[Deposit Ingestion] Pending EVM native transfer value does not match stored amount; deposit remains pending');
                continue;
              }
            } catch {
              console.error('[Deposit Ingestion] Pending EVM native amount is malformed; deposit remains pending');
              continue;
            }
          }
          const currentBlock = await provider.getBlockNumber();
            if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 ||
                !Number.isSafeInteger(currentBlock) || currentBlock < receipt.blockNumber) {
              continue;
            }
            const confs = currentBlock - receipt.blockNumber + 1;
            if (!Number.isSafeInteger(chain.requiredConfirmations) ||
                chain.requiredConfirmations < 1 ||
                confs < chain.requiredConfirmations) {
              console.info('[Deposit Ingestion] Pending EVM deposit has not reached the configured confirmation threshold; it remains pending');
              continue;
            }

            const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: destinationAddress,
              p_asset_symbol: assetSymbol,
              // The atomic RPC models native ETH as network ETH, while ERC20
              // is reserved for USDT token deposits. Keep pending ETH recovery
              // consistent with the primary native-deposit scanner.
              p_network_code: assetSymbol === 'ETH' && normNet === 'ERC20' ? 'ETH' : normNet,
              p_amount: dep.amount,
              p_tx_hash: dep.tx_hash,
              p_output_index: outputIndex,
              p_block_number: receipt.blockNumber,
              p_from_address: receipt.from?.toLowerCase() || dep.from_address || null,
              // Native ETH must not be sent with the ERC-20 USDT contract.
              p_token_contract: assetSymbol === 'USDT' ? tokenContract : null,
              p_confirmations: confs,
              p_provider: 'confirmations_worker',
            });

            if (rpcErr) {
              console.error('[Deposit Ingestion] Pending EVM deposit credit RPC failed; row remains pending:', rpcErr.message);
            } else {
              let res: any;
              try {
                res = typeof data === 'string' ? JSON.parse(data) : data;
              } catch {
                console.error('[Deposit Ingestion] Invalid pending EVM credit RPC result; row remains pending');
                continue;
              }
              if (!res || typeof res !== 'object' || Array.isArray(res) || typeof res.status !== 'string') {
                console.error('[Deposit Ingestion] Malformed pending EVM credit RPC result; row remains pending');
                continue;
              }
              if (res.status === 'credited') {
                newlyCredited++;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Deposit Ingestion] Error refreshing pending confirmations:', err);
  }

  return { checked, newlyCredited };
}

/**
 * Main deposit ingestion cycle execution
 */
async function runDepositIngestionCycle(): Promise<{
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
      // Scan at most 100 blocks, counting both endpoints. The scanners
      // clamp this range to the provider tip and enforce their own range guards.
      const scanWindow = 100;
      const fromBlock = Math.max(0, latestBlock - scanWindow + 1);

      netResult.scannedBlocks = latestBlock - fromBlock + 1;

      if (evmAddresses.size > 0) {
        // Scan ERC20 / BEP20 USDT
        const tokenRes = await scanEvmTokenDeposits(netKey, evmAddresses, fromBlock, latestBlock);
        netResult.depositsDetected += tokenRes.detected;
        netResult.depositsCredited += tokenRes.credited;
        netResult.errors.push(...tokenRes.errors);

        // Scan Native transfers (ETH)
        const nativeRes = await scanEvmNativeDeposits(netKey, evmAddresses, fromBlock, latestBlock);
        netResult.depositsDetected += nativeRes.detected;
        netResult.depositsCredited += nativeRes.credited;
        netResult.errors.push(...nativeRes.errors);
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

  // 5. Recheck previously PENDING deposits
  const pendingRecheck = await refreshPendingDepositConfirmations();

  return { results, pendingRecheck };
}

/**
 * Coalesce overlapping worker invocations into one in-flight cycle.
 * The 30-second timer must not launch concurrent scans when a provider or RPC
 * is slow; all callers await the same cycle result.
 */
let ingestionCyclePromise: ReturnType<typeof runDepositIngestionCycle> | null = null;

export function runDepositIngestion(): ReturnType<typeof runDepositIngestionCycle> {
  if (ingestionCyclePromise) return ingestionCyclePromise;

  const cycle = runDepositIngestionCycle();
  ingestionCyclePromise = cycle;
  void cycle.finally(() => {
    if (ingestionCyclePromise === cycle) ingestionCyclePromise = null;
  }).catch(() => {
    // The original promise remains responsible for surfacing cycle failures.
  });
  return cycle;
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
