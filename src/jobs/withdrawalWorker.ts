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
      console.error('[Withdrawal Worker] Circuit-breaker settings unavailable; failing closed.', error);
      return { allowed: false, reason: 'Withdrawal safety settings could not be verified' };
    }
    if (settings.global_kill_switch_active) {
      return { allowed: false, reason: 'Global emergency kill switch is currently active' };
    }
    if (!settings.withdrawals_enabled) {
      return { allowed: false, reason: 'Platform withdrawals are paused by administrator' };
    }
    return { allowed: true };
  } catch (err) {
    console.error('[Withdrawal Worker] Circuit-breaker check failed; failing closed.', err);
    return { allowed: false, reason: 'Withdrawal safety settings could not be verified' };
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
    console.error('[Nonce Manager] RPC allocate_hot_wallet_nonce failed; refusing unsafe nonce fallback.', rpcErr);
    throw new Error('Safe hot-wallet nonce allocation unavailable; withdrawal dispatch halted');
  }
  throw new Error('Safe hot-wallet nonce allocation returned no nonce; withdrawal dispatch halted');
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

      // Persist the broadcast hash without settling the withdrawal. Settlement must
      // happen only after the confirmation worker verifies the chain transaction.
      const { error: hashPersistErr } = await supabaseAdmin
        .from('onchain_withdrawals')
        .update({ tx_hash: txHash, status: 'BROADCASTED', updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id)
        .eq('status', 'PROCESSING');
      if (hashPersistErr) {
        throw new Error(`Broadcast succeeded but tx hash persistence failed; manual reconciliation required: ${hashPersistErr.message}`);
      }
      await supabaseAdmin
        .from('withdrawals')
        .update({ tx_hash: txHash, txid: txHash, status: 'broadcasted', broadcasted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id);

      console.log(`[Withdrawal Worker] Broadcasted TRON payout ${withdrawal.id} (tx: ${txHash})`);
      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash,
        status: 'BROADCASTED',
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

    // Persist the broadcast hash without settling the withdrawal. Settlement must
    // happen only after the confirmation worker verifies the chain transaction.
    const { error: hashPersistErr } = await supabaseAdmin
      .from('onchain_withdrawals')
      .update({ tx_hash: tx.hash, nonce, status: 'BROADCASTED', updated_at: new Date().toISOString() })
      .eq('id', withdrawal.id)
      .eq('status', 'PROCESSING');
    if (hashPersistErr) {
      throw new Error(`Broadcast succeeded but tx hash persistence failed; manual reconciliation required: ${hashPersistErr.message}`);
    }
    await supabaseAdmin
      .from('withdrawals')
      .update({ tx_hash: tx.hash, txid: tx.hash, status: 'broadcasted', broadcasted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', withdrawal.id);

    console.log(`[Withdrawal Worker] Broadcasted EVM payout ${withdrawal.id} on ${network} (tx: ${tx.hash}, nonce: ${nonce})`);
    return {
      processed: true,
      withdrawalId: withdrawal.id,
      txHash: tx.hash,
      nonce,
      status: 'BROADCASTED',
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
        const { isConfirmed, success, actualCostTrx } = await getTronTransactionConfirmations(w.tx_hash);
        
        if (isConfirmed && success) {
          const actualTrxStr = actualCostTrx && actualCostTrx.trim().length > 0 ? actualCostTrx.trim() : '0';
          const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualTrxStr,
            p_gas_asset: 'TRX',
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
        const { confirmations, status, actualGasCost } = await getTransactionConfirmations(provider, w.tx_hash);
        const gasAsset = normNet === 'BEP20' ? 'BNB' : 'ETH';

        if (confirmations >= chain.requiredConfirmations && status !== 0) {
          const actualGasStr = actualGasCost && actualGasCost.trim().length > 0 ? actualGasCost.trim() : '0';
          const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualGasStr,
            p_gas_asset: gasAsset,
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
  // Concurrency is controlled by claim_pending_withdrawals using
  // SELECT ... FOR UPDATE SKIP LOCKED and an atomic status transition to PROCESSING.
  // Do not use session-level advisory locks across separate PostgREST RPC calls.

  const results: WithdrawalProcessResult[] = [];
  let count = 0;

  while (count < maxBatch) {
    const res = await processWithdrawalQueue();
    if (!res.processed) {
      break;
    }
    results.push(res);
    count++;
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

