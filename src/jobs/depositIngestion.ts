import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import {
  SUPPORTED_EVM_CHAINS,
  getEvmProvider,
  normalizeNetworkCode,
  getTokenDecimals,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import { TRON_CONFIG, getTronWeb, isValidTronAddress } from '@/lib/blockchain/tron';

// Initialize Supabase admin client with service role
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
}> {
  const evmAddresses = new Set<string>();
  const tronAddresses = new Set<string>();

  try {
    // 1. Fetch from deposit_addresses
    const { data: primaryAddresses, error: pErr } = await supabaseAdmin
      .from('deposit_addresses')
      .select('address, network_code');

    if (!pErr && primaryAddresses) {
      for (const row of primaryAddresses) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeNetworkCode(row.network_code || '');
        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }

    // 2. Fetch from user_deposit_addresses
    const { data: fallbackAddresses, error: fErr } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('address, network');

    if (!fErr && fallbackAddresses) {
      for (const row of fallbackAddresses) {
        if (!row.address) continue;
        const clean = row.address.trim();
        const normNet = normalizeNetworkCode(row.network || '');
        if (normNet === 'TRC20' || isValidTronAddress(clean)) {
          tronAddresses.add(clean);
        } else if (clean.startsWith('0x')) {
          evmAddresses.add(clean.toLowerCase());
        }
      }
    }
  } catch (err) {
    console.error('[Deposit Ingestion] Error querying monitored deposit addresses:', err);
  }

  return { evmAddresses, tronAddresses };
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

  const normNet = normalizeNetworkCode(network);
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
  if (!chainConfig || !chainConfig.usdtContractAddress) {
    return { detected: 0, credited: 0, errors: [] };
  }

  const provider = getEvmProvider(normNet);
  const tokenContractAddress = chainConfig.usdtContractAddress;
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

        // Call atomic idempotent ingest_and_credit_deposit RPC
        const { data, error } = await supabaseAdmin.rpc('ingest_and_credit_deposit', {
          p_tx_hash: log.transactionHash,
          p_log_index: log.index,
          p_network: normNet,
          p_to_address: toAddress,
          p_amount: numericAmount,
          p_asset_symbol: 'USDT',
          p_confirmations: confirmations,
        });

        if (error) {
          errors.push(`RPC error on tx ${log.transactionHash}: ${error.message}`);
        } else {
          if (confirmations >= chainConfig.requiredConfirmations) {
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
 * Scans EVM blocks for native asset transfers (ETH, BNB, POL) targeting monitored addresses
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

  const normNet = normalizeNetworkCode(network);
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
  if (!chainConfig) return { detected: 0, credited: 0, errors: [] };

  const provider = getEvmProvider(normNet);

  try {
    const latestBlock = await provider.getBlockNumber();

    // Iterate through blocks in range (constrained to max 25 blocks for native scan)
    const start = Math.max(fromBlock, toBlock - 25);
    for (let b = start; b <= toBlock; b++) {
      const block = await provider.getBlock(b, true);
      if (!block || !block.prefetchedTransactions) continue;

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to) continue;
        const toClean = tx.to.toLowerCase();

        if (monitoredEvmAddresses.has(toClean) && tx.value > 0n) {
          detected++;
          const formattedAmount = ethers.formatUnits(tx.value, chainConfig.nativeDecimals);
          const numericAmount = parseFloat(formattedAmount);
          const confirmations = Math.max(1, latestBlock - b + 1);

          const { error } = await supabaseAdmin.rpc('ingest_and_credit_deposit', {
            p_tx_hash: tx.hash,
            p_log_index: 0,
            p_network: normNet,
            p_to_address: toClean,
            p_amount: numericAmount,
            p_asset_symbol: chainConfig.nativeSymbol,
            p_confirmations: confirmations,
          });

          if (error) {
            errors.push(`RPC error for native transfer ${tx.hash}: ${error.message}`);
          } else {
            if (confirmations >= chainConfig.requiredConfirmations) {
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
    const contractAddress = TRON_CONFIG.usdtContract;

    // Fetch latest TRC20 transfer events for USDT contract
    const eventUrl = `${TRON_CONFIG.fullHost}/v1/contracts/${contractAddress}/events?event_name=Transfer&limit=50&order_by=block_timestamp,desc`;
    const headers: Record<string, string> = {};
    if (TRON_CONFIG.apiKey) {
      headers['TRON-PRO-API-KEY'] = TRON_CONFIG.apiKey;
    }

    const res = await fetch(eventUrl, { headers });
    if (!res.ok) {
      errors.push(`TronGrid events API returned status ${res.status}`);
      return { detected, credited, errors };
    }

    const data = await res.json();
    const currentBlock = await tronWeb.trx.getCurrentBlock();
    const currentHeight = currentBlock.block_header?.raw_data?.number || 0;

    for (const evt of data.data || []) {
      const toHex = evt.result?.to;
      const rawValue = evt.result?.value;
      if (!toHex || !rawValue) continue;

      let toBase58 = toHex;
      try {
        if (toHex.startsWith('41') || toHex.startsWith('0x')) {
          toBase58 = tronWeb.address.fromHex(toHex);
        }
      } catch (_) {}

      if (monitoredTronAddresses.has(toBase58)) {
        detected++;
        const amount = Number(rawValue) / 1e6; // USDT TRC20 uses 6 decimals
        const eventBlock = evt.block_number || 0;
        const confirmations = currentHeight > eventBlock ? currentHeight - eventBlock + 1 : 1;

        const { error } = await supabaseAdmin.rpc('ingest_and_credit_deposit', {
          p_tx_hash: evt.transaction_id,
          p_log_index: evt.event_index ?? 0,
          p_network: 'TRC20',
          p_to_address: toBase58,
          p_amount: amount,
          p_asset_symbol: 'USDT',
          p_confirmations: confirmations,
        });

        if (error) {
          errors.push(`RPC error for TRON deposit ${evt.transaction_id}: ${error.message}`);
        } else {
          if (confirmations >= TRON_CONFIG.requiredConfirmations) {
            credited++;
          }
        }
      }
    }
  } catch (err: any) {
    errors.push(`Failed scanning TRON deposits: ${err.message}`);
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
      const normNet = normalizeNetworkCode(dep.network);

      if (normNet === 'TRC20') {
        const tronWeb = getTronWeb(false);
        const txInfo = await tronWeb.trx.getTransactionInfo(dep.tx_hash);
        if (txInfo && txInfo.blockNumber) {
          const currentBlock = await tronWeb.trx.getCurrentBlock();
          const currentHeight = currentBlock.block_header?.raw_data?.number || 0;
          const confs = Math.max(1, currentHeight - txInfo.blockNumber + 1);

          await supabaseAdmin.rpc('ingest_and_credit_deposit', {
            p_tx_hash: dep.tx_hash,
            p_log_index: dep.log_index || 0,
            p_network: 'TRC20',
            p_to_address: dep.to_address,
            p_amount: Number(dep.amount),
            p_asset_symbol: dep.asset_symbol || 'USDT',
            p_confirmations: confs,
          });

          if (confs >= TRON_CONFIG.requiredConfirmations) {
            newlyCredited++;
          }
        }
      } else {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        if (chain) {
          const provider = getEvmProvider(normNet);
          const receipt = await provider.getTransactionReceipt(dep.tx_hash);
          if (receipt && receipt.blockNumber) {
            const currentBlock = await provider.getBlockNumber();
            const confs = Math.max(1, currentBlock - receipt.blockNumber + 1);

            await supabaseAdmin.rpc('ingest_and_credit_deposit', {
              p_tx_hash: dep.tx_hash,
              p_log_index: dep.log_index || 0,
              p_network: normNet,
              p_to_address: dep.to_address,
              p_amount: Number(dep.amount),
              p_asset_symbol: dep.asset_symbol || 'USDT',
              p_confirmations: confs,
            });

            if (confs >= chain.requiredConfirmations) {
              newlyCredited++;
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
export async function runDepositIngestion(): Promise<{
  results: IngestionResult[];
  pendingRecheck: { checked: number; newlyCredited: number };
}> {
  const { evmAddresses, tronAddresses } = await getMonitoredAddresses();
  const results: IngestionResult[] = [];

  // 1. Scan EVM Chains
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
      const scanWindow = chain.isTestnet ? 50 : 100;
      const fromBlock = Math.max(0, latestBlock - scanWindow);

      netResult.scannedBlocks = latestBlock - fromBlock;

      if (evmAddresses.size > 0) {
        // Scan ERC20 USDT
        const tokenRes = await scanEvmTokenDeposits(netKey, evmAddresses, fromBlock, latestBlock);
        netResult.depositsDetected += tokenRes.detected;
        netResult.depositsCredited += tokenRes.credited;
        netResult.errors.push(...tokenRes.errors);

        // Scan Native transfers
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

  // 3. Recheck previously PENDING deposits
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
