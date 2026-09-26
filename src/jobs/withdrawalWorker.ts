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
  sendTrxTransfer,
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
      .single();

    if (error || !settings) {
      return { allowed: true }; // Proceed if table not present
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
    // 1. Query live on-chain pending count
    const onchainPending = await provider.getTransactionCount(walletAddress, 'pending');
    // 2. Call database RPC to atomically reserve the next nonce
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
  // Fallback to on-chain pending count
  return await provider.getTransactionCount(walletAddress, 'pending');
}

/**
 * Processes a single pending withdrawal from the onchain_withdrawals queue
 */
export async function processWithdrawalQueue(): Promise<WithdrawalProcessResult> {
  // 1. Check platform circuit breakers
  const circuitCheck = await checkCircuitBreakers();
  if (!circuitCheck.allowed) {
    console.warn(`[Withdrawal Worker] Dispatch halted: ${circuitCheck.reason}`);
    return { processed: false, error: circuitCheck.reason };
  }

  // 2. Claim earliest PENDING withdrawal
  const { data: withdrawal, error } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !withdrawal) {
    return { processed: false };
  }

  // 3. Atomically transition state to PROCESSING to acquire execution lock
  const { data: lockedWithdrawals, error: lockError } = await supabaseAdmin
    .from('onchain_withdrawals')
    .update({
      status: 'PROCESSING',
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawal.id)
    .eq('status', 'PENDING')
    .select();

  if (lockError || !lockedWithdrawals || lockedWithdrawals.length !== 1) {
    console.warn(`[Withdrawal Worker] Failed to acquire job lock for withdrawal ${withdrawal.id}. Conflict or another worker claimed it.`);
    return { processed: false, error: 'Failed to acquire job lock' };
  }

  const network = withdrawal.network || 'ERC20';
  const assetSymbol = (withdrawal.asset_symbol || 'USDT').toUpperCase().trim();
  const amountStr = withdrawal.amount.toString();
  const destination = withdrawal.to_address.trim();
  let isLocalCheckStage = true;

  try {
    // ----------------------------------------------------
    // BRANCH A: TRON Network (TRC-20 USDT or Native TRX)
    // ----------------------------------------------------
    if (normalizeNetworkCode(network) === 'TRC20') {
      let txHash: string;
      // Pre-broadcast checks
      if (!isValidTronAddress(destination)) {
        throw new Error(`Invalid TRON destination address: ${destination}`);
      }
      const tronWeb = getTronWeb(true);
      if (!tronWeb.defaultPrivateKey) {
        throw new Error('TRON hot wallet private key is not configured');
      }

      isLocalCheckStage = false; // Next call will broadcast

      if (assetSymbol === 'TRX') {
        const res = await sendTrxTransfer({
          toAddress: destination,
          amountInTrx: amountStr,
        });
        txHash = res.txHash;
      } else {
        // Default TRC20 USDT
        const res = await sendTrc20Transfer({
          toAddress: destination,
          amount: amountStr,
        });
        txHash = res.txHash;
      }

      // Mark BROADCASTED with transaction hash
      await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          tx_hash: txHash,
          status: 'BROADCASTED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawal.id);

      console.log(`[Withdrawal Worker] Dispatched TRON payout ${withdrawal.id} (tx: ${txHash})`);
      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash,
        status: 'BROADCASTED',
      };
    }

    // ----------------------------------------------------
    // BRANCH B: EVM Networks (ERC20, BEP20, POLYGON, SEPOLIA)
    // ----------------------------------------------------
    const { provider, signer, address } = getEvmHotWalletSigner(network);
    if (!signer || !address) {
      throw new Error(`EVM Hot Wallet signer not available for network ${network}. Check EVM_HOT_WALLET_PRIVATE_KEY.`);
    }

    // 1. Allocate synchronized nonce
    const nonce = await allocateEvmNonce(network, address, provider);

    // 2. Fetch EIP-1559 gas fee overrides
    const feeOverrides = await getEip1559FeeOverrides(provider, 1.3);
    let tx: ethers.TransactionResponse;

    // 3. Dispatch Native Token vs ERC-20
    const normNet = normalizeNetworkCode(network);
    const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
    const isNativeTransfer = chainConfig && assetSymbol === chainConfig.nativeSymbol;

    if (isNativeTransfer) {
      // Native transfer (ETH, BNB, POL)
      const parsedAmount = ethers.parseUnits(amountStr, chainConfig.nativeDecimals);
      isLocalCheckStage = false; // Next call will broadcast
      tx = await signer.sendTransaction({
        to: destination,
        value: parsedAmount,
        nonce,
        ...feeOverrides,
      });
    } else {
      // ERC-20 Token Transfer (e.g. USDT)
      const decimals = getTokenDecimals(network, assetSymbol);
      const contractAddress = getTokenContractAddress(network, assetSymbol);
      if (!contractAddress) {
        throw new Error(`No token contract address configured for ${assetSymbol} on ${network}`);
      }
      const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const parsedAmount = ethers.parseUnits(amountStr, decimals);
      isLocalCheckStage = false; // Next call will broadcast
      tx = await tokenContract.transfer(destination, parsedAmount, {
        nonce,
        ...feeOverrides,
      });
    }

    // 4. Update withdrawal record to BROADCASTED
    await supabaseAdmin
      .from('onchain_withdrawals')
      .update({
        tx_hash: tx.hash,
        nonce,
        status: 'BROADCASTED',
        updated_at: new Date().toISOString(),
      })
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
      // Stage A: Definitely NOT broadcast. We can perform a safe rollback refund.
      console.warn(`[Withdrawal Worker] Definitely NOT broadcast: rollback refunding withdrawal ${withdrawal.id}`);
      try {
        const { error: rpcErr } = await supabaseAdmin.rpc('refund_custodial_withdrawal', {
          p_withdrawal_id: withdrawal.id,
          p_error_reason: err.message || 'Transaction pre-broadcast validation failure',
        });
        if (rpcErr) throw rpcErr;
        return {
          processed: true,
          withdrawalId: withdrawal.id,
          status: 'FAILED',
          error: `Definitely not broadcast. Refund successful: ${err.message}`,
        };
      } catch (refundErr: any) {
        console.error(`[Withdrawal Worker] Failed to invoke refund RPC for definitely not broadcast transaction ${withdrawal.id}:`, refundErr);
        // Fallback update
        await supabaseAdmin
          .from('onchain_withdrawals')
          .update({
            status: 'FAILED',
            error_message: `Pre-broadcast failure. Refund failed: ${err.message}. Error: ${refundErr.message || refundErr}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', withdrawal.id);
        return {
          processed: true,
          withdrawalId: withdrawal.id,
          status: 'FAILED',
          error: `Definitely not broadcast, but refund failed: ${err.message}`,
        };
      }
    } else {
      // Stage B: Ambiguous/unknown broadcast result. Keep PROCESSING, record error, do NOT refund!
      console.warn(`[Withdrawal Worker] Ambiguous broadcast result for withdrawal ${withdrawal.id}. Keeping PROCESSING to prevent double-spend.`);
      await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          error_message: `Ambiguous broadcast result: ${err.message || err}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawal.id);
      return {
        processed: true,
        withdrawalId: withdrawal.id,
        status: 'PROCESSING',
        error: `Ambiguous broadcast error: ${err.message}`,
      };
    }
  }
}

/**
 * Checks previously BROADCASTED or PROCESSING withdrawals and confirms them once confirmations are met
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
      .in('status', ['BROADCASTED', 'PROCESSING'])
      .not('tx_hash', 'is', null)
      .limit(30);

    if (error || !pendingTxs || pendingTxs.length === 0) {
      return { checked: 0, confirmed: 0 };
    }

    checked = pendingTxs.length;

    for (const w of pendingTxs) {
      const normNet = normalizeNetworkCode(w.network);

      if (normNet === 'TRC20') {
        const { confirmations, isConfirmed, success } = await getTronTransactionConfirmations(w.tx_hash);
        
        if (isConfirmed) {
          const { error: confErr } = await supabaseAdmin.rpc('complete_custodial_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
          });
          if (!confErr) confirmed++;
        } else if (confirmations >= TRON_CONFIG.requiredConfirmations && !success) {
          // Definitively Reverted On-Chain -> trigger dedicated revert refund RPC
          console.warn(`[Withdrawal Worker] TRON transaction definitively reverted on-chain for withdrawal ${w.id} (tx: ${w.tx_hash})`);
          const { error: refErr } = await supabaseAdmin.rpc('refund_reverted_custodial_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_error_reason: `TRON transaction reverted on-chain with confirmations: ${confirmations}`,
          });
          if (refErr) {
            console.error(`[Withdrawal Worker] Failed to execute revert-refund RPC for TRON withdrawal ${w.id}:`, refErr);
          }
        }
      } else {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        if (chain) {
          const provider = getEvmProvider(normNet);
          const { confirmations, status } = await getTransactionConfirmations(provider, w.tx_hash);

          // If confirmed and successful on-chain
          if (confirmations >= (chain.isTestnet ? 1 : 6) && status !== 0) {
            const { error: confErr } = await supabaseAdmin.rpc('complete_custodial_withdrawal', {
              p_withdrawal_id: w.id,
              p_tx_hash: w.tx_hash,
            });
            if (!confErr) confirmed++;
          } else if (status === 0) {
            // Definitively Reverted On-Chain -> trigger dedicated revert refund RPC
            console.warn(`[Withdrawal Worker] EVM transaction definitively reverted on-chain for withdrawal ${w.id} (tx: ${w.tx_hash})`);
            const { error: refErr } = await supabaseAdmin.rpc('refund_reverted_custodial_withdrawal', {
              p_withdrawal_id: w.id,
              p_tx_hash: w.tx_hash,
              p_error_reason: `EVM transaction reverted on-chain on network ${w.network} with confirmations: ${confirmations}`,
            });
            if (refErr) {
              console.error(`[Withdrawal Worker] Failed to execute revert-refund RPC for EVM withdrawal ${w.id}:`, refErr);
            }
          }
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
 */
export async function processAllPendingWithdrawals(maxBatch: number = 20): Promise<{
  totalProcessed: number;
  results: WithdrawalProcessResult[];
}> {
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

let withdrawalWorkerInterval: NodeJS.Timeout | null = null;

export function startWithdrawalWorker(intervalMs: number = 15000): void {
  if (withdrawalWorkerInterval) return;
  console.log(`[Withdrawal Worker] Started hot wallet polling worker every ${intervalMs}ms...`);
  processWithdrawalQueue().catch((e) => console.error('[Withdrawal Worker] Initial cycle error:', e));

  withdrawalWorkerInterval = setInterval(() => {
    processWithdrawalQueue().catch((e) => console.error('[Withdrawal Worker] Periodic cycle error:', e));
    checkSubmittedWithdrawals().catch((e) => console.error('[Withdrawal Worker] Confirmation cycle error:', e));
  }, intervalMs);
}

export function stopWithdrawalWorker(): void {
  if (withdrawalWorkerInterval) {
    clearInterval(withdrawalWorkerInterval);
    withdrawalWorkerInterval = null;
  }
}
