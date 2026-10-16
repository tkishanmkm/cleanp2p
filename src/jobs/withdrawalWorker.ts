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

import { supabaseAdmin } from '@/lib/supabaseAdmin';
export { supabaseAdmin };

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
      console.error('[Withdrawal Worker] Circuit-breaker settings unavailable; refusing to broadcast withdrawals', error);
      return { allowed: false, reason: 'Withdrawal safety settings unavailable; dispatch is paused' };
    }
    if (settings.global_kill_switch_active) {
      return { allowed: false, reason: 'Global emergency kill switch is currently active' };
    }
    if (!settings.withdrawals_enabled) {
      return { allowed: false, reason: 'Platform withdrawals are paused by administrator' };
    }
    return { allowed: true };
  } catch (err) {
    console.error('[Withdrawal Worker] Circuit-breaker check failed; refusing to broadcast withdrawals', err);
    return { allowed: false, reason: 'Withdrawal safety check failed; dispatch is paused' };
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
  const onchainPending = await provider.getTransactionCount(walletAddress, 'pending');
  if (!Number.isSafeInteger(onchainPending) || onchainPending < 0) {
    throw new Error('Provider returned an invalid pending nonce; refusing withdrawal broadcast');
  }

  let allocatedNonce: unknown;
  try {
    const { data, error } = await supabaseAdmin.rpc('allocate_hot_wallet_nonce', {
      p_network: normNet,
      p_wallet_address: walletAddress,
      p_onchain_pending_nonce: onchainPending,
    });
    if (error) {
      throw new Error(`Nonce allocation RPC failed: ${error.message}`);
    }
    allocatedNonce = data;
  } catch (rpcErr) {
    console.error('[Nonce Manager] Atomic nonce allocation unavailable; refusing withdrawal broadcast', rpcErr);
    throw new Error('Atomic hot-wallet nonce allocation unavailable; refusing withdrawal broadcast');
  }

  if (
    allocatedNonce === null ||
    allocatedNonce === undefined ||
    (typeof allocatedNonce !== 'number' && typeof allocatedNonce !== 'string') ||
    (typeof allocatedNonce === 'string' && !/^\d+$/.test(allocatedNonce))
  ) {
    throw new Error('Atomic nonce allocation returned no valid nonce; refusing withdrawal broadcast');
  }
  let nonce: number;
  if (typeof allocatedNonce === 'number') {
    if (!Number.isSafeInteger(allocatedNonce) || allocatedNonce < 0) {
      throw new Error('Atomic nonce allocation returned an invalid numeric nonce; refusing withdrawal broadcast');
    }
    nonce = allocatedNonce;
  } else {
    let parsedNonce: bigint;
    try {
      parsedNonce = BigInt(allocatedNonce);
    } catch {
      throw new Error('Atomic nonce allocation returned an unparsable nonce; refusing withdrawal broadcast');
    }
    if (parsedNonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Atomic nonce allocation exceeded the safe integer range; refusing withdrawal broadcast');
    }
    nonce = Number(parsedNonce);
  }
  if (!Number.isSafeInteger(nonce) || nonce < onchainPending) {
    throw new Error('Atomic nonce allocation returned an invalid or stale nonce; refusing withdrawal broadcast');
  }
  return nonce;
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
  let amountStr = '';
  let destination = '';
  let isLocalCheckStage = true;

  try {
    // Validate queue data before any network interaction. These checks remain in
    // the pre-broadcast stage so malformed records can be safely refunded.
    if (!withdrawal.id || typeof withdrawal.amount !== 'string' && typeof withdrawal.amount !== 'number') {
      throw new Error('Withdrawal record is missing a valid ID or amount');
    }
    amountStr = String(withdrawal.amount).trim();
    if (!/^\d+(?:\.\d+)?$/.test(amountStr) || !Number.isFinite(Number(amountStr)) || Number(amountStr) <= 0) {
      throw new Error('Withdrawal amount must be a finite positive decimal');
    }
    if (typeof withdrawal.to_address !== 'string') {
      throw new Error('Withdrawal destination is missing');
    }
    destination = withdrawal.to_address.trim();
    if (!destination) {
      throw new Error('Withdrawal destination is empty');
    }
    const normalizedNetwork = normalizeNetworkCode(network);
    if (normalizedNetwork !== 'TRC20' && normalizedNetwork !== 'ERC20' && normalizedNetwork !== 'BEP20') {
      throw new Error(`Unsupported withdrawal network: ${network}`);
    }

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

      const { data: completionData, error: completionError } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
        p_withdrawal_id: withdrawal.id,
        p_tx_hash: txHash,
      });
      if (completionError || !completionData || completionData.success !== true) {
        throw new Error(`Payout was broadcast but withdrawal completion RPC failed or was not confirmed: ${completionError?.message || JSON.stringify(completionData)}`);
      }

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

    const normNet = normalizeNetworkCode(network);
    const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
    if (!chainConfig) {
      throw new Error(`No trusted EVM chain configuration exists for network ${network}`);
    }
    const connectedNetwork = await provider.getNetwork();
    if (connectedNetwork.chainId !== BigInt(chainConfig.chainId)) {
      throw new Error(`RPC chain ID mismatch for ${normNet}: expected ${chainConfig.chainId}, received ${connectedNetwork.chainId.toString()}`);
    }

    const isNativeTransfer = assetSymbol === chainConfig.nativeSymbol;
    const tokenContractAddress = isNativeTransfer ? null : getTokenContractAddress(network, assetSymbol);
    if (!isNativeTransfer && !tokenContractAddress) {
      throw new Error(`Unsupported withdrawal asset ${assetSymbol} on ${network}`);
    }
    const tokenDecimals = isNativeTransfer ? null : getTokenDecimals(network, assetSymbol);
    const parsedAmount = ethers.parseUnits(
      amountStr,
      isNativeTransfer ? chainConfig.nativeDecimals : tokenDecimals!
    );
    const nonce = await allocateEvmNonce(network, address, provider);
    const feeOverrides = await getEip1559FeeOverrides(provider, 1.25);
    let tx: ethers.TransactionResponse;

    if (isNativeTransfer) {
      // Native transfer (ETH)
      isLocalCheckStage = false;
      tx = await signer.sendTransaction({
        to: destination,
        value: parsedAmount,
        nonce,
        ...feeOverrides,
      });
    } else {
      // ERC-20 Token Transfer (USDT ERC20 / BEP20)
      const tokenContract = new ethers.Contract(tokenContractAddress!, ERC20_ABI, signer);
      isLocalCheckStage = false;
      tx = await tokenContract.transfer(destination, parsedAmount, {
        nonce,
        ...feeOverrides,
      });
    }

    // A node accepting the broadcast is not proof of settlement. Keep the
    // withdrawal reserve until a successful mined receipt is observed.
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) {
      throw new Error('EVM withdrawal has no successful mined receipt; keep funds reserved for reconciliation');
    }

    const { data: completionData, error: completionError } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: tx.hash,
    });
    if (completionError || !completionData || completionData.success !== true) {
      throw new Error(`Payout was broadcast but withdrawal completion RPC failed or was not confirmed: ${completionError?.message || JSON.stringify(completionData)}`);
    }

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
        const { error: refundError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
          p_withdrawal_id: withdrawal.id,
          p_error_reason: err.message || 'Transaction pre-broadcast validation failure',
          p_is_verified_unbroadcast: true,
        });
        if (refundError) {
          throw new Error(`Refund RPC returned an error: ${refundError.message}`);
        }
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
        const { error: onchainStatusError } = await supabaseAdmin
          .from('onchain_withdrawals')
          .update({
            status: 'AMBIGUOUS_BROADCAST',
            error_message: `Ambiguous broadcast error: ${err.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);
        if (onchainStatusError) {
          throw new Error(`Failed to persist on-chain ambiguous status: ${onchainStatusError.message}`);
        }

        const { error: withdrawalStatusError } = await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'AMBIGUOUS_BROADCAST',
            broadcast_error: `Ambiguous broadcast error: ${err.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);
        if (withdrawalStatusError) {
          throw new Error(`Failed to persist withdrawal ambiguous status: ${withdrawalStatusError.message}`);
        }
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
        const { isConfirmed, success, isFailed, actualCostTrx } = await getTronTransactionConfirmations(w.tx_hash);
        
        if (isConfirmed && success) {
          const actualTrxStr = actualCostTrx && actualCostTrx.trim().length > 0 ? actualCostTrx.trim() : '0';
          const { data: confData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualTrxStr,
            p_gas_asset: 'TRX',
          });
          if (!confErr && confData?.success === true) {
            confirmed++;
          } else {
            console.error(`[Withdrawal Worker] TRON confirmation RPC did not confirm completion for ${w.id}; retaining unresolved state.`, confErr || confData);
          }
        } else if (isFailed && !success) {
          const { error: failedErr } = await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: `TRON transaction reverted on-chain`,
            p_is_verified_unbroadcast: true,
          });
          if (failedErr) {
            // Keep the withdrawal reserved; a failed refund RPC must never be treated as resolved.
            console.error(`[Withdrawal Worker] Failed to process verified TRON revert for ${w.id}; funds remain reserved:`, failedErr);
          }
        }
      } else if (SUPPORTED_EVM_CHAINS[normNet]) {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        const provider = getEvmProvider(normNet);
        const { confirmations, status, actualGasCost } = await getTransactionConfirmations(provider, w.tx_hash);
        const gasAsset = normNet === 'BEP20' ? 'BNB' : 'ETH';

        if (confirmations >= chain.requiredConfirmations && status !== 0) {
          const actualGasStr = actualGasCost && actualGasCost.trim().length > 0 ? actualGasCost.trim() : '0';
          const { data: confData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualGasStr,
            p_gas_asset: gasAsset,
          });
          if (!confErr && confData?.success === true) {
            confirmed++;
          } else {
            console.error(`[Withdrawal Worker] EVM confirmation RPC did not confirm completion for ${w.id}; retaining unresolved state.`, confErr || confData);
          }
        } else if (status === 0) {
          const { error: failedErr } = await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: `EVM transaction reverted on-chain on network ${w.network}`,
            p_is_verified_unbroadcast: true,
          });
          if (failedErr) {
            // Keep the withdrawal reserved; a failed refund RPC must never be treated as resolved.
            console.error(`[Withdrawal Worker] Failed to process verified EVM revert for ${w.id}; funds remain reserved:`, failedErr);
          }
        }
      } else if (normNet === 'BTC') {
        try {
          const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
          const res = await fetch(`${btcApiBase}/tx/${w.tx_hash}`);
          if (res.ok) {
            const txData = await res.json();
            if (txData && txData.status && txData.status.confirmed) {
              let actualFeeBtc = '0';
              if (typeof txData.fee === 'number' && txData.fee >= 0) {
                const feeSat = BigInt(txData.fee);
                const whole = feeSat / 100000000n;
                const fraction = (feeSat % 100000000n).toString().padStart(8, '0');
                actualFeeBtc = `${whole}.${fraction}`;
              } else if (Array.isArray(txData.vin) && Array.isArray(txData.vout)) {
                const inputSumSat = txData.vin.reduce((acc: bigint, v: any) => acc + BigInt(v.prevout?.value || 0), 0n);
                const outputSumSat = txData.vout.reduce((acc: bigint, v: any) => acc + BigInt(v.value || 0), 0n);
                if (inputSumSat >= outputSumSat) {
                  const feeSat = inputSumSat - outputSumSat;
                  const whole = feeSat / 100000000n;
                  const fraction = (feeSat % 100000000n).toString().padStart(8, '0');
                  actualFeeBtc = `${whole}.${fraction}`;
                }
              }

              const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
                p_actual_gas_amount: actualFeeBtc,
                p_gas_asset: 'BTC',
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
              let actualFeeLtc = '0';
              if (typeof txData.fee === 'number' && txData.fee >= 0) {
                const feeLit = BigInt(txData.fee);
                const whole = feeLit / 100000000n;
                const fraction = (feeLit % 100000000n).toString().padStart(8, '0');
                actualFeeLtc = `${whole}.${fraction}`;
              } else if (Array.isArray(txData.vin) && Array.isArray(txData.vout)) {
                const inputSumLit = txData.vin.reduce((acc: bigint, v: any) => acc + BigInt(v.prevout?.value || 0), 0n);
                const outputSumLit = txData.vout.reduce((acc: bigint, v: any) => acc + BigInt(v.value || 0), 0n);
                if (inputSumLit >= outputSumLit) {
                  const feeLit = inputSumLit - outputSumLit;
                  const whole = feeLit / 100000000n;
                  const fraction = (feeLit % 100000000n).toString().padStart(8, '0');
                  actualFeeLtc = `${whole}.${fraction}`;
                }
              }

              const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
                p_actual_gas_amount: actualFeeLtc,
                p_gas_asset: 'LTC',
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
  // Bound caller-supplied batch sizes. An invalid value must never turn into an
  // effectively unbounded withdrawal dispatch loop.
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > 100) {
    console.error('[Withdrawal Worker] Invalid maxBatch; refusing to dispatch withdrawals');
    return { totalProcessed: 0, results: [], locked: true };
  }

  // Acquire the distributed singleton lock. Never dispatch if lock status
  // cannot be positively established; a lock outage must not enable concurrent payouts.
  let hasLock = false;
  try {
    const { data: lockAcquired, error: lockErr } = await supabaseAdmin.rpc('acquire_withdrawal_worker_lock');
    if (lockErr) {
      console.error('[Withdrawal Worker Singleton] Lock RPC failed; refusing to dispatch withdrawals', lockErr);
      return { totalProcessed: 0, results: [], locked: true };
    }
    if (lockAcquired !== true) {
      console.warn('[Withdrawal Worker Singleton] Lock not acquired; refusing to dispatch withdrawals.');
      return { totalProcessed: 0, results: [], locked: true };
    }
    hasLock = true;
  } catch (lockRpcErr) {
    console.error('[Withdrawal Worker Singleton] Lock status unavailable; refusing to dispatch withdrawals', lockRpcErr);
    return { totalProcessed: 0, results: [], locked: true };
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
        const { error: unlockError } = await supabaseAdmin.rpc('release_withdrawal_worker_lock');
        if (unlockError) {
          console.error('[Withdrawal Worker Singleton] Lock release RPC failed; operator intervention may be required', unlockError);
        }
      } catch (unlockErr) {
        console.error('[Withdrawal Worker Singleton] Lock release threw; operator intervention may be required', unlockErr);
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

