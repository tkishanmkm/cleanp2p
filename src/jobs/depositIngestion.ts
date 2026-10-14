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
  process.env.SUPABASE_URL?.trim() ||
  'https://eaiwgfxoiwxepinvcykg.supabase.co';
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
async function verifyUtxoDepositOutput(
  apiBase: string,
  txHash: string,
  outputIndex: number,
  destinationAddress: string,
  storedAmount: number
): Promise<{ blockHeight: number | null; confirmations: number } | null> {
  if (!/^[a-fA-F0-9]{64}$/.test(txHash) ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0 ||
      !Number.isFinite(storedAmount) || storedAmount <= 0 ||
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
        !Number.isSafeInteger(output.value) || output.value <= 0 ||
        Math.round(storedAmount * 100_000_000) !== output.value) return null;

    if (status?.confirmed !== true) return { blockHeight: null, confirmations: 0 };
    const blockHeight = status.block_height;
    if (!Number.isSafeInteger(blockHeight) || blockHeight <= 0) return null;
    const tipHeight = await fetchUtxoTipHeight(base);
    if (tipHeight === null || tipHeight < blockHeight) return null;
    return { blockHeight, confirmations: tipHeight - blockHeight + 1 };
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
): Promise<{ blockNumber: number; confirmations: number; fromAddress: string } | null> {
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

    return {
      blockNumber: receipt.blockNumber,
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
  storedAmount: number,
  tokenContract: string,
  decimals: number
): Promise<{ blockNumber: number; confirmations: number; fromAddress: string } | null> {
  if (!/^0x[0-9a-f]{64}$/i.test(txHash) ||
      !Number.isSafeInteger(logIndex) || logIndex < 0 ||
      !ethers.isAddress(destinationAddress) || !ethers.isAddress(tokenContract) ||
      !Number.isFinite(storedAmount) || storedAmount <= 0 ||
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
      expectedValue = ethers.parseUnits(String(storedAmount), decimals);
    } catch {
      return null;
    }
    if (expectedValue !== rawValue) return null;

    return {
      blockNumber: receipt.blockNumber,
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
  storedAmount: number
): Promise<{ blockNumber: number; confirmations: number; fromAddress: string } | null> {
  if (!/^[0-9a-f]{64}$/i.test(txHash) ||
      !Number.isSafeInteger(eventIndex) || eventIndex < 0 ||
      !isValidTronAddress(destinationAddress) ||
      !Number.isFinite(storedAmount) || storedAmount <= 0) return null;

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

    const [txInfo, currentBlock, eventsResponse] = await Promise.all([
      tronWeb.trx.getTransactionInfo(txHash),
      tronWeb.trx.getCurrentBlock(),
      fetch(`${eventHost}/v1/transactions/${txHash}/events?limit=200`, { headers }),
    ]);
    if (!txInfo || String(txInfo.id || '').toLowerCase() !== txHash.toLowerCase() ||
        String(txInfo.receipt?.result || '').toUpperCase() !== 'SUCCESS' ||
        !Number.isSafeInteger(txInfo.blockNumber) || txInfo.blockNumber <= 0 ||
        !eventsResponse.ok) return null;

    const currentHeight = currentBlock?.block_header?.raw_data?.number;
    if (!Number.isSafeInteger(currentHeight) || currentHeight < txInfo.blockNumber) return null;

    const eventsPayload = await eventsResponse.json();
    const events = Array.isArray(eventsPayload?.data) ? eventsPayload.data : [];
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
      expectedValue = ethers.parseUnits(String(storedAmount), 6);
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
    console.error('[Deposit Ingestion] Error querying monitored deposit addresses:', err);
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
        // Do not trust provider filtering alone: bind the log to the configured contract.
        if (log.address.toLowerCase() !== tokenContractAddress.toLowerCase()) continue;

        const fromAddress = (parsed.args[0] as string).toLowerCase();
        const toAddress = (parsed.args[1] as string).toLowerCase();
        if (!monitoredEvmAddresses.has(toAddress)) {
          continue; // Not a platform deposit address
        }

        const rawValue = parsed.args[2] as bigint;
        const formattedAmount = ethers.formatUnits(rawValue, tokenDecimals);
        const numericAmount = parseFloat(formattedAmount);

        if (numericAmount <= 0) continue;

        detected++;
        const confirmations = Math.max(1, latestBlock - log.blockNumber + 1);

        // Call canonical atomic deposit RPC
        const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: toAddress,
          p_asset_symbol: 'USDT',
          p_network_code: normNet,
          p_amount: numericAmount,
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
                const valueNum = Number(ethers.formatUnits(chainTx.value, chainConfig.nativeDecimals));
                if (!Number.isFinite(valueNum) || valueNum <= 0) continue;
                const assetSymbol = chainConfig.nativeSymbol.toUpperCase();
                const confirmations = Math.max(0, latestBlock - txBlock + 1);

                detected++;
                const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
                  p_destination_address: address.toLowerCase(),
                  p_asset_symbol: assetSymbol === 'ETH' ? 'ETH' : assetSymbol,
                  p_network_code: normNet === 'ERC20' ? 'ETH' : normNet,
                  p_amount: valueNum,
                  p_tx_hash: txHash,
                  p_output_index: 0,
                  p_block_number: isNaN(txBlock) ? null : txBlock,
                  p_from_address: chainTx.from?.toLowerCase() || null,
                  p_token_contract: null,
                  p_confirmations: confirmations,
                  p_provider: 'deposit_ingestion',
                });

                if (!error) {
                  const res = typeof data === 'string' ? JSON.parse(data) : data;
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
    const start = Math.max(fromBlock, toBlock - 25);
    for (let b = start; b <= toBlock; b++) {
      const block = await provider.getBlock(b, true);
      if (!block || !block.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to) continue;
        const toClean = tx.to.toLowerCase();

        if (monitoredEvmAddresses.has(toClean) && tx.value > BigInt(0)) {
          // Require a successful canonical receipt before crediting a native transfer.
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (!receipt || receipt.status !== 1 || receipt.blockNumber !== b) continue;

          detected++;
          const formattedAmount = ethers.formatUnits(tx.value, chainConfig.nativeDecimals);
          const numericAmount = parseFloat(formattedAmount);
          const confirmations = Math.max(1, latestBlock - b + 1);

          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toClean,
            p_asset_symbol: chainConfig.nativeSymbol === 'ETH' ? 'ETH' : chainConfig.nativeSymbol,
            p_network_code: normNet === 'ERC20' ? 'ETH' : normNet,
            p_amount: numericAmount,
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
            const amount = parseFloat(formattedAmount);
            if (amount <= 0) continue;

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

            detected++;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toAddr,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: amount,
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
              const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
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

    // 3. Strategy B: TronGrid Contract Event Ingestion (Transfer events on known USDT contracts)
    for (const cAddr of knownContracts) {
      try {
        const eventUrl = `${tronGridHost}/v1/contracts/${cAddr}/events?event_name=Transfer&limit=50&order_by=block_timestamp,desc`;
        const res = await fetch(eventUrl, { headers: tronGridHeaders });
        if (res.ok) {
          const data = await res.json();
          for (const evt of data.data || []) {
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
            seenTxIndices.add(deduplicationKey);

            detected++;
            const rawValBig = BigInt(rawValue);
            const formattedAmount = ethers.formatUnits(rawValBig, 6);
            const amount = parseFloat(formattedAmount);
            const eventBlock = evt.block_number || 0;
            const confirmations = (latestBlock && eventBlock && latestBlock >= eventBlock)
              ? latestBlock - eventBlock + 1
              : 1;

            const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
              p_destination_address: toBase58,
              p_asset_symbol: 'USDT',
              p_network_code: 'TRC20',
              p_amount: amount,
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
              if (r?.status === 'credited' || (r?.success && confirmations >= TRON_CONFIG.requiredConfirmations)) {
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

          let numericAmount = 0;
          try {
            const rawValue = BigInt(log.data || '0x0');
            if (rawValue <= 0n) continue;
            const formattedAmount = ethers.formatUnits(rawValue, 6);
            numericAmount = parseFloat(formattedAmount);
          } catch (_) {
            continue;
          }

          if (numericAmount <= 0) continue;

          const eventBlock = parseInt(log.blockNumber || '0x0', 16) || 0;
          const confirmations = latestBlock > eventBlock ? latestBlock - eventBlock + 1 : 1;

          let eventContractBase58 = contractAddress;
          try {
            const logAddrHex = (log.address || '').toLowerCase().replace(/^0x/, '');
            eventContractBase58 = tronWeb.address.fromHex('41' + logAddrHex);
          } catch (_) {}

          detected++;

          const { data: rpcData, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: toBase58,
            p_asset_symbol: 'USDT',
            p_network_code: 'TRC20',
            p_amount: numericAmount,
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

          detected++;
          const btcAmount = out.value / 100_000_000;
          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: btcAddr,
            p_asset_symbol: 'BTC',
            p_network_code: 'BTC',
            p_amount: btcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: Number.isSafeInteger(blockHeight) && blockHeight > 0 ? blockHeight : null,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for BTC deposit ${tx.txid} output ${i}: ${error.message}`);
          } else {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed?.status === 'credited' || (parsed?.success && confirmations >= 3)) credited++;
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

          detected++;
          const ltcAmount = out.value / 100_000_000;
          const { data, error } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: ltcAddr,
            p_asset_symbol: 'LTC',
            p_network_code: 'LTC',
            p_amount: ltcAmount,
            p_tx_hash: tx.txid,
            p_output_index: i,
            p_block_number: Number.isSafeInteger(blockHeight) && blockHeight > 0 ? blockHeight : null,
            p_from_address: null,
            p_token_contract: null,
            p_confirmations: confirmations,
            p_provider: 'deposit_ingestion',
          });

          if (error) {
            errors.push(`RPC error for LTC deposit ${tx.txid} output ${i}: ${error.message}`);
          } else {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed?.status === 'credited' || (parsed?.success && confirmations >= 6)) credited++;
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

    if (error || !pendingDeposits || pendingDeposits.length === 0) {
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
          Number(dep.amount)
        );
        if (!verified) continue;

        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'USDT',
          p_network_code: 'TRC20',
          p_amount: Number(dep.amount),
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockNumber,
          p_from_address: verified.fromAddress,
          p_token_contract: tokenContract,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
        });
        if (!rpcErr) {
          const r = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
          if (r?.status === 'credited') newlyCredited++;
        }
      } else if (normNet === 'BTC') {
        const btcApiBase = getBtcMempoolApi();
        const verified = await verifyUtxoDepositOutput(
          btcApiBase, dep.tx_hash, outputIndex, destinationAddress, Number(dep.amount)
        );
        // Stored DB values are not proof of the destination or amount. Do not call
        // the crediting RPC unless the exact output is independently verified.
        if (!verified) continue;
        const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'BTC',
          p_network_code: 'BTC',
          p_amount: Number(dep.amount),
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockHeight,
          p_from_address: null,
          p_token_contract: null,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
        });
        if (!rpcErr) {
          const r = typeof data === 'string' ? JSON.parse(data) : data;
          if (r?.status === 'credited') newlyCredited++;
        }
      } else if (normNet === 'LTC') {
        const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
        const verified = await verifyUtxoDepositOutput(
          ltcApiBase, dep.tx_hash, outputIndex, destinationAddress, Number(dep.amount)
        );
        if (!verified) continue;
        const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: 'LTC',
          p_network_code: 'LTC',
          p_amount: Number(dep.amount),
          p_tx_hash: dep.tx_hash,
          p_output_index: outputIndex,
          p_block_number: verified.blockHeight,
          p_from_address: null,
          p_token_contract: null,
          p_confirmations: verified.confirmations,
          p_provider: 'confirmations_worker',
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
          let confs = 0;
          let fromAddress: string | null = dep.from_address || null;

          if (isTokenDeposit) {
            const verified = await verifyEvmTokenDeposit(
              provider,
              dep.tx_hash,
              outputIndex,
              destinationAddress,
              Number(dep.amount),
              tokenContract || chain.usdtContractAddress || '',
              chain.usdtDecimals ?? 6
            );
            if (!verified) continue;
            blockNumber = verified.blockNumber;
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
            confs = verified.confirmations;
            fromAddress = verified.fromAddress;
          }

          const { data, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
            p_destination_address: destinationAddress,
            p_asset_symbol: assetSymbol,
            p_network_code: normNet,
            p_amount: Number(dep.amount),
            p_tx_hash: dep.tx_hash,
            p_output_index: outputIndex,
            p_block_number: blockNumber,
            p_from_address: fromAddress,
            p_token_contract: isTokenDeposit ? (tokenContract || chain.usdtContractAddress || null) : null,
            p_confirmations: confs,
            p_provider: 'confirmations_worker',
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
