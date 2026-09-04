import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export interface WithdrawalTask {
  id: string;
  user_id: string;
  destination_address: string;
  amount: string | number;
  asset_symbol: string;
  network: string;
}

export interface WithdrawalRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  asset_code: string;
  network_code: string;
  destination_address: string;
  amount: number;
  network_fee: number;
  status: string;
  txid?: string | null;
  broadcast_attempts?: number;
  broadcast_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastResult {
  id: string;
  assetCode: string;
  networkCode: string;
  destinationAddress: string;
  amount: number;
  success: boolean;
  txid?: string;
  error?: string;
  attempts: number;
}

export interface ProcessWithdrawalsSummary {
  processedCount: number;
  successful: number;
  failed: number;
  details: BroadcastResult[];
}

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

function getRpcUrlForNetwork(network: string): string {
  const norm = network.toUpperCase().trim();
  switch (norm) {
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'POLYGON':
    case 'MATIC':
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
    default:
      return process.env.EVM_RPC_URL || process.env.ETH_RPC_URL || 'https://cloudflare-eth.com';
  }
}

/**
 * Signs and broadcasts a real on-chain transaction via ethers.js
 */
export async function processEvmWithdrawalOnChain(
  withdrawal: WithdrawalTask,
  privateKeyHex: string,
  rpcUrl: string
): Promise<string> {
  const formattedKey = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(formattedKey, provider);
  const supabase = getSupabaseAdminClient();

  console.log(`[Withdrawal Engine] Processing Withdrawal ID: ${withdrawal.id}`);

  let txResponse: ethers.TransactionResponse;

  const symbol = (withdrawal.asset_symbol || '').toUpperCase();
  const amountStr = String(withdrawal.amount);

  if (symbol === 'ETH' || symbol === 'BNB' || symbol === 'MATIC' || symbol === 'POL') {
    // Native Transfer
    const value = ethers.parseEther(amountStr);
    const feeData = await provider.getFeeData();

    txResponse = await wallet.sendTransaction({
      to: withdrawal.destination_address,
      value: value,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });
  } else {
    // Token Transfer (e.g., USDT / USDC)
    const tokenContractAddress =
      process.env[`${symbol}_CONTRACT_ADDRESS`] ||
      (symbol === 'USDT' ? process.env.USDT_CONTRACT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7' : null);

    if (!tokenContractAddress) {
      throw new Error(`Contract address not configured for asset: ${symbol}`);
    }

    const contract = new ethers.Contract(tokenContractAddress, ERC20_ABI, wallet);
    let decimals: number;
    try {
      decimals = await contract.decimals();
    } catch {
      decimals = symbol === 'USDT' || symbol === 'USDC' ? 6 : 18;
    }

    const parsedAmount = ethers.parseUnits(amountStr, decimals);
    txResponse = await contract.transfer(withdrawal.destination_address, parsedAmount);
  }

  console.log(`[Withdrawal Engine] Broadcast Successful. TxHash: ${txResponse.hash}`);

  // Record successful broadcast in database (supporting both tables: withdrawals and onchain_withdrawals)
  try {
    await supabase
      .from('withdrawals')
      .update({
        tx_hash: txResponse.hash,
        txid: txResponse.hash,
        status: 'BROADCASTED',
        broadcasted_at: new Date().toISOString(),
      })
      .eq('id', withdrawal.id);
  } catch (dbErr) {
    console.warn('[Withdrawal Engine] DB notice on withdrawals update:', dbErr);
  }

  try {
    await supabase
      .from('onchain_withdrawals')
      .update({
        tx_hash: txResponse.hash,
        status: 'BROADCASTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', withdrawal.id);
  } catch (_) {}

  return txResponse.hash;
}

/**
 * Sign and broadcast router for pending records
 */
export async function signAndBroadcast(withdrawal: WithdrawalRecord): Promise<string> {
  const privateKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is not configured');
  }

  const rpcUrl = getRpcUrlForNetwork(withdrawal.network_code);
  const task: WithdrawalTask = {
    id: withdrawal.id,
    user_id: withdrawal.user_id,
    destination_address: withdrawal.destination_address,
    amount: withdrawal.amount,
    asset_symbol: withdrawal.asset_code,
    network: withdrawal.network_code,
  };

  return processEvmWithdrawalOnChain(task, privateKey, rpcUrl);
}

/**
 * Batch processor for pending approved withdrawals
 */
export async function processPendingWithdrawals(limit: number = 20): Promise<ProcessWithdrawalsSummary> {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: withdrawals, error: fetchError } = await supabaseAdmin
    .from('withdrawals')
    .select('*')
    .in('status', ['approved', 'processing', 'QUEUED'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchError) {
    throw new Error(`Failed to query pending withdrawals: ${fetchError.message}`);
  }

  if (!withdrawals || withdrawals.length === 0) {
    return {
      processedCount: 0,
      successful: 0,
      failed: 0,
      details: [],
    };
  }

  const results: BroadcastResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const item of withdrawals) {
    const attempts = (item.broadcast_attempts || 0) + 1;
    const assetCode = item.asset_symbol || item.asset_code || 'USDT';
    const networkCode = item.network || item.network_code || 'ERC20';
    const destAddr = item.destination_address;
    const amountNum = Number(item.amount);

    try {
      await supabaseAdmin
        .from('withdrawals')
        .update({
          status: 'processing',
          broadcast_attempts: attempts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      const task: WithdrawalTask = {
        id: item.id,
        user_id: item.user_id,
        destination_address: destAddr,
        amount: item.amount,
        asset_symbol: assetCode,
        network: networkCode,
      };

      const privateKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is not configured');
      }

      const rpcUrl = getRpcUrlForNetwork(networkCode);
      const txid = await processEvmWithdrawalOnChain(task, privateKey, rpcUrl);

      results.push({
        id: item.id,
        assetCode,
        networkCode,
        destinationAddress: destAddr,
        amount: amountNum,
        success: true,
        txid,
        attempts,
      });

      successful++;
    } catch (broadcastErr: unknown) {
      const errorMsg = broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr);
      const isPermanentlyFailed = attempts >= 3;

      await supabaseAdmin
        .from('withdrawals')
        .update({
          status: isPermanentlyFailed ? 'failed' : 'processing',
          broadcast_attempts: attempts,
          broadcast_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      results.push({
        id: item.id,
        assetCode,
        networkCode,
        destinationAddress: destAddr,
        amount: amountNum,
        success: false,
        error: errorMsg,
        attempts,
      });

      failed++;
    }
  }

  return {
    processedCount: withdrawals.length,
    successful,
    failed,
    details: results,
  };
}
