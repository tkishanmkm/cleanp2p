import type { SupabaseClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { ERC20_ABI, SUPPORTED_EVM_CHAINS } from '@/lib/blockchain/providers';
import { getTronWeb } from '@/lib/blockchain/tron';

// Resolve privileged credentials only when the worker runs; never fall back to anon credentials.
const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabaseAdminClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
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
  network: string,
  expected?: {
    destinationAddress: string;
    assetSymbol: string;
    amount: string;
    outputIndex: number;
  }
): Promise<{ confirmations: number; blockNumber?: number; fromAddress?: string } | null> {
  const norm = normalizeDepositNetwork(network);

  if (norm === 'TRC20') {
    try {
      const tronHost = (process.env.TRON_RPC_URL || 'https://api.trongrid.io').replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = process.env.TRON_GRID_API_KEY || process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
      if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

      const [infoRes, nowRes, txRes] = await Promise.all([
        fetch(`${tronHost}/wallet/gettransactioninfobyid`, {
          method: 'POST', headers, body: JSON.stringify({ value: txHash }),
        }),
        fetch(`${tronHost}/wallet/getnowblock`, {
          method: 'POST', headers, body: JSON.stringify({}),
        }),
        fetch(`${tronHost}/wallet/gettransactionbyid`, {
          method: 'POST', headers, body: JSON.stringify({ value: txHash }),
        }),
      ]);
      if (!infoRes.ok || !nowRes.ok || !txRes.ok) return null;
      const info = await infoRes.json();
      const now = await nowRes.json();
      const tx = await txRes.json();
      const blockNumber = Number(info?.blockNumber);
      const currentBlock = Number(now?.block_header?.raw_data?.number);
      if (
        !Number.isSafeInteger(blockNumber) || blockNumber <= 0 ||
        !Number.isSafeInteger(currentBlock) || currentBlock < blockNumber ||
        info?.receipt?.result !== 'SUCCESS'
      ) return null;

      if (expected) {
        // Custodial TRC-20 deposits are direct USDT transfer(address,uint256)
        // calls. Verify the canonical contract, calldata recipient and exact amount.
        if (expected.assetSymbol !== 'USDT') return null;
        const contractValue = tx?.raw_data?.contract?.[0]?.parameter?.value;
        const contractHex = String(contractValue?.contract_address || '').replace(/^0x/i, '');
        const callData = String(contractValue?.data || '').replace(/^0x/i, '').toLowerCase();
        if (!contractHex || !callData.startsWith('a9059cbb') || callData.length < 136) return null;

        const tronWeb = getTronWeb(false);
        let contractAddress = '';
        try {
          contractAddress = tronWeb.address.fromHex(
            contractHex.length === 42 ? contractHex : `41${contractHex.slice(-40)}`
          );
        } catch {
          return null;
        }
        const expectedHex = tronWeb.address.toHex(expected.destinationAddress).replace(/^0x/i, '').slice(-40).toLowerCase();
        const calldataRecipient = callData.slice(8, 72).slice(-40);
        const calldataAmount = BigInt(`0x${callData.slice(-64)}`);
        if (
          contractAddress !== CANONICAL_USDT_CONTRACTS.TRC20 ||
          calldataRecipient !== expectedHex ||
          calldataAmount !== ethers.parseUnits(expected.amount, 6)
        ) return null;
      }

      return { confirmations: currentBlock - blockNumber + 1, blockNumber };
    } catch (err) {
      console.warn(`TRON confirmation query error for ${txHash}:`, err);
      return null;
    }
  }

  if (norm === 'BTC' || norm === 'LTC') {
    try {
      const apiBase = norm === 'BTC'
        ? (process.env.BTC_MEMPOOL_API || 'https://mempool.space/api')
        : (process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api');
      const [txRes, statusRes, tipRes] = await Promise.all([
        fetch(`${apiBase}/tx/${txHash}`),
        fetch(`${apiBase}/tx/${txHash}/status`),
        fetch(`${apiBase}/blocks/tip/height`),
      ]);
      if (!txRes.ok || !statusRes.ok || !tipRes.ok) return null;
      const tx = await txRes.json();
      const status = await statusRes.json();
      const tip = Number((await tipRes.text()).trim());
      if (!status?.confirmed || !Number.isSafeInteger(status.block_height) ||
          !Number.isSafeInteger(tip) || tip < status.block_height) return null;

      if (expected) {
        const output = Array.isArray(tx?.vout) ? tx.vout[expected.outputIndex] : null;
        if (!output || output.scriptpubkey_address !== expected.destinationAddress) return null;
        const outputAmount = BigInt(output.value ?? -1);
        const expectedAmount = ethers.parseUnits(expected.amount, 8);
        if (outputAmount !== expectedAmount) return null;
      }

      return {
        confirmations: tip - status.block_height + 1,
        blockNumber: status.block_height,
      };
    } catch (err) {
      console.warn(`${norm} confirmation query error for ${txHash}:`, err);
      return null;
    }
  }

  try {
    const chain = SUPPORTED_EVM_CHAINS[norm];
    const provider = new ethers.JsonRpcProvider(getRpcUrl(network));
    const [receipt, currentBlock, tx] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
      provider.getTransaction(txHash),
    ]);
    if (!receipt || receipt.status !== 1 || !receipt.blockNumber ||
        currentBlock < receipt.blockNumber || !tx) return null;

    if (expected) {
      if (norm === 'ETH') {
        if (!tx.to || tx.to.toLowerCase() !== expected.destinationAddress.toLowerCase() ||
            tx.value !== ethers.parseUnits(expected.amount, chain?.nativeDecimals ?? 18)) return null;
      } else {
        if (!chain) return null;
        const contract = (CANONICAL_USDT_CONTRACTS[norm] || chain.usdtContractAddress || '').toLowerCase();
        if (!contract) return null;
        const iface = new ethers.Interface(ERC20_ABI);
        const matchingLog = receipt.logs.find((log) => {
          if (log.address.toLowerCase() !== contract) return false;
          try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (!parsed || parsed.name !== 'Transfer') return false;
            const to = String(parsed.args[1]).toLowerCase();
            const value = parsed.args[2] as bigint;
            const expectedValue = ethers.parseUnits(expected.amount, chain.usdtDecimals ?? 6);
            return to === expected.destinationAddress.toLowerCase() &&
              value === expectedValue &&
              log.index === expected.outputIndex;
          } catch {
            return false;
          }
        });
        if (!matchingLog) return null;
      }
    }

    return {
      confirmations: currentBlock - receipt.blockNumber + 1,
      blockNumber: receipt.blockNumber,
      fromAddress: tx.from?.toLowerCase(),
    };
  } catch (err: any) {
    console.warn(`EVM confirmation check failed for ${txHash} on ${network}:`, err?.message);
    return null;
  }
}

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
    // 1. Fetch pending on-chain deposits
    const { data: pendingDeposits, error } = await supabaseAdmin
      .from('onchain_deposits')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Failed to query pending deposits:', error.message);
      return result;
    }

    if (!pendingDeposits || pendingDeposits.length === 0) {
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
        const onChainData = await fetchOnChainConfirmations(deposit.tx_hash, normNet, {
          destinationAddress,
          assetSymbol,
          amount: String(deposit.amount),
          outputIndex,
        });

        // Never reuse stale database confirmations when the chain provider cannot
        // independently verify this deposit. Missing/reorged/failed transactions stay pending.
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
          });
          continue;
        }

        const currentConfirmations = onChainData.confirmations;
        const blockNumber = onChainData.blockNumber ?? null;
        const fromAddress = onChainData.fromAddress ?? deposit.from_address ?? null;

        // Call authoritative canonical RPC process_deposit_atomic
        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: destinationAddress,
          p_asset_symbol: assetSymbol,
          p_network_code: normNet,
          p_amount: String(deposit.amount),
          p_tx_hash: deposit.tx_hash,
          p_output_index: outputIndex,
          p_block_number: blockNumber,
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

    return result;
  } catch (err: any) {
    console.error('Fatal error in runConfirmationsWorker:', err);
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
