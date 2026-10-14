import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import {
  SUPPORTED_EVM_CHAINS,
  getEvmProvider,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import { TRON_CONFIG, getTronWeb, isValidTronAddress } from '@/lib/blockchain/tron';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';

// Privileged deposit ingestion must fail closed: never fall back to the public anon key.
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
    'SUPABASE_SERVICE_ROLE_KEY is required for privileged deposit ingestion but is missing or not configured.'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const CANONICAL_USDT_CONTRACTS: Record<string, string> = {
  ERC20: process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  BEP20: process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955',
  TRC20: process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
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

/** Fetches the current UTXO-chain tip height; null means confirmation counts are untrusted. */
async function fetchUtxoTipHeight(apiBase: string): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/blocks/tip/height`);
    if (!res.ok) return null;
    const raw = (await res.text()).trim();
    if (!/^\d+$/.test(raw)) return null;
    const height = Number(raw);
    return Number.isSafeInteger(height) && height >= 0 ? height : null;
  } catch {
    return null;
  }
}

/** Independently verifies a stored BTC/LTC deposit against the exact transaction output. */
export async function verifyUtxoDepositOutput(
  apiBase: string,
  txHash: string,
  outputIndex: number,
  destinationAddress: string,
  storedAmount: number | string
): Promise<{ blockHeight: number | null; blockHash: string | null; confirmations: number } | null> {
  const amountString = typeof storedAmount === 'string' ? storedAmount.trim() : String(storedAmount);
  if (!/^[a-fA-F0-9]{64}$/.test(txHash) ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0 ||
      !/^\d+(?:\.\d+)?$/.test(amountString) ||
      (typeof storedAmount === 'number' && !Number.isFinite(storedAmount)) ||
      !destinationAddress) return null;

  try {
    const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    const [txRes, statusRes] = await Promise.all([
      fetch(`${base}/tx/${txHash}`),
      fetch(`${base}/tx/${txHash}/status`),
    ]);
    if (!txRes.ok || !statusRes.ok) return null;
    const [tx, status] = await Promise.all([txRes.json(), statusRes.json()]);
    if (typeof tx?.txid !== 'string' || tx.txid.toLowerCase() !== txHash.toLowerCase() ||
        !Array.isArray(tx.vout) || outputIndex >= tx.vout.length) return null;

    const output = tx.vout[outputIndex];
    if (output?.scriptpubkey_address !== destinationAddress ||
        !Number.isSafeInteger(output.value) || output.value <= 0) return null;
    let expectedSatoshis: bigint;
    try {
      expectedSatoshis = ethers.parseUnits(amountString, 8);
    } catch {
      return null;
    }
    if (expectedSatoshis <= 0n || expectedSatoshis !== BigInt(output.value)) return null;

    if (status?.confirmed !== true) return { blockHeight: null, blockHash: null, confirmations: 0 };
    const blockHeight = status.block_height;
    const reportedHash = status.block_hash;
    if (!Number.isSafeInteger(blockHeight) || blockHeight <= 0 ||
        typeof reportedHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(reportedHash)) return null;

    const [tipHeight, canonicalHashRes] = await Promise.all([
      fetchUtxoTipHeight(base),
      fetch(`${base}/block-height/${blockHeight}`),
    ]);
    if (tipHeight === null || tipHeight < blockHeight || !canonicalHashRes.ok) return null;
    const canonicalHash = (await canonicalHashRes.text()).trim();
    if (!/^[a-fA-F0-9]{64}$/.test(canonicalHash) ||
        canonicalHash.toLowerCase() !== reportedHash.toLowerCase()) return null;

    const txidsRes = await fetch(`${base}/block/${canonicalHash}/txids`);
    if (!txidsRes.ok) return null;
    const canonicalTxids = await txidsRes.json();
    if (!Array.isArray(canonicalTxids) ||
        !canonicalTxids.some((id) => typeof id === 'string' && id.toLowerCase() === txHash.toLowerCase())) return null;

    return { blockHeight, blockHash: canonicalHash.toLowerCase(), confirmations: tipHeight - blockHeight + 1 };
  } catch {
    return null;
  }
}

/**
 * Independently verifies a pending native EVM deposit against the transaction
 * and successful receipt. Database-stored destination/amount are never proof.
 */
export async function verifyEvmNativeDeposit(
  provider: ReturnType<typeof getEvmProvider>,
  txHash: string,
  destinationAddress: string,
  storedAmount: number | string,
  decimals: number
): Promise<{ blockNumber: number; blockHash: string; confirmations: number; fromAddress: string } | null> {
  const amountString = typeof storedAmount === 'string' ? storedAmount.trim() : String(storedAmount);
  if (!/^0x[0-9a-f]{64}$/i.test(txHash) ||
      !ethers.isAddress(destinationAddress) ||
      !/^\d+(?:\.\d+)?$/.test(amountString) ||
      (typeof storedAmount === 'number' && !Number.isFinite(storedAmount)) ||
      !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;

  try {
    const [tx, receipt, currentBlock] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);
    if (!tx || tx.hash.toLowerCase() !== txHash.toLowerCase() ||
        !tx.to || tx.to.toLowerCase() !== destinationAddress.toLowerCase() ||
        tx.value <= 0n || !receipt ||
        receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
        receipt.status !== 1 || receipt.blockNumber == null ||
        currentBlock < receipt.blockNumber) return null;

    let expectedValue: bigint;
    try {
      expectedValue = ethers.parseUnits(amountString, decimals);
    } catch {
      return null;
    }
    if (expectedValue <= 0n || tx.value !== expectedValue) return null;

    const canonicalBlock = await provider.getBlock(receipt.blockNumber);
    if (!canonicalBlock?.hash || !receipt.blockHash ||
        canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return null;

    return {
      blockNumber: receipt.blockNumber,
      blockHash: canonicalBlock.hash.toLowerCase(),
      confirmations: currentBlock - receipt.blockNumber + 1,
      fromAddress: tx.from.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Independently verifies the exact ERC-20 Transfer log before a stored token
 * deposit is allowed to reach the crediting RPC.
 */
export async function verifyEvmTokenDeposit(
  provider: ReturnType<typeof getEvmProvider>,
  txHash: string,
  logIndex: number,
  destinationAddress: string,
  storedAmount: number | string,
  tokenContract: string,
  decimals: number
): Promise<{ blockNumber: number; blockHash: string; confirmations: number; fromAddress: string } | null> {
  const amountString = typeof storedAmount === 'string' ? storedAmount.trim() : String(storedAmount);
  if (!/^0x[0-9a-f]{64}$/i.test(txHash) ||
      !Number.isSafeInteger(logIndex) || logIndex < 0 ||
      !ethers.isAddress(destinationAddress) || !ethers.isAddress(tokenContract) ||
      !/^\d+(?:\.\d+)?$/.test(amountString) ||
      (typeof storedAmount === 'number' && !Number.isFinite(storedAmount)) ||
      !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;

  try {
    const [receipt, currentBlock] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);
    if (!receipt || receipt.status !== 1 || receipt.blockNumber == null ||
        currentBlock < receipt.blockNumber) return null;

    const transferInterface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ]);
    const transferTopic = transferInterface.getEvent('Transfer')?.topicHash.toLowerCase();
    const log = receipt.logs.find((candidate) => candidate.index === logIndex);
    if (!log || log.address.toLowerCase() !== tokenContract.toLowerCase() ||
        !log.topics[0] || log.topics[0].toLowerCase() !== transferTopic) return null;

    const parsed = transferInterface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed || parsed.name !== 'Transfer') return null;
    const fromAddress = String(parsed.args[0]).toLowerCase();
    const toAddress = String(parsed.args[1]).toLowerCase();
    const rawValue = parsed.args[2] as bigint;
    if (toAddress !== destinationAddress.toLowerCase() || rawValue <= 0n) return null;

    let expectedValue: bigint;
    try {
      expectedValue = ethers.parseUnits(amountString, decimals);
    } catch {
      return null;
    }
    if (expectedValue !== rawValue) return null;

    const canonicalBlock = await provider.getBlock(receipt.blockNumber);
    if (!canonicalBlock?.hash || !receipt.blockHash ||
        canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return null;

    return {
      blockNumber: receipt.blockNumber,
      blockHash: canonicalBlock.hash.toLowerCase(),
      confirmations: currentBlock - receipt.blockNumber + 1,
      fromAddress,
    };
  } catch {
    return null;
  }
}

/**
 * Independently verifies the exact TRC-20 USDT event before a pending deposit
 * can reach the atomic credit RPC. Provider or database metadata alone is not proof.
 */
export async function verifyTronTokenDeposit(
  txHash: string,
  eventIndex: number,
  destinationAddress: string,
  storedAmount: number | string
): Promise<{ blockNumber: number; blockHash: string; confirmations: number; fromAddress: string } | null> {
  const amountString = typeof storedAmount === 'string' ? storedAmount.trim() : String(storedAmount);
  if (!/^[0-9a-f]{64}$/i.test(txHash) ||
      !Number.isSafeInteger(eventIndex) || eventIndex < 0 ||
      !isValidTronAddress(destinationAddress) ||
      !/^\d+(?:\.\d+)?$/.test(amountString) ||
      (typeof storedAmount === 'number' && !Number.isFinite(storedAmount))) return null;

  try {
    const tronWeb = getTronWeb(false);
    const rpcUrl = (process.env.TRON_RPC_URL || TRON_CONFIG.fullHost || 'https://api.trongrid.io').replace(/\/$/, '');
    const contractAddress = process.env.USDT_CONTRACT_TRC20 || TRON_CONFIG.usdtContract || CANONICAL_USDT_CONTRACTS.TRC20;
    const normalizeAddress = (address: string): string | null => {
      try {
        return tronWeb.address.toHex(address).toLowerCase().replace(/^0x/, '');
      } catch {
        return null;
      }
    };
    const expectedContract = normalizeAddress(contractAddress);
    const expectedDestination = normalizeAddress(destinationAddress);
    if (!expectedContract || !expectedDestination) return null;

    const eventHost = (process.env.TRONGRID_API_URL || process.env.TRON_EVENT_SERVER ||
      (rpcUrl.toLowerCase().includes('api.trongrid.io') ? rpcUrl : 'https://api.trongrid.io')).replace(/\/$/, '');
    const headers: Record<string, string> = { Accept: 'application/json' };
    const apiKey = process.env.TRON_GRID_API_KEY || process.env.TRONGRID_API_KEY || TRON_CONFIG.apiKey;
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const [txInfo, currentBlock] = await Promise.all([
      tronWeb.trx.getTransactionInfo(txHash),
      tronWeb.trx.getCurrentBlock(),
    ]);
    if (!txInfo || String(txInfo.id || '').toLowerCase() !== txHash.toLowerCase() ||
        String(txInfo.receipt?.result || '').toUpperCase() !== 'SUCCESS' ||
        !Number.isSafeInteger(txInfo.blockNumber) || txInfo.blockNumber <= 0) return null;

    const currentHeight = currentBlock?.block_header?.raw_data?.number;
    if (!Number.isSafeInteger(currentHeight) || currentHeight < txInfo.blockNumber) return null;

    // Re-fetch the transaction's height from the node and verify the canonical
    // block actually contains this transaction before trusting its block ID.
    const canonicalBlock = await tronWeb.trx.getBlock(txInfo.blockNumber);
    const canonicalHeight = canonicalBlock?.block_header?.raw_data?.number;
    const canonicalBlockHash = String(canonicalBlock?.blockID || '').toLowerCase();
    const blockTransactions = Array.isArray(canonicalBlock?.transactions) ? canonicalBlock.transactions : [];
    const transactionInCanonicalBlock = blockTransactions.some((item: any) =>
      String(item.txID || '').toLowerCase() === txHash.toLowerCase()
    );
    if (!Number.isSafeInteger(canonicalHeight) || canonicalHeight !== txInfo.blockNumber ||
        !/^[0-9a-f]{64}$/.test(canonicalBlockHash) || !transactionInCanonicalBlock) return null;

    // Follow TronGrid's fingerprint cursor when a transaction exposes more
    // than one page of events. Never interpret malformed or truncated event data
    // as proof that the requested transfer does not exist.
    const events: any[] = [];
    let fingerprint: string | null = null;
    let pageCount = 0;
    do {
      const baseUrl = `${eventHost}/v1/transactions/${txHash}/events?limit=200`;
      const pageUrl = fingerprint
        ? `${baseUrl}&fingerprint=${encodeURIComponent(fingerprint)}`
        : baseUrl;
      const eventsResponse = await fetch(pageUrl, { headers });
      if (!eventsResponse.ok) return null;
      const eventsPayload = await eventsResponse.json();
      if (!Array.isArray(eventsPayload?.data)) return null;
      events.push(...eventsPayload.data);
      fingerprint = typeof eventsPayload?.meta?.fingerprint === 'string' && eventsPayload.meta.fingerprint.length > 0
        ? eventsPayload.meta.fingerprint
        : null;
      pageCount++;
    } while (fingerprint && pageCount < 10);
    if (fingerprint) return null;

    const event = events.find((item: any) =>
      Number(item.event_index) === eventIndex &&
      String(item.transaction_id || '').toLowerCase() === txHash.toLowerCase()
    );
    if (!event || String(event.event_name || '') !== 'Transfer') return null;
    const eventContract = normalizeAddress(String(event.contract_address || ''));
    if (!eventContract || eventContract !== expectedContract) return null;

    const result = event.result || {};
    const eventDestination = normalizeAddress(String(result.to || ''));
    if (!eventDestination || eventDestination !== expectedDestination) return null;

    let rawValue: bigint;
    try {
      rawValue = BigInt(String(result.value));
    } catch {
      return null;
    }
    if (rawValue <= 0n) return null;

    let expectedValue: bigint;
    try {
      expectedValue = ethers.parseUnits(amountString, 6);
    } catch {
      return null;
    }
    if (rawValue !== expectedValue) return null;

    const fromAddress = normalizeAddress(String(result.from || ''));
    if (!fromAddress) return null;
    let fromBase58: string;
    try {
      fromBase58 = tronWeb.address.fromHex(fromAddress);
    } catch {
      return null;
    }

    return {
      blockNumber: txInfo.blockNumber,
      blockHash: canonicalBlockHash,
      confirmations: currentHeight - txInfo.blockNumber + 1,
      fromAddress: fromBase58,
    };
  } catch {
    return null;
  }
}

export interface IngestionResult {
  network: string;
  scannedBlocks?: number;
  depositsDetected: number;
  depositsCredited: number;
  errors: string[];
}

// Supabase projects commonly cap a single REST response at 1,000 rows.
// Page through every address source so large customer bases do not silently lose
// monitored addresses beyond the first response page.
const MONITORED_ADDRESS_PAGE_SIZE = 1000;

async function fetchAllAddressRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += MONITORED_ADDRESS_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + MONITORED_ADDRESS_PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to load monitored deposit addresses (offset ${from}): ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < MONITORED_ADDRESS_PAGE_SIZE) return rows;
  }
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
    const primaryAddresses = await fetchAllAddressRows((from, to) =>
      supabaseAdmin
        .from('deposit_addresses')
        .select('address, network_code, asset_code')
        .order('address', { ascending: true })
        .range(from, to)
    );

    {
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
    const fallbackAddresses = await fetchAllAddressRows((from, to) =>
      supabaseAdmin
        .from('user_deposit_addresses')
        .select('address, network, coin')
        .order('address', { ascending: true })
        .range(from, to)
    );

    {
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
    const userWallets = await fetchAllAddressRows((from, to) =>
      supabaseAdmin
        .from('wallets')
        .select('address, chain, currency')
        .order('address', { ascending: true })
        .range(from, to)
    );

    {
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
    console.error('[Deposit Ingestion] Error querying monitored deposit addresses:', err);
    // Propagate the failure so the scheduled cycle is reported as failed rather
    // than scanning with an incomplete or empty address set.
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

    // Query bounded log ranges. Some EVM RPC providers reject broad getLogs
    // requests; each chunk is fetched independently, and any failed chunk aborts
    // this scan rather than silently treating missing logs as an empty result.
    const logChunkSize = 25;
    const logs: Awaited<ReturnType<typeof provider.getLogs>> = [];
    for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += logChunkSize) {
      const chunkTo = Math.min(toBlock, chunkFrom + logChunkSize - 1);
      const chunkLogs = await provider.getLogs({
        fromBlock: chunkFrom,
        toBlock: chunkTo,
        address: tokenContractAddress,
        topics: [transferTopic],
      });
      logs.push(...chunkLogs);
    }

    const latestBlock = await provider.getBlockNumber();

    for (const log of logs) {
      try {
        const parsed = erc20Interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed || parsed.name !== 'Transfer') continue;
        // Do not trust provider filtering alone: bind the log to the configured contract.
        if (log.address.toLowerCase() !== tokenContractAddress.toLowerCase()) continue;

        const fromAddress = (parsed.args[0] as string).toLowerCase();
        const toAddress = (parsed.args[1] as string).toLowerCase();
        if (!monitoredEvmAddresses.has(toAddress)) {
          continue; // Not a platform deposit address
        }

        const rawValue = parsed.args[2] as bigint;
        // Keep the exact decimal string: converting token units to Number can
        // round large balances and make the credited amount differ from the chain.
        const formattedAmount = ethers.formatUnits(rawValue, tokenDecimals);
        if (rawValue <= 0n) continue;

        const verified = await verifyEvmTokenDeposit(
          provider,
          log.transactionHash,
          log.index,
          toAddress,
          formattedAmount,
          tokenContractAddress,
          tokenDecimals
        );
        if (!verified) {
          errors.push(`Skipped EVM log ${log.transactionHash} index ${log.index}: canonical receipt verification failed`);
          continue;
        }
        detected++;
        const confirmations = verified.confirmations;

        // Pass only independently verified canonical block metadata to the atomic RPC.
        const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: toAddress,
          p_asset_symbol: 'USDT',
          p_network_code: normNet,
          p_amount: formattedAmount,
          p_tx_hash: log.transactionHash,
          p_output_index: log.index,
          p_block_number: verified.blockNumber,
          p_from_address: verified.fromAddress,
          p_token_contract: tokenContractAddress,
          p_confirmations: confirmations,
          p_provider: 'deposit_ingestion',
          p_block_hash: verified.blockHash,
        });

        if (error) {
          errors.push(`RPC error on tx ${log.transactionHash}: ${error.message}`);
        } else {
          const res = typeof data === 'string' ? JSON.parse(data) : data;
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
                if (typeof txHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(txHash)) continue;

                // Treat the asset-transfer API as discovery only. Verify transaction,
                // successful receipt, destination, amount and block via the chain RPC.
                const [chainTx, receipt] = await Promise.all([
                  provider.getTransaction(txHash),
                  provider.getTransactionReceipt(txHash),
                ]);
                if (!chainTx || !receipt || receipt.status !== 1 || receipt.blockNumber == null) continue;
                if (!chainTx.to || chainTx.to.toLowerCase() !== address.toLowerCase()) continue;
                if (chainTx.value <= BigInt(0)) continue;

                const txBlock = receipt.blockNumber;
                if (tx.blockNum && Number.parseInt(tx.blockNum, 16) !== txBlock) continue;
                // Keep native coin amounts as exact decimal strings to avoid IEEE-754 rounding.
                const formattedValue = ethers.formatUnits(chainTx.value, chainConfig.nativeDecimals);
                if (chainTx.value <= 0n) continue;
                const assetSymbol = chainConfig.nativeSymbol.toUpperCase();
                const verified = await verifyEvmNativeDeposit(
                  provider, txHash, address, formattedValue, chainConfig.nativeDecimals
                );
                if (!verified) continue;
                const confirmations = verified.confirmations;

                detected++;
                const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
                  p_destination_address: address.toLowerCase(),
                  p_asset_symbol: assetSymbol === 'ETH' ? 'ETH' : assetSymbol,
                  p_network_code: normNet === 'ERC20' ? 'ETH' : normNet,
                  p_amount: formattedValue,
                  p_tx_hash: txHash,
                  p_output_index: 0,
                  p_block_number: verified.blockNumber,
                  p_from_address: verified.fromAddress,
                  p_token_contract: null,
                  p_confirmations: confirmations,
                  p_provider: 'deposit_ingestion',
                  p_block_hash: verified.blockHash,
                });

                if (error) {
                  errors.push(`RPC error in native discovery for tx ${txHash}: ${error.message}`);
                } else {
                  const res = typeof data === 'string' ? JSON.parse(data) : data;
                  if (res?.status === 'credited' || (res?.success && confirmations >= chainConfig.requiredConfirmations)) {
                    credited++;
                  } else if (res?.status === 'error' || res?.success === false) {
                    errors.push(`Native discovery did not process tx ${txHash}: ${res?.message || res?.error || res?.status}`);
                  }
                }
              }
            }
          } catch (discoveryErr: any) {
            // Alchemy's optional discovery method may be unavailable on standard RPCs.
            // Keep the canonical block scanner as fallback, but surface unexpected failures.
            const message = String(discoveryErr?.message || discoveryErr);
            if (!/method not found|unsupported method|not available|unknown method/i.test(message)) {
              errors.push(`Native asset-transfer discovery failed for ${address}: ${message}`);
            }
          }
        }
      } catch (addrErr: any) {
        errors.push(`Native balance/discovery check failed for ${address}: ${addrErr?.message || addrErr}`);
      }
    }

    // 2. Iterate through the full block range requested by the caller.
    // Clamping this to the last 25 blocks silently skipped native deposits in
    // the rest of the caller's scan window.
    const start = fromBlock;
    for (let b = start; b <= toBlock; b++) {
      const block = await provider.getBlock(b, true);
      if (!block) {
        throw new Error(`RPC returned no block data for EVM block ${b}; native deposit scan is incomplete`);
      }
      if (!Array.isArray(block.prefetchedTransactions)) {
        throw new Error(`RPC returned incomplete transaction data for EVM block ${b}; native deposit scan is incomplete`);
      }

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to) continue;
        const toClean = tx.to.toLowerCase();

        if (monitoredEvmAddresses.has(toClean) && tx.value > BigInt(0)) {
          // A transaction included in a fetched block should have a receipt.
          // Missing/mismatched receipt data means this scan cannot be considered complete.
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (!receipt) {
            throw new Error(`RPC returned no receipt for native transfer ${tx.hash} in block ${b}; scan is incomplete`);
          }
          if (receipt.blockNumber !== b) {
            throw new Error(`Receipt block mismatch for native transfer ${tx.hash}: expected ${b}, received ${receipt.blockNumber}`);
          }
          // Reverted transactions cannot produce a deposit; status 0 is an expected non-credit.
          if (receipt.status !== 1) continue;

          // Keep native coin amounts as exact decimal strings to avoid IEEE-754 rounding.
          const formattedAmount = ethers.formatUnits(tx.value, chainConfig.nativeDecimals);
          const verified = await verifyEvmNativeDeposit(
            provider, tx.hash, toClean, formattedAmount, chainConfig.nativeDecimals
          );
          if (!verified || verified.blockNumber !== b) {
            throw new Error(`Canonical verification failed for native transfer ${tx.hash}; scan is incomplete`);
          }
          const confirmations = verified.confirmations;

          detected++;
          try {
            const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toClean,
              p_asset_symbol: chainConfig.nativeSymbol === 'ETH' ? 'ETH' : chainConfig.nativeSymbol,
              p_network_code: normNet === 'ERC20' ? 'ETH' : normNet,
              p_amount: formattedAmount,
              p_tx_hash: tx.hash,
              p_output_index: 0,
              p_block_number: verified.blockNumber,
              p_from_address: verified.fromAddress,
              p_token_contract: null,
              p_confirmations: confirmations,
              p_provider: 'deposit_ingestion',
              p_block_hash: verified.blockHash,
            });

            if (error) {
              errors.push(`RPC error for native transfer ${tx.hash}: ${error.message}`);
            } else {
              const res = typeof data === 'string' ? JSON.parse(data) : data;
              if (!res || typeof res !== 'object') {
                errors.push(`Invalid atomic-credit response for native transfer ${tx.hash}`);
              } else if (res?.status === 'credited' || (res?.success && confirmations >= chainConfig.requiredConfirmations)) {
                credited++;
              } else if (res?.status === 'error' || res?.success === false) {
                errors.push(`Atomic credit rejected native transfer ${tx.hash}: ${res?.message || res?.error || res?.status}`);
              }
            }
          } catch (creditErr: any) {
            // Record the individual transfer failure and continue scanning later transactions.
            errors.push(`Atomic credit failed for native transfer ${tx.hash}: ${creditErr?.message || creditErr}`);
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
    const contractAddress = process.env.USDT_CONTRACT_TRC20 || TRON_CONFIG.usdtContract || CANONICAL_USDT_CONTRACTS.TRC20;
    const normalizeTronContractHex = (value: string): string | null => {
      try {
        return tronWeb.address.toHex(value).toLowerCase().replace(/^0x/, '');
      } catch {
        return null;
      }
    };
    const approvedContractHex = normalizeTronContractHex(contractAddress);

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
    // Only the configured contract is approved; do not silently permit a second
    // hard-coded contract when a deployment is configured for another network.
    addKnownContract(contractAddress);

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

    // 1. Determine latest block height. Never continue with an unknown tip:
    // confirmation counts and the block-log scan would otherwise be misleading.
    let latestBlock = 0;
    const blockTipErrors: string[] = [];
    try {
      const blockRes = await fetch(tronHost, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      if (!blockRes.ok) {
        throw new Error(`eth_blockNumber HTTP ${blockRes.status}`);
      }
      const bData = await blockRes.json();
      if (typeof bData?.result !== 'string' || !/^0x[0-9a-f]+$/i.test(bData.result)) {
        throw new Error('eth_blockNumber returned an invalid block height');
      }
      latestBlock = Number.parseInt(bData.result, 16);
      if (!Number.isSafeInteger(latestBlock) || latestBlock <= 0) {
        throw new Error('eth_blockNumber returned a non-positive or unsafe block height');
      }
    } catch (err: any) {
      blockTipErrors.push(err?.message || String(err));
    }

    if (!latestBlock) {
      try {
        const nowBlockRes = await fetch(`${tronHost}/wallet/getnowblock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!nowBlockRes.ok) {
          throw new Error(`getnowblock HTTP ${nowBlockRes.status}`);
        }
        const nbData = await nowBlockRes.json();
        const height = nbData?.block_header?.raw_data?.number;
        if (!Number.isSafeInteger(height) || height <= 0) {
          throw new Error('getnowblock returned an invalid block height');
        }
        latestBlock = height;
      } catch (err: any) {
        blockTipErrors.push(err?.message || String(err));
      }
    }

    if (!latestBlock) {
      try {
        const curBlock = await tronWeb.trx.getCurrentBlock();
        const height = curBlock?.block_header?.raw_data?.number;
        if (!Number.isSafeInteger(height) || height <= 0) {
          throw new Error('TronWeb returned an invalid current block height');
        }
        latestBlock = height;
      } catch (err: any) {
        blockTipErrors.push(err?.message || String(err));
      }
    }

    if (!latestBlock) {
      throw new Error(`Unable to determine TRON chain tip from all configured providers: ${blockTipErrors.join('; ')}`);
    }

    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const seenTxIndices = new Set<string>();

    // 2. Strategy A: Direct Monitored Account TRC-20 Transaction Ingestion via TronGrid
    // Queries each monitored TRON address for incoming TRC-20 transfers (works reliably regardless of block depth)
    for (const monitoredAddr of monitoredTronAddresses) {
      try {
        const accountUrl = `${tronGridHost}/v1/accounts/${monitoredAddr}/transactions/trc20?limit=200`;
        const items: any[] = [];
        let accountFingerprint: string | null = null;
        let accountPages = 0;
        do {
          const pageUrl = accountFingerprint
            ? `${accountUrl}&fingerprint=${encodeURIComponent(accountFingerprint)}`
            : accountUrl;
          const res = await fetch(pageUrl, { headers: tronGridHeaders });
          if (!res.ok) {
            throw new Error(`TronGrid account endpoint returned HTTP ${res.status}`);
          }
          const json = await res.json();
          if (!Array.isArray(json?.data)) {
            throw new Error('TronGrid account endpoint returned an invalid data payload');
          }
          items.push(...json.data);
          accountFingerprint = typeof json?.meta?.fingerprint === 'string' && json.meta.fingerprint.length > 0
            ? json.meta.fingerprint
            : null;
          accountPages++;
        } while (accountFingerprint && accountPages < 10);
        if (accountFingerprint) {
          throw new Error('TronGrid account scan reached the 10-page safety limit; scan is incomplete');
        }
        {
          for (const item of items) {
            if (item.type !== 'Transfer') continue;

            // Never credit an arbitrary TRC-20 token as USDT. The provider's token
            // metadata must identify the configured approved USDT contract.
            const reportedContract = item.token_info?.address;
            if (!approvedContractHex || !reportedContract ||
                normalizeTronContractHex(reportedContract) !== approvedContractHex) {
              continue;
            }

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

            const eventIndex = Number(item.event_index);
            if (!Number.isSafeInteger(eventIndex) || eventIndex < 0) continue;
            const deduplicationKey = `${txId}_${eventIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;
            seenTxIndices.add(deduplicationKey);

            let fromAddr: string | null = item.from || null;
            try {
              if (fromAddr && (fromAddr.startsWith('41') || fromAddr.startsWith('0x'))) {
                fromAddr = tronWeb.address.fromHex(fromAddr);
              }
            } catch (_) {}

            // The approved TRC-20 USDT contract uses six decimals; do not trust
            // third-party token metadata to choose the credited unit scale.
            const decimals = 6;
            const rawVal = BigInt(item.value || '0');
            if (rawVal <= 0n) continue;
            const formattedAmount = ethers.formatUnits(rawVal, decimals);
            if (/^0(?:\\.0+)?$/.test(formattedAmount)) continue;

            const tokenContract = contractAddress;

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
              } catch (_) {}
            }

            const confirmations = (latestBlock && eventBlock && latestBlock >= eventBlock)
              ? latestBlock - eventBlock + 1
              : 1;

            const verified = await verifyTronTokenDeposit(txId, eventIndex, toAddr, formattedAmount);
            if (!verified) {
              errors.push(`Skipped TRON deposit ${txId} event ${eventIndex}: canonical event verification failed`);
              continue;
            }
            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toAddr,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: eventIndex,
              p_block_number: verified.blockNumber,
              p_from_address: verified.fromAddress,
              p_token_contract: tokenContract,
              p_confirmations: verified.confirmations,
              p_provider: 'deposit_ingestion',
              p_block_hash: verified.blockHash,
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              if (r?.status === 'credited' || (r?.success && verified.confirmations >= TRON_CONFIG.requiredConfirmations)) {
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
        const eventUrl = `${tronGridHost}/v1/contracts/${cAddr}/events?event_name=Transfer&limit=200&order_by=block_timestamp,desc`;
        const events: any[] = [];
        let eventFingerprint: string | null = null;
        let eventPages = 0;
        do {
          const pageUrl = eventFingerprint
            ? `${eventUrl}&fingerprint=${encodeURIComponent(eventFingerprint)}`
            : eventUrl;
          const res = await fetch(pageUrl, { headers: tronGridHeaders });
          if (!res.ok) {
            throw new Error(`TronGrid contract events endpoint returned HTTP ${res.status}`);
          }
          const data = await res.json();
          if (!Array.isArray(data?.data)) {
            throw new Error('TronGrid contract events endpoint returned an invalid data payload');
          }
          events.push(...data.data);
          eventFingerprint = typeof data?.meta?.fingerprint === 'string' && data.meta.fingerprint.length > 0
            ? data.meta.fingerprint
            : null;
          eventPages++;
        } while (eventFingerprint && eventPages < 10);
        if (eventFingerprint) {
          throw new Error('TronGrid contract event scan reached the 10-page safety limit; scan is incomplete');
        }
        {
          for (const evt of events) {
            // Enforce the exact configured token contract before accepting an event.
            const eventContract = evt.contract_address || evt.contractAddress || cAddr;
            if (!approvedContractHex ||
                normalizeTronContractHex(String(eventContract)) !== approvedContractHex ||
                normalizeTronContractHex(String(cAddr)) !== approvedContractHex) continue;

            const txId = evt.transaction_id;
            const outputIndex = evt.event_index !== undefined && evt.event_index !== null ? Number(evt.event_index) : 0;
            const deduplicationKey = `${txId}_${outputIndex}`;
            if (seenTxIndices.has(deduplicationKey)) continue;

            const fromHex = evt.result?.from;
            const toHex = evt.result?.to;
            const rawValue = evt.result?.value;
            if (!toHex || rawValue === undefined || rawValue === null || !/^\\d+$/.test(String(rawValue))) continue;
            // TRON USDT uses six decimals; format only the independently verified raw event value.
            const formattedAmount = ethers.formatUnits(String(rawValue), 6);
            if (!/^\\d+(?:\\.\\d+)?$/.test(formattedAmount) || /^0(?:\\.0+)?$/.test(formattedAmount)) continue;

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
            seenTxIndices.add(deduplicationKey);

            const verified = await verifyTronTokenDeposit(txId, outputIndex, toBase58, formattedAmount);
            if (!verified) {
              errors.push(`Skipped TRON deposit ${txId} event ${outputIndex}: canonical event verification failed`);
              continue;
            }
            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toBase58,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: formattedAmount,
              p_tx_hash: txId,
              p_output_index: outputIndex,
              p_block_number: verified.blockNumber,
              p_from_address: verified.fromAddress,
              p_token_contract: cAddr,
              p_confirmations: verified.confirmations,
              p_provider: 'deposit_ingestion',
              p_block_hash: verified.blockHash,
            });

            if (error) {
              errors.push(`RPC error for TRON deposit ${txId}: ${error.message}`);
            } else {
              const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
              if (r?.status === 'credited' || (r?.success && verified.confirmations >= TRON_CONFIG.requiredConfirmations)) {
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
              if (json.error) {
                throw new Error(`TRON eth_getLogs RPC error for blocks ${r.from}-${clampedTo}: ${JSON.stringify(json.error)}`);
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
          const logContractHex = String(log.address || '').toLowerCase().replace(/^0x/, '');
          if (!approvedContractHex || logContractHex !== approvedContractHex.replace(/^41/, '')) continue;

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

          let formattedAmount = '';
          try {
            const rawValue = BigInt(log.data || '0x0');
            if (rawValue <= 0n) continue;
            formattedAmount = ethers.formatUnits(rawValue, 6);
          } catch (_) {
            continue;
          }

          if (/^0(?:\\.0+)?$/.test(formattedAmount)) continue;

          const eventBlock = parseInt(log.blockNumber || '0x0', 16) || 0;
          const confirmations = latestBlock > eventBlock ? latestBlock - eventBlock + 1 : 1;

          let eventContractBase58 = contractAddress;
          try {
            const logAddrHex = (log.address || '').toLowerCase().replace(/^0x/, '');
            eventContractBase58 = tronWeb.address.fromHex('41' + logAddrHex);
          } catch (_) {}

          const verified = await verifyTronTokenDeposit(txHash, outputIndex, toBase58, formattedAmount);
          if (!verified) {
            errors.push(`Skipped TRON deposit ${txHash} event ${outputIndex}: canonical event verification failed`);
            continue;
          }
          detected++;

          const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toBase58,
            p_asset_symbol: 'USDT',
            p_network_code: 'TRC20',
            p_amount: formattedAmount,
            p_tx_hash: txHash,
            p_output_index: outputIndex,
            p_block_number: verified.blockNumber,
            p_from_address: verified.fromAddress,
            p_token_contract: eventContractBase58,
            p_confirmations: verified.confirmations,
            p_provider: 'deposit_ingestion',
            p_block_hash: verified.blockHash,
          });

          if (error) {
            errors.push(`RPC error for TRON deposit ${txHash}: ${error.message}`);
          } else {
            const res = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
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

  const btcApiBase = getBtcMempoolApi();
  const tipHeight = await fetchUtxoTipHeight(btcApiBase);

  for (const btcAddr of Array.from(monitoredBtcAddresses)) {
    try {
      const res = await fetch(`${btcApiBase}/address/${btcAddr}/txs`);
      if (!res.ok) {
        errors.push(`BTC provider returned HTTP ${res.status} for address scan`);
        continue;
      }
      const txs = await res.json();
      if (!Array.isArray(txs)) continue;

      for (const tx of txs) {
        if (typeof tx?.txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(tx.txid) || !Array.isArray(tx.vout)) continue;
        const blockHeight = tx.status?.block_height;
        const confirmations = tx.status?.confirmed === true &&
          Number.isSafeInteger(blockHeight) && blockHeight > 0 &&
          tipHeight !== null && tipHeight >= blockHeight
          ? tipHeight - blockHeight + 1
          : 0;

        // Each output is its own idempotency key. Never sum multiple outputs while
        // passing only the last output index to the database.
        for (let i = 0; i < tx.vout.length; i++) {
          const out = tx.vout[i];
          if (out?.scriptpubkey_address !== btcAddr ||
              !Number.isSafeInteger(out.value) || out.value <= 0) continue;

          const btcAmount = ethers.formatUnits(BigInt(out.value), 8);
          const verified = await verifyUtxoDepositOutput(btcApiBase, tx.txid, i, btcAddr, btcAmount);
          if (!verified) {
            errors.push(`Skipped BTC output ${tx.txid}:${i}: canonical output verification failed`);
            continue;
          }
          detected++;
          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: btcAddr,
            p_asset_symbol: 'BTC',
            p_network_code: 'BTC',
            p_amount: btcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: verified.blockHeight,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: verified.confirmations,
            p_provider: 'deposit_ingestion',
            p_block_hash: verified.blockHash,
          });

          if (error) {
            errors.push(`RPC error for BTC deposit ${tx.txid} output ${i}: ${error.message}`);
          } else {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed?.status === 'credited' || (parsed?.success && verified.confirmations >= 3)) credited++;
          }
        }
      }
    } catch (err: any) {
      errors.push(`Failed scanning BTC for ${btcAddr}: ${err?.message}`);
    }
  }

  return { detected, credited, errors };
}

/**
 * Scans Litecoin (LTC) deposits, processing each matching transaction output independently.
 */
async function scanLtcDeposits(
  monitoredLtcAddresses: Set<string>
): Promise<{ detected: number; credited: number; errors: string[] }> {
  let detected = 0;
  let credited = 0;
  const errors: string[] = [];

  if (monitoredLtcAddresses.size === 0) return { detected, credited, errors };

  const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
  const tipHeight = await fetchUtxoTipHeight(ltcApiBase);

  for (const ltcAddr of Array.from(monitoredLtcAddresses)) {
    try {
      const res = await fetch(`${ltcApiBase}/address/${ltcAddr}/txs`);
      if (!res.ok) {
        errors.push(`LTC provider returned HTTP ${res.status} for address scan`);
        continue;
      }
      const txs = await res.json();
      if (!Array.isArray(txs)) continue;

      for (const tx of txs) {
        if (typeof tx?.txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(tx.txid) || !Array.isArray(tx.vout)) continue;
        const blockHeight = tx.status?.block_height;
        const confirmations = tx.status?.confirmed === true &&
          Number.isSafeInteger(blockHeight) && blockHeight > 0 &&
          tipHeight !== null && tipHeight >= blockHeight
          ? tipHeight - blockHeight + 1
          : 0;

        // Preserve the exact output index and amount for idempotent crediting.
        for (let i = 0; i < tx.vout.length; i++) {
          const out = tx.vout[i];
          if (out?.scriptpubkey_address !== ltcAddr ||
              !Number.isSafeInteger(out.value) || out.value <= 0) continue;

          const ltcAmount = ethers.formatUnits(BigInt(out.value), 8);
          const verified = await verifyUtxoDepositOutput(ltcApiBase, tx.txid, i, ltcAddr, ltcAmount);
          if (!verified) {
            errors.push(`Skipped LTC output ${tx.txid}:${i}: canonical output verification failed`);
            continue;
          }
          detected++;
          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: ltcAddr,
            p_asset_symbol: 'LTC',
            p_network_code: 'LTC',
            p_amount: ltcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: verified.blockHeight,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: verified.confirmations,
            p_provider: 'deposit_ingestion',
            p_block_hash: verified.blockHash,
          });

          if (error) {
            errors.push(`RPC error for LTC deposit ${tx.txid} output ${i}: ${error.message}`);
          } else {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed?.status === 'credited' || (parsed?.success && verified.confirmations >= 6)) credited++;
          }
        }
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
export async function refreshPendingDepositConfirmations(): Promise<{
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
      .limit(50);

    if (error) {
      throw new Error(`Failed to query pending deposits for confirmation refresh: ${error.message}`);
    }
    if (!pendingDeposits || pendingDeposits.length === 0) {
      return { checked: 0, newlyCredited: 0 };
    }

    checked = pendingDeposits.length;

    for (const dep of pendingDeposits) {
      const normNet = normalizeDepositNetwork(dep.network);
      const destinationAddress = dep.to_address || dep.address;
      const outputIndex = dep.output_index ?? dep.log_index ?? 0;
      const assetSymbol = (dep.asset_symbol || 'USDT').toUpperCase().trim();
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

      if (normNet === 'TRC20') {
        // Do not silently guess event index zero for old/incomplete database rows.
        if (dep.output_index == null && dep.log_index == null) continue;
        const verified = await verifyTronTokenDeposit(
          dep.tx_hash,
          outputIndex,
          destinationAddress,
          dep.amount
        );
        if (!verified) continue;

        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'USDT',
          p_network_code: 'TRC20',
          p_amount: dep.amount,
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockNumber,
          p_from_address: verified.fromAddress,
          p_token_contract: tokenContract,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
          p_block_hash: verified.blockHash,
        });
        if (!rpcErr) {
          const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
          if (r?.status === 'credited') newlyCredited++;
        }
      } else if (normNet === 'BTC') {
        const btcApiBase = getBtcMempoolApi();
        const verified = await verifyUtxoDepositOutput(
          btcApiBase, dep.tx_hash, outputIndex, destinationAddress, dep.amount
        );
        // Stored DB values are not proof of the destination or amount. Do not call
        // the crediting RPC unless the exact output is independently verified.
        if (!verified) continue;
        const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'BTC',
          p_network_code: 'BTC',
          p_amount: dep.amount,
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockHeight,
          p_from_address: null,
          p_token_contract: null,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
          p_block_hash: verified.blockHash,
        });
        if (!rpcErr) {
          const r = typeof data === 'string' ? JSON.parse(data) : data;
          if (r?.status === 'credited') newlyCredited++;
        }
      } else if (normNet === 'LTC') {
        const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
        const verified = await verifyUtxoDepositOutput(
          ltcApiBase, dep.tx_hash, outputIndex, destinationAddress, dep.amount
        );
        if (!verified) continue;
        const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'LTC',
          p_network_code: 'LTC',
          p_amount: dep.amount,
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockHeight,
          p_from_address: null,
          p_token_contract: null,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
          p_block_hash: verified.blockHash,
        });
        if (!rpcErr) {
          const r = typeof data === 'string' ? JSON.parse(data) : data;
          if (r?.status === 'credited') newlyCredited++;
        }
      } else {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        if (chain) {
          const provider = getEvmProvider(normNet);
          const isTokenDeposit = assetSymbol === 'USDT';
          let blockNumber: number | null = null;
          let verifiedBlockHash: string | null = null;
          let confs = 0;
          let fromAddress: string | null = dep.from_address || null;

          if (isTokenDeposit) {
            const verified = await verifyEvmTokenDeposit(
              provider,
              dep.tx_hash,
              outputIndex,
              destinationAddress,
              dep.amount,
              tokenContract || chain.usdtContractAddress || '',
              chain.usdtDecimals ?? 6
            );
            if (!verified) continue;
            blockNumber = verified.blockNumber;
            verifiedBlockHash = verified.blockHash;
            confs = verified.confirmations;
            fromAddress = verified.fromAddress;
          } else {
            // Native EVM deposits must match the exact transaction recipient and
            // raw value before the stored row is allowed to reach the credit RPC.
            const verified = await verifyEvmNativeDeposit(
              provider,
              dep.tx_hash,
              destinationAddress,
              dep.amount,
              chain.nativeDecimals
            );
            if (!verified) continue;
            blockNumber = verified.blockNumber;
            verifiedBlockHash = verified.blockHash;
            confs = verified.confirmations;
            fromAddress = verified.fromAddress;
          }

          const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: destinationAddress,
            p_asset_symbol: assetSymbol,
            p_network_code: normNet,
            p_amount: dep.amount,
            p_tx_hash: dep.tx_hash,
            p_output_index: outputIndex,
            p_block_number: blockNumber,
            p_from_address: fromAddress,
            p_token_contract: isTokenDeposit ? (tokenContract || chain.usdtContractAddress || null) : null,
            p_confirmations: confs,
            p_provider: 'confirmations_worker',
            p_block_hash: verifiedBlockHash,
          });

          if (!rpcErr) {
            const res = typeof data === 'string' ? JSON.parse(data) : data;
            if (res?.status === 'credited') newlyCredited++;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Deposit Ingestion] Error refreshing pending confirmations:', err);
    // Do not report a healthy zero-work result when refresh failed. The caller
    // must surface this cycle as failed so monitoring can alert operators.
    throw err;
  }

  return { checked, newlyCredited };
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
      // Scan a safe trailing block window of 100 blocks
      const scanWindow = 100;
      const fromBlock = Math.max(0, latestBlock - scanWindow);

      netResult.scannedBlocks = latestBlock - fromBlock;

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

let ingestionInterval: NodeJS.Timeout | null = null;
let ingestionCycleInProgress = false;

async function runScheduledDepositIngestion(): Promise<void> {
  if (ingestionCycleInProgress) {
    console.warn('[Deposit Ingestion] Previous cycle is still running; skipping overlapping scheduled cycle.');
    return;
  }

  ingestionCycleInProgress = true;
  try {
    await runDepositIngestion();
  } catch (e) {
    console.error('[Deposit Ingestion] Cycle failed:', e);
  } finally {
    ingestionCycleInProgress = false;
  }
}

export function startDepositIngestionWorker(intervalMs: number = 30000): void {
  if (ingestionInterval) return;
  console.log(`[Deposit Ingestion] Background worker started, polling every ${intervalMs}ms...`);
  void runScheduledDepositIngestion();
  ingestionInterval = setInterval(() => {
    void runScheduledDepositIngestion();
  }, intervalMs);
}

export function stopDepositIngestionWorker(): void {
  if (ingestionInterval) {
    clearInterval(ingestionInterval);
    ingestionInterval = null;
  }
}
