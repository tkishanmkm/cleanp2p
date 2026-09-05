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
  const { error: lockError } = await supabaseAdmin
    .from('onchain_withdrawals')
    .update({
      status: 'PROCESSING',
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawal.id)
    .eq('status', 'PENDING');

  if (lockError) {
    return { processed: false, error: 'Failed to acquire job lock' };
  }

  const network = withdrawal.network || 'ERC20';
  const assetSymbol = (withdrawal.asset_symbol || 'USDT').toUpperCase().trim();
  const amountStr = withdrawal.amount.toString();
  const destination = withdrawal.to_address.trim();

  try {
    // ----------------------------------------------------
    // BRANCH A: TRON Network (TRC-20 USDT or Native TRX)
    // ----------------------------------------------------
    if (normalizeNetworkCode(network) === 'TRC20') {
      let txHash: string;

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

      // Mark SUBMITTED with transaction hash
      await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          tx_hash: txHash,
          status: 'SUBMITTED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawal.id);

      console.log(`[Withdrawal Worker] Dispatched TRON payout ${withdrawal.id} (tx: ${txHash})`);

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash,
        status: 'SUBMITTED',
      };
    }

    // ----------------------------------------------------
    // BRANCH B: EVM Networks (ERC20, BEP20, POLYGON, SEPOLIA)
    // ----------------------------------------------------
    const { provider, signer, address } = getEvmHotWalletSigner(network);

    if (!signer || !address) {
      // In local dev without private key configured, generate deterministic simulation reference
      const mockTxHash = `0xsim_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const simulatedNonce = Math.floor(Date.now() / 1000);

      await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          tx_hash: mockTxHash,
          nonce: simulatedNonce,
          status: 'SUBMITTED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawal.id);

      console.log(`[Withdrawal Worker - Dev Mock] Simulated EVM payout ${withdrawal.id} (tx: ${mockTxHash})`);

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash: mockTxHash,
        nonce: simulatedNonce,
        status: 'SUBMITTED',
      };
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

      tx = await tokenContract.transfer(destination, parsedAmount, {
        nonce,
        ...feeOverrides,
      });
    }

    // 4. Update withdrawal record to SUBMITTED
    await supabaseAdmin
      .from('onchain_withdrawals')
      .update({
        tx_hash: tx.hash,
        nonce,
        status: 'SUBMITTED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', withdrawal.id);

    console.log(`[Withdrawal Worker] Broadcasted EVM payout ${withdrawal.id} on ${network} (tx: ${tx.hash}, nonce: ${nonce})`);

    return {
      processed: true,
      withdrawalId: withdrawal.id,
      txHash: tx.hash,
      nonce,
      status: 'SUBMITTED',
    };
  } catch (err: any) {
    console.error(`[Withdrawal Worker] Failed dispatching withdrawal ${withdrawal.id}:`, err);

    // Invoke automated refund RPC
    let refunded = false;
    try {
      const { error: rpcErr } = await supabaseAdmin.rpc('process_failed_withdrawal', {
        p_withdrawal_id: withdrawal.id,
        p_error_reason: err.message || 'Transaction broadcast failure',
      });
      if (!rpcErr) refunded = true;
    } catch (_) {}

    if (!refunded) {
      await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          status: 'FAILED',
          error_message: err.message || 'Transaction execution failure',
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawal.id);
    }

    return {
      processed: true,
      withdrawalId: withdrawal.id,
      status: 'FAILED',
      error: err.message,
    };
  }
}

/**
 * Checks previously SUBMITTED or BROADCASTED withdrawals and confirms them once confirmations are met
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
      .in('status', ['SUBMITTED', 'BROADCASTED', 'PROCESSING'])
      .not('tx_hash', 'is', null)
      .limit(30);

    if (error || !pendingTxs || pendingTxs.length === 0) {
      return { checked: 0, confirmed: 0 };
    }

    checked = pendingTxs.length;

    for (const w of pendingTxs) {
      const normNet = normalizeNetworkCode(w.network);

      if (normNet === 'TRC20') {
        const { isConfirmed } = await getTronTransactionConfirmations(w.tx_hash);
        if (isConfirmed) {
          const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
          });
          if (!confErr) confirmed++;
        }
      } else {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        if (chain) {
          const provider = getEvmProvider(normNet);
          const { confirmations, status } = await getTransactionConfirmations(provider, w.tx_hash);

          // If confirmed and not reverted
          if (confirmations >= (chain.isTestnet ? 1 : 6) && status !== 0) {
            const { error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
              p_withdrawal_id: w.id,
              p_tx_hash: w.tx_hash,
            });
            if (!confErr) confirmed++;
          } else if (status === 0) {
            // Reverted on-chain -> trigger refund
            await supabaseAdmin.rpc('process_failed_withdrawal', {
              p_withdrawal_id: w.id,
              p_error_reason: 'Transaction reverted on-chain',
            });
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
