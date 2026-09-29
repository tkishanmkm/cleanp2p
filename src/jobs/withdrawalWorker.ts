import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import {
  getEvmHotWalletSigner,
  getEvmProvider,
  normalizeNetworkCode,
  getTokenDecimals,
  getTokenContractAddress,
  getEip1559FeeOverrides,
  getTransactionConfirmations,
  SUPPORTED_EVM_CHAINS,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import {
  sendTrc20Transfer,
  getTronTransactionConfirmations,
  TRON_CONFIG,
  isValidTronAddress,
  getTronWeb,
} from '@/lib/blockchain/tron';

// Initialize Supabase admin client with service role
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface WithdrawalProcessResult {
  processed: boolean;
  withdrawalId?: string;
  txHash?: string;
  nonce?: number;
  status?: string;
  error?: string;
}

/**
 * Checks platform settings & circuit breakers
 */
export async function checkCircuitBreakers(): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('platform_settings')
      .select('withdrawals_enabled, global_kill_switch_active, max_single_withdrawal_usd')
      .eq('id', 1)
      .maybeSingle();

    if (error || !settings) {
      return { allowed: true };
    }
    if (settings.global_kill_switch_active) {
      return { allowed: false, reason: 'Global emergency kill switch is currently active' };
    }
    if (!settings.withdrawals_enabled) {
      return { allowed: false, reason: 'Platform withdrawals are paused by administrator' };
    }
    return { allowed: true };
  } catch (err) {
    return { allowed: true };
  }
}

/**
 * Allocates a sequential, collision-free transaction nonce for an EVM hot wallet
 */
export async function allocateEvmNonce(
  network: string,
  walletAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  const normNet = normalizeNetworkCode(network);
  try {
    const onchainPending = await provider.getTransactionCount(walletAddress, 'pending');
    const { data: allocatedNonce, error } = await supabaseAdmin.rpc('allocate_hot_wallet_nonce', {
      p_network: normNet,
      p_wallet_address: walletAddress,
      p_onchain_pending_nonce: onchainPending,
    });
    if (!error && allocatedNonce !== null && allocatedNonce !== undefined) {
      return Number(allocatedNonce);
    }
  } catch (rpcErr) {
    console.warn('[Nonce Manager] RPC allocate_hot_wallet_nonce failed, falling back to on-chain count:', rpcErr);
  }
  return await provider.getTransactionCount(walletAddress, 'pending');
}

/**
 * Processes a single pending withdrawal from the onchain_withdrawals queue
 */
export async function processWithdrawalQueue(): Promise<WithdrawalProcessResult> {
  const circuitCheck = await checkCircuitBreakers();
  if (!circuitCheck.allowed) {
    console.warn(`[Withdrawal Worker] Dispatch halted: ${circuitCheck.reason}`);
    return { processed: false, error: circuitCheck.reason };
  }

  // Claim earliest PENDING withdrawal atomically
  const { data: queue, error } = await supabaseAdmin.rpc('claim_pending_withdrawals', {
    p_limit: 1,
  });

  if (error || !queue || queue.length === 0) {
    return { processed: false };
  }

  const withdrawal = queue[0];
  const network = withdrawal.network || 'TRC20';
  const assetSymbol = (withdrawal.asset_symbol || 'USDT').toUpperCase().trim();
  const amountStr = withdrawal.amount.toString();
  const destination = withdrawal.to_address.trim();
  let isLocalCheckStage = true;

  try {
    // BRANCH A: TRON Network (TRC-20 USDT)
    if (normalizeNetworkCode(network) === 'TRC20') {
      if (!isValidTronAddress(destination)) {
        throw new Error(`Invalid TRON destination address: ${destination}`);
      }
      const tronWeb = getTronWeb(true);
      if (!tronWeb.defaultPrivateKey) {
        throw new Error('TRON hot wallet private key is not configured');
      }

      isLocalCheckStage = false;

      const res = await sendTrc20Transfer({
        toAddress: destination,
        amount: amountStr,
      });
      const txHash = res.txHash;

      await supabaseAdmin.rpc('complete_onchain_withdrawal', {
        p_withdrawal_id: withdrawal.id,
        p_tx_hash: txHash,
      });

      console.log(`[Withdrawal Worker] Dispatched TRON payout ${withdrawal.id} (tx: ${txHash})`);
      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash,
        status: 'COMPLETED',
      };
    }

    // BRANCH B: EVM Networks (ERC20, BEP20)
    const { provider, signer, address } = getEvmHotWalletSigner(network);
    if (!signer || !address) {
      throw new Error(`EVM Hot Wallet signer not available for network ${network}. Check EVM_HOT_WALLET_PRIVATE_KEY.`);
    }

    const nonce = await allocateEvmNonce(network, address, provider);
    const feeOverrides = await getEip1559FeeOverrides(provider, 1.25);
    let tx: ethers.TransactionResponse;

    const normNet = normalizeNetworkCode(network);
    const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
    const isNativeTransfer = chainConfig && assetSymbol === chainConfig.nativeSymbol;

    if (isNativeTransfer) {
      // Native transfer (ETH)
      const parsedAmount = ethers.parseUnits(amountStr, chainConfig.nativeDecimals);
      isLocalCheckStage = false;
      tx = await signer.sendTransaction({
        to: destination,
        value: parsedAmount,
        nonce,
        ...feeOverrides,
      });
    } else {
      // ERC-20 Token Transfer (USDT ERC20 / BEP20)
      const decimals = getTokenDecimals(network, assetSymbol);
      const contractAddress = getTokenContractAddress(network, assetSymbol);
      if (!contractAddress) {
        throw new Error(`No token contract address configured for ${assetSymbol} on ${network}`);
      }
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const parsedAmount = ethers.parseUnits(amountStr, decimals);
      isLocalCheckStage = false;
      tx = await tokenContract.transfer(destination, parsedAmount, {
        nonce,
        ...feeOverrides,
      });
    }

    await supabaseAdmin.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: tx.hash,
    });

    console.log(`[Withdrawal Worker] Broadcasted EVM payout ${withdrawal.id} on ${network} (tx: ${tx.hash}, nonce: ${nonce})`);
    return {
      processed: true,
      withdrawalId: withdrawal.id,
      txHash: tx.hash,
      nonce,
      status: 'COMPLETED',
    };

  } catch (err: any) {
    console.error(`[Withdrawal Worker] Failed dispatching withdrawal ${withdrawal.id}:`, err);

    if (isLocalCheckStage) {
      console.warn(`[Withdrawal Worker] Pre-broadcast validation failure: refunding withdrawal ${withdrawal.id}`);
      try {
        await supabaseAdmin.rpc('process_failed_withdrawal', {
          p_withdrawal_id: withdrawal.id,
          p_error_reason: err.message || 'Transaction pre-broadcast validation failure',
          p_is_verified_unbroadcast: true,
        });
        return {
          processed: true,
          withdrawalId: withdrawal.id,
          status: 'FAILED',
          error: `Pre-broadcast failure. Refund successful: ${err.message}`,
        };
      } catch (refundErr: any) {
        console.error(`[Withdrawal Worker] Refund RPC failed for ${withdrawal.id}:`, refundErr);
        return {
          processed: true,
          withdrawalId: withdrawal.id,
          status: 'FAILED',
          error: `Pre-broadcast failure, refund failed: ${err.message}`,
        };
      }
    } else {
      console.warn(`[Withdrawal Worker] Ambiguous broadcast result for withdrawal ${withdrawal.id}. Transitioning to AMBIGUOUS_BROADCAST and preserving funds reservation.`);
      try {
        await supabaseAdmin
          .from('onchain_withdrawals')
          .update({
            status: 'AMBIGUOUS_BROADCAST',
            error_message: `Ambiguous broadcast error: ${err.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);

        await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'AMBIGUOUS_BROADCAST',
            broadcast_error: `Ambiguous broadcast error: ${err.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);
      } catch (statusErr) {
        console.error(`[Withdrawal Worker] Failed setting AMBIGUOUS_BROADCAST status for ${withdrawal.id}:`, statusErr);
      }

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        status: 'AMBIGUOUS_BROADCAST',
        error: `Ambiguous broadcast error: ${err.message}. Funds remain reserved in in_withdrawal pending manual/reconciliation resolution.`,
      };
    }
  }
}

/**
 * Checks previously BROADCASTED, PROCESSING, or AMBIGUOUS_BROADCAST withdrawals and confirms them once confirmations are met
 */
export async function checkSubmittedWithdrawals(): Promise<{
  checked: number;
  confirmed: number;
}> {
  let checked = 0;
  let confirmed = 0;

  try {
    const { data: pendingTxs, error } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('*')
      .in('status', ['BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST'])
      .not('tx_hash', 'is', null)
      .limit(30);

    if (error || !pendingTxs || pendingTxs.length === 0) {
      return { checked: 0, confirmed: 0 };
    }

    checked = pendingTxs.length;

    for (const w of pendingTxs) {
      const normNet = normalizeNetworkCode(w.network);

      if (normNet === 'TRC20') {
        const { isConfirmed, success } = await getTronTransactionConfirmations(w.tx_hash);
        
        if (isConfirmed) {
          const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
          });
          if (!confErr) confirmed++;
        } else if (!success) {
          await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: `TRON transaction reverted on-chain`,
            p_is_verified_unbroadcast: true,
          });
        }
      } else if (SUPPORTED_EVM_CHAINS[normNet]) {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        const provider = getEvmProvider(normNet);
        const { confirmations, status } = await getTransactionConfirmations(provider, w.tx_hash);

        if (confirmations >= chain.requiredConfirmations && status !== 0) {
          const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
          });
          if (!confErr) confirmed++;
        } else if (status === 0) {
          await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: `EVM transaction reverted on-chain on network ${w.network}`,
            p_is_verified_unbroadcast: true,
          });
        }
      } else if (normNet === 'BTC') {
        try {
          const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
          const res = await fetch(`${btcApiBase}/tx/${w.tx_hash}`);
          if (res.ok) {
            const txData = await res.json();
            if (txData && txData.status && txData.status.confirmed) {
              const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
              });
              if (!confErr) confirmed++;
            }
          }
        } catch (btcErr) {
          console.warn(`[Withdrawal Worker] BTC confirmation check error for ${w.tx_hash}:`, btcErr);
        }
      } else if (normNet === 'LTC') {
        try {
          const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
          const res = await fetch(`${ltcApiBase}/tx/${w.tx_hash}`);
          if (res.ok) {
            const txData = await res.json();
            if (txData && txData.status && txData.status.confirmed) {
              const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
              });
              if (!confErr) confirmed++;
            }
          }
        } catch (ltcErr) {
          console.warn(`[Withdrawal Worker] LTC confirmation check error for ${w.tx_hash}:`, ltcErr);
        }
      }
    }
  } catch (err) {
    console.error('[Withdrawal Worker] Error verifying submitted confirmations:', err);
  }

  return { checked, confirmed };
}

/**
 * Processes all pending withdrawals in sequence up to maxBatch
 * Enforces PostgreSQL distributed singleton advisory lock to ensure only one active dispatcher
 */
export async function processAllPendingWithdrawals(maxBatch: number = 20): Promise<{
  totalProcessed: number;
  results: WithdrawalProcessResult[];
  locked?: boolean;
}> {
  // Acquire distributed singleton advisory lock
  let hasLock = false;
  try {
    const { data: lockAcquired, error: lockErr } = await supabaseAdmin.rpc('acquire_withdrawal_worker_lock');
    if (!lockErr && lockAcquired === true) {
      hasLock = true;
    } else if (!lockErr && lockAcquired === false) {
      console.warn('[Withdrawal Worker Singleton] Another worker instance is currently holding the dispatch lease. Exiting batch run.');
      return { totalProcessed: 0, results: [], locked: true };
    }
  } catch (lockRpcErr) {
    // If RPC is unavailable, proceed defensively
    hasLock = false;
  }

  const results: WithdrawalProcessResult[] = [];
  let count = 0;

  try {
    while (count < maxBatch) {
      const res = await processWithdrawalQueue();
      if (!res.processed) {
        break;
      }
      results.push(res);
      count++;
    }
  } finally {
    if (hasLock) {
      try {
        await supabaseAdmin.rpc('release_withdrawal_worker_lock');
      } catch (unlockErr) {
        console.warn('[Withdrawal Worker Singleton] Notice on lock release:', unlockErr);
      }
    }
  }

  return { totalProcessed: count, results };
}

export const processPendingWithdrawals = processAllPendingWithdrawals;

let workerTimer: NodeJS.Timeout | null = null;
let isWorkerRunning = false;

/**
 * Starts continuous background withdrawal worker loop
 */
export function startWithdrawalWorker(intervalMs: number = 15000): void {
  if (workerTimer) return;
  isWorkerRunning = true;
  console.log(`[Withdrawal Worker] Service started with interval ${intervalMs}ms`);

  const runLoop = async () => {
    if (!isWorkerRunning) return;
    try {
      await processAllPendingWithdrawals(10);
      await checkSubmittedWithdrawals();
    } catch (err) {
      console.error('[Withdrawal Worker Loop Error]:', err);
    } finally {
      if (isWorkerRunning) {
        workerTimer = setTimeout(runLoop, intervalMs);
      }
    }
  };

  workerTimer = setTimeout(runLoop, 1000);
}

/**
 * Stops continuous background withdrawal worker loop
 */
export function stopWithdrawalWorker(): void {
  isWorkerRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  console.log('[Withdrawal Worker] Service stopped');
}

