import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import {
  getEvmHotWalletSigner,
  getFinalizedEvmWithdrawalReceiptProof,
  verifyEvmWithdrawalEvidence,
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
  prepareSignedTrc20Transfer,
  broadcastSignedTrc20Transfer,
  getTronTransactionConfirmations,
  TRON_CONFIG,
  isValidTronAddress,
  getTronWeb,
} from '@/lib/blockchain/tron';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { bitcoinLikePayoutMatches, hasRequiredConfirmations } from '@/lib/blockchain/utxo-withdrawal-validation';
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
      // Fail closed: an unavailable settings row must never bypass the platform
      // withdrawal pause or emergency kill switch.
      return { allowed: false, reason: 'Withdrawal controls could not be verified; dispatch is paused' };
    }
    if (settings.global_kill_switch_active) {
      return { allowed: false, reason: 'Global emergency kill switch is currently active' };
    }
    if (!settings.withdrawals_enabled) {
      return { allowed: false, reason: 'Platform withdrawals are paused by administrator' };
    }
    return { allowed: true };
  } catch (err) {
    return { allowed: false, reason: 'Withdrawal controls could not be verified; dispatch is paused' };
  }
}

/**
 * Allocates a sequential, collision-free transaction nonce for an EVM hot wallet
 */
export async function allocateEvmNonce(
  withdrawalId: string,
  workerId: string,
  network: string,
  walletAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  const normNet = normalizeNetworkCode(network);
  const onchainPending = await provider.getTransactionCount(walletAddress, 'pending');
  const { data: allocatedNonce, error } = await supabaseAdmin.rpc('allocate_onchain_withdrawal_nonce', {
    p_withdrawal_id: withdrawalId,
    p_worker_id: workerId,
    p_network: normNet,
    p_wallet_address: walletAddress,
    p_onchain_pending_nonce: onchainPending,
  });
  if (error || allocatedNonce === null || allocatedNonce === undefined) {
    const databaseCode = String((error as { code?: string } | null)?.code || '');
    if (databaseCode === '55P03') {
      throw new Error(`HOT_WALLET_NONCE_STREAM_BUSY: ${error?.message || 'An earlier hot-wallet transaction is unresolved'}`);
    }
    throw new Error(`Lease-bound nonce allocation failed for ${normNet}: ${error?.message || 'RPC returned no nonce'}`);
  }
  const nonce = Number(allocatedNonce);
  if (!Number.isSafeInteger(nonce) || nonce < onchainPending) {
    throw new Error(`Lease-bound nonce allocation returned an invalid or stale nonce for ${normNet}`);
  }
  return nonce;
}

/**
 * Processes a single pending withdrawal from the onchain_withdrawals queue
 */
export async function processWithdrawalQueue(workerId: string = randomUUID()): Promise<WithdrawalProcessResult> {
  if (!workerId || workerId.trim().length === 0 || workerId.length > 128) {
    return { processed: false, error: 'WITHDRAWAL_WORKER_ID_REQUIRED' };
  }

  const circuitCheck = await checkCircuitBreakers();
  if (!circuitCheck.allowed) {
    console.warn(`[Withdrawal Worker] Dispatch halted: ${circuitCheck.reason}`);
    return { processed: false, error: circuitCheck.reason };
  }

  // Claim earliest PENDING withdrawal atomically
  const { data: queue, error } = await supabaseAdmin.rpc('claim_pending_withdrawals', {
    p_limit: 1,
    p_worker_id: workerId,
  });

  if (error || !queue || queue.length === 0) {
    return { processed: false };
  }

  const withdrawal = queue[0];

  // Fail closed before any chain broadcast if the paired user-facing withdrawal
  // row is missing or not in a dispatchable state. The broadcast recorder also
  // requires both rows, so sending first could create an irreversible payout
  // that cannot be persisted/reconciled atomically.
  const { data: pairedWithdrawal, error: pairedWithdrawalError } = await supabaseAdmin
    .from('withdrawals')
    .select('id, status')
    .eq('id', withdrawal.id)
    .maybeSingle();

  if (pairedWithdrawalError || !pairedWithdrawal) {
    const reason = pairedWithdrawalError?.message || 'paired withdrawals record is missing';
    console.error(`[Withdrawal Worker] Refusing to broadcast ${withdrawal.id}: ${reason}`);
    return { processed: false, withdrawalId: withdrawal.id, error: 'PAIRED_WITHDRAWAL_RECORD_UNAVAILABLE' };
  }

  const pairedStatus = String(pairedWithdrawal.status || '').toLowerCase();
  if (!['queued', 'pending', 'approved', 'processing'].includes(pairedStatus)) {
    console.error(`[Withdrawal Worker] Refusing to broadcast ${withdrawal.id}: paired status ${pairedStatus || '(empty)'} is not dispatchable`);
    return { processed: false, withdrawalId: withdrawal.id, error: 'PAIRED_WITHDRAWAL_STATUS_NOT_DISPATCHABLE' };
  }

  const network = withdrawal.network || 'TRC20';
  const assetSymbol = (withdrawal.asset_symbol || 'USDT').toUpperCase().trim();
  const amountStr = withdrawal.amount.toString();
  const destination = withdrawal.to_address.trim();
  // Refund is allowed only after a successful durable-payload lookup proves
  // that no signed transaction exists for this withdrawal. Start fail-closed.
  let isLocalCheckStage = false;
  let reservedEvmNonce: number | null = null;
  // Retain the exact transaction hash if persistence or broadcast acknowledgement is uncertain.
  let broadcastTxHash = '';

  try {
    // A previously persisted signed transaction must be rebroadcast byte-for-byte.
    // Never sign a replacement when a durable payload already exists for this withdrawal.
    const { data: existingBroadcast, error: existingBroadcastError } = await supabaseAdmin
      .from('onchain_withdrawal_broadcasts')
      .select('network, signed_tx, tx_hash, nonce, status')
      .eq('withdrawal_id', withdrawal.id)
      .maybeSingle();

    if (existingBroadcastError) {
      throw new Error(`Unable to inspect durable withdrawal payload: ${existingBroadcastError.message}`);
    }

    if (existingBroadcast) {
      // The presence of any durable payload forbids a pre-broadcast refund,
      // even if its fields are malformed and require manual reconciliation.
      isLocalCheckStage = false;
      const persistedNetwork = normalizeNetworkCode(String(existingBroadcast.network || ''));
      const expectedNetwork = normalizeNetworkCode(network);
      const persistedHash = String(existingBroadcast.tx_hash || '');
      const persistedBytes = String(existingBroadcast.signed_tx || '');
      if (
        persistedNetwork !== expectedNetwork ||
        !persistedHash ||
        !persistedBytes ||
        !['READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED'].includes(String(existingBroadcast.status || '').toUpperCase())
      ) {
        throw new Error('Existing durable withdrawal payload is incomplete or does not match the claimed network');
      }

      broadcastTxHash = persistedHash;
      isLocalCheckStage = false;

      if (expectedNetwork === 'TRC20') {
        const signedTron = JSON.parse(persistedBytes) as Record<string, unknown>;
        const rebroadcast = await broadcastSignedTrc20Transfer(signedTron);
        if (rebroadcast.txHash.toLowerCase() !== persistedHash.toLowerCase()) {
          throw new Error('Rebroadcast TRON transaction ID does not match the persisted payload');
        }
      } else {
        const { provider } = getEvmHotWalletSigner(network);
        const rebroadcast = await provider.broadcastTransaction(persistedBytes);
        if (rebroadcast.hash.toLowerCase() !== persistedHash.toLowerCase()) {
          throw new Error('Rebroadcast EVM transaction hash does not match the persisted payload');
        }
      }

      const { data: recorded, error: recordError } = await supabaseAdmin.rpc('record_onchain_withdrawal_broadcast', {
        p_withdrawal_id: withdrawal.id,
        p_worker_id: workerId,
        p_tx_hash: persistedHash,
      });
      if (recordError || !recorded || recorded.success !== true) {
        throw new Error(`Persisted transaction rebroadcast but broadcast state was not recorded: ${recordError?.message || JSON.stringify(recorded)}`);
      }

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash: persistedHash,
        ...(existingBroadcast.nonce !== null ? { nonce: Number(existingBroadcast.nonce) } : {}),
        status: 'BROADCASTED',
      };
    }

    // A successful query returning no row is the only event that opens the
    // verified-unbroadcast refund path. Read errors and existing payload rows
    // leave the worker fail-closed.
    isLocalCheckStage = true;

    // BRANCH A: TRON Network (TRC-20 USDT)
    if (normalizeNetworkCode(network) === 'TRC20') {
      if (assetSymbol !== 'USDT' || !isValidTronAddress(destination)) {
        throw new Error('Only USDT TRC20 withdrawals to a valid TRON address are supported');
      }

      const prepared = await prepareSignedTrc20Transfer({
        toAddress: destination,
        amount: amountStr,
      });
      broadcastTxHash = prepared.txHash;
      // From this point onward, a DB timeout may have persisted the signed bytes.
      // Never automatically refund; preserve the reservation for exact-byte recovery.
      isLocalCheckStage = false;

      const { data: persisted, error: persistError } = await supabaseAdmin.rpc('persist_signed_onchain_withdrawal', {
        p_withdrawal_id: withdrawal.id,
        p_worker_id: workerId,
        p_network: 'TRC20',
        p_signed_tx: JSON.stringify(prepared.signedTransaction),
        p_tx_hash: prepared.txHash,
        p_nonce: null,
        p_signer_address: prepared.signerAddress,
      });
      if (persistError || !persisted || persisted.success !== true) {
        throw new Error(`TRON signed payload was not durably confirmed: ${persistError?.message || JSON.stringify(persisted)}`);
      }

      const sent = await broadcastSignedTrc20Transfer(prepared.signedTransaction);
      if (sent.txHash.toLowerCase() !== prepared.txHash.toLowerCase()) {
        throw new Error('TRON broadcast returned a different hash than the durable signed payload');
      }

      const { data: recorded, error: recordError } = await supabaseAdmin.rpc('record_onchain_withdrawal_broadcast', {
        p_withdrawal_id: withdrawal.id,
        p_worker_id: workerId,
        p_tx_hash: prepared.txHash,
      });
      if (recordError || !recorded || recorded.success !== true) {
        throw new Error(`TRON transaction ${prepared.txHash} broadcast but durable broadcast state was not recorded: ${recordError?.message || JSON.stringify(recorded)}`);
      }

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        txHash: prepared.txHash,
        status: 'BROADCASTED',
      };
    }

    // BRANCH B: EVM Networks (ERC20, BEP20)
    const normNet = normalizeNetworkCode(network);
    const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
    if (!chainConfig || !['USDT', 'ETH'].includes(assetSymbol)) {
      throw new Error(`Unsupported canonical withdrawal pair ${assetSymbol}/${network}`);
    }
    if (assetSymbol === 'ETH' && normNet !== 'ERC20') {
      throw new Error('Native ETH withdrawal is only supported on Ethereum ERC20 network');
    }

    const { provider, signer, address } = getEvmHotWalletSigner(network);
    if (!signer || !address) {
      throw new Error(`EVM hot-wallet signer is unavailable for ${network}`);
    }
    const actualChain = await provider.getNetwork();
    if (Number(actualChain.chainId) !== chainConfig.chainId) {
      throw new Error(`EVM RPC chain mismatch for ${network}: expected ${chainConfig.chainId}, received ${actualChain.chainId}`);
    }

    // Complete fallible quote/estimation work before reserving a sequential nonce.
    const feeOverrides = await getEip1559FeeOverrides(provider, 1.25);
    const isNativeTransfer = assetSymbol === chainConfig.nativeSymbol;
    let unsignedTx: ethers.TransactionRequest;

    if (isNativeTransfer) {
      const nativeValue = ethers.parseUnits(amountStr, chainConfig.nativeDecimals);
      const gasLimit = await provider.estimateGas({ from: address, to: destination, value: nativeValue });
      unsignedTx = {
        to: destination,
        value: nativeValue,
        gasLimit,
        chainId: chainConfig.chainId,
        ...feeOverrides,
      };
    } else {
      const contractAddress = getTokenContractAddress(network, assetSymbol);
      if (!contractAddress) {
        throw new Error(`No approved token contract configured for ${assetSymbol} on ${network}`);
      }
      const tokenInterface = new ethers.Interface(ERC20_ABI);
      const data = tokenInterface.encodeFunctionData('transfer', [
        destination,
        ethers.parseUnits(amountStr, getTokenDecimals(network, assetSymbol)),
      ]);
      const gasLimit = await provider.estimateGas({ from: address, to: contractAddress, data });
      unsignedTx = {
        to: contractAddress,
        data,
        gasLimit,
        chainId: chainConfig.chainId,
        ...feeOverrides,
      };
    }

    // Reserve only when all validation, fee quoting and gas estimation succeeded.
    // If signing fails after this point, retain the reservation and retry this same nonce.
    const nonce = await allocateEvmNonce(withdrawal.id, workerId, network, address, provider);
    reservedEvmNonce = nonce;
    const signedTransaction = await signer.signTransaction({ ...unsignedTx, nonce });
    const txHash = ethers.keccak256(signedTransaction);
    broadcastTxHash = txHash;
    // Persist the exact serialized signed bytes before any blockchain broadcast.
    isLocalCheckStage = false;

    const { data: persisted, error: persistError } = await supabaseAdmin.rpc('persist_signed_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_worker_id: workerId,
      p_network: normNet,
      p_signed_tx: signedTransaction,
      p_tx_hash: txHash,
      p_nonce: nonce,
      p_signer_address: address,
    });
    if (persistError || !persisted || persisted.success !== true) {
      throw new Error(`EVM signed payload was not durably confirmed: ${persistError?.message || JSON.stringify(persisted)}`);
    }

    const sent = await provider.broadcastTransaction(signedTransaction);
    if (sent.hash.toLowerCase() !== txHash.toLowerCase()) {
      throw new Error('EVM broadcast returned a different hash than the durable signed payload');
    }

    const { data: recorded, error: recordError } = await supabaseAdmin.rpc('record_onchain_withdrawal_broadcast', {
      p_withdrawal_id: withdrawal.id,
      p_worker_id: workerId,
      p_tx_hash: txHash,
    });
    if (recordError || !recorded || recorded.success !== true) {
      throw new Error(`EVM transaction ${txHash} broadcast but durable broadcast state was not recorded: ${recordError?.message || JSON.stringify(recorded)}`);
    }

    return {
      processed: true,
      withdrawalId: withdrawal.id,
      txHash,
      nonce,
      status: 'BROADCASTED',
    };

  } catch (err: any) {
    console.error(`[Withdrawal Worker] Failed dispatching withdrawal ${withdrawal.id}:`, err);

    if (isLocalCheckStage && String(err?.message || '').startsWith('HOT_WALLET_NONCE_STREAM_BUSY:')) {
      // Another operation owns the preceding nonce on this same hot wallet.
      // Keep this withdrawal queued for lease-based retry; do not refund funds.
      return {
        processed: false,
        withdrawalId: withdrawal.id,
        status: 'NONCE_STREAM_WAITING',
        error: String(err.message).slice(0, 1000),
      };
    }

    if (isLocalCheckStage) {
      // The nonce RPC may have committed even if its response was lost. Inspect the
      // durable reservation before refunding; an unsigned reserved EVM nonce must
      // be retried byte-for-byte at the same nonce, never silently discarded.
      if (['ERC20', 'BEP20'].includes(normalizeNetworkCode(network))) {
        const { data: nonceReservation, error: nonceReservationError } = await supabaseAdmin
          .from('onchain_withdrawal_nonce_reservations')
          .select('nonce, status')
          .eq('withdrawal_id', withdrawal.id)
          .maybeSingle();
        if (nonceReservationError) {
          console.error(`[Withdrawal Worker] Cannot verify nonce reservation for ${withdrawal.id}; refund withheld:`, nonceReservationError.message);
          return {
            processed: false,
            withdrawalId: withdrawal.id,
            ...(reservedEvmNonce !== null ? { nonce: reservedEvmNonce } : {}),
            status: 'NONCE_RESERVATION_CHECK_REQUIRED',
            error: 'Nonce reservation state could not be verified; funds remain reserved.',
          };
        }
        if (nonceReservation) {
          const reservationStatus = String(nonceReservation.status || '').toUpperCase();
          const originalError = String(err?.message || 'Unknown nonce allocation error');
          const nonceNeedsManualReconciliation =
            /already consumed on-chain|no longer unsigned|exact durable transaction recovery is required/i.test(originalError);
          const canRetrySameReservedNonce =
            reservationStatus === 'RESERVED' && !nonceNeedsManualReconciliation;
          console.warn(`[Withdrawal Worker] Preserving EVM nonce ${nonceReservation.nonce} for ${withdrawal.id} in ${reservationStatus}; automatic refund blocked pending exact-nonce retry/reconciliation.`);
          return {
            processed: false,
            withdrawalId: withdrawal.id,
            nonce: Number(nonceReservation.nonce),
            status: canRetrySameReservedNonce ? 'NONCE_RESERVED_RETRY' : 'NONCE_RESERVATION_RECONCILIATION_REQUIRED',
            error: `Nonce reservation remains ${reservationStatus}; ${nonceNeedsManualReconciliation ? 'the chain reports this nonce is already consumed or its signed state is inconsistent, so operator reconciliation is required. ' : 'funds stay reserved and the nonce must not be reused. '}Original error: ${originalError}`,
          };
        }
      }

      console.warn(`[Withdrawal Worker] Pre-broadcast validation failure: refunding withdrawal ${withdrawal.id}`);
      try {
        const { data: refundData, error: refundError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
          p_withdrawal_id: withdrawal.id,
          p_error_reason: err.message || 'Transaction pre-broadcast validation failure',
          p_actual_gas_amount: 0,
          p_gas_asset: null,
          p_is_verified_unbroadcast: true,
        });
        if (refundError || !refundData || refundData.success !== true) {
          throw new Error(refundError?.message || 'Refund RPC did not confirm successful settlement');
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
          processed: false,
          withdrawalId: withdrawal.id,
          status: 'REFUND_PENDING_RECONCILIATION',
          error: `Pre-broadcast failure; refund was not confirmed and funds may remain reserved. Manual reconciliation required. Original error: ${err.message}`,
        };
      }
    } else {
      // A durable-payload read failure or malformed persisted record may leave
      // the transaction hash unknown to this process. Never invent an ambiguity
      // transition with an empty hash, and never attempt an unbroadcast refund.
      if (!broadcastTxHash) {
        console.error(`[Withdrawal Worker] Durable signed payload state is unverified for ${withdrawal.id}; funds remain reserved for reconciliation.`);
        return {
          processed: false,
          withdrawalId: withdrawal.id,
          status: 'DURABLE_PAYLOAD_RECONCILIATION_REQUIRED',
          error: 'The signed transaction state could not be verified. No automatic refund or replacement transaction was attempted.',
        };
      }

      console.warn(`[Withdrawal Worker] Ambiguous broadcast result for withdrawal ${withdrawal.id}. Transitioning to AMBIGUOUS_BROADCAST and preserving funds reservation.`);
      try {
        const { data: ambiguousData, error: ambiguousError } = await supabaseAdmin.rpc('mark_withdrawal_ambiguous_broadcast', {
          p_withdrawal_id: withdrawal.id,
          p_worker_id: workerId,
          p_tx_hash: broadcastTxHash,
          p_error_reason: `Ambiguous broadcast error: ${err.message}`,
        });
        if (ambiguousError || !ambiguousData || ambiguousData.success !== true) {
          throw new Error(ambiguousError?.message || 'Atomic ambiguous-broadcast RPC did not confirm success');
        }
      } catch (statusErr) {
        // Funds remain reserved. Do not attempt an automatic refund when broadcast outcome is uncertain.
        console.error(`[Withdrawal Worker] Atomic AMBIGUOUS_BROADCAST transition failed for ${withdrawal.id}; manual reconciliation required:`, statusErr);
      }

      return {
        processed: true,
        withdrawalId: withdrawal.id,
        ...(broadcastTxHash ? { txHash: broadcastTxHash } : {}),
        status: 'AMBIGUOUS_BROADCAST',
        error: `Ambiguous broadcast error: ${err.message}. Funds remain reserved in in_withdrawal pending manual/reconciliation resolution.`,
      };
    }
  }
}

type VerifiedEvmWithdrawalReceiptProof = Extract<
  Awaited<ReturnType<typeof getFinalizedEvmWithdrawalReceiptProof>>,
  { verified: true }
>;

async function persistEvmWithdrawalReceiptProof(
  withdrawalId: string,
  proof: VerifiedEvmWithdrawalReceiptProof
): Promise<void> {
  const { data: durable, error: durableError } = await supabaseAdmin
    .from('onchain_withdrawal_broadcasts')
    .select('network, signed_tx, tx_hash, nonce, status')
    .eq('withdrawal_id', withdrawalId)
    .maybeSingle();
  if (durableError || !durable || !durable.signed_tx || !durable.tx_hash) {
    throw new Error(`Durable EVM signed withdrawal payload is unavailable: ${durableError?.message || 'missing broadcast row or signed bytes'}`);
  }
  const signedBytes = String(durable.signed_tx);
  const parsedSignedTransaction = ethers.Transaction.from(signedBytes);
  const signedHash = ethers.keccak256(signedBytes);
  if (
    normalizeNetworkCode(String(durable.network || '')) !== proof.network ||
    String(durable.tx_hash).toLowerCase() !== proof.txHash.toLowerCase() ||
    signedHash.toLowerCase() !== proof.txHash.toLowerCase() ||
    !['READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'].includes(String(durable.status || '').toUpperCase()) ||
    durable.nonce === null || durable.nonce === undefined ||
    Number(durable.nonce) !== proof.transactionNonce ||
    parsedSignedTransaction.nonce !== proof.transactionNonce ||
    parsedSignedTransaction.chainId !== BigInt(proof.chainId) ||
    parsedSignedTransaction.from?.toLowerCase() !== proof.signerAddress.toLowerCase()
  ) {
    throw new Error('Persisted EVM signed bytes, hash, chain, signer or nonce do not match the finalized receipt proof');
  }

  const { data, error } = await supabaseAdmin.rpc('record_evm_withdrawal_receipt_proof', {
    p_withdrawal_id: withdrawalId,
    p_network: proof.network,
    p_tx_hash: proof.txHash,
    p_receipt_status: proof.receiptStatus,
    p_chain_id: proof.chainId,
    p_transaction_nonce: proof.transactionNonce,
    p_signer_address: proof.signerAddress,
    p_block_number: proof.blockNumber,
    p_block_hash: proof.blockHash,
    p_confirmations: proof.confirmations,
    p_gas_used: proof.gasUsed,
    p_effective_gas_price: proof.effectiveGasPrice,
  });
  if (error || !data || data.success !== true) {
    throw new Error(`EVM withdrawal receipt proof could not be persisted: ${error?.message || data?.message || 'RPC did not confirm success'}`);
  }
}

async function recordEvmWithdrawalNonceIncident(params: {
  withdrawalId: string;
  network: string;
  walletAddress: string;
  expectedNonce: number;
  expectedTxHash: string;
  observedLatestNonce: number;
  observedPendingNonce: number;
  reason: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('record_evm_withdrawal_nonce_incident', {
    p_withdrawal_id: params.withdrawalId,
    p_network: params.network,
    p_wallet_address: params.walletAddress,
    p_expected_nonce: params.expectedNonce,
    p_expected_tx_hash: params.expectedTxHash,
    p_observed_latest_nonce: params.observedLatestNonce,
    p_observed_pending_nonce: params.observedPendingNonce,
    p_reason: params.reason.slice(0, 1000),
  });
  if (error || !data || data.success !== true) {
    throw new Error(`EVM nonce incident could not be persisted: ${error?.message || data?.message || 'RPC did not confirm success'}`);
  }
}

async function invalidateEvmWithdrawalReceiptProof(
  withdrawalId: string,
  network: string,
  txHash: string,
  reason: string
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('invalidate_evm_withdrawal_receipt_proof', {
    p_withdrawal_id: withdrawalId,
    p_network: network,
    p_tx_hash: txHash,
    p_reason: reason.slice(0, 1000),
  });
  if (error || !data || data.success !== true) {
    throw new Error(`EVM receipt proof invalidation failed: ${error?.message || data?.message || 'RPC did not confirm success'}`);
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
      .lte('next_confirmation_check_at', new Date().toISOString())
      .order('next_confirmation_check_at', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(30);

    if (error) {
      console.error('[Withdrawal Worker] Failed to load submitted withdrawals for confirmation:', error.message);
      return { checked: 0, confirmed: 0 };
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      return { checked: 0, confirmed: 0 };
    }

    checked = pendingTxs.length;

    for (const w of pendingTxs) {
      // Schedule the next check before network I/O so persistently unconfirmed transactions
      // do not monopolize the first page. Do not touch updated_at: orphan detection uses it.
      const nextCheckAt = new Date(Date.now() + 60_000).toISOString();
      const { data: scheduled, error: scheduleError } = await supabaseAdmin.rpc('schedule_withdrawal_confirmation_check', {
        p_withdrawal_id: w.id,
        p_tx_hash: w.tx_hash,
        p_next_check_at: nextCheckAt,
      });
      if (scheduleError || scheduled !== true) {
        console.error(`[Withdrawal Worker] Failed scheduling next confirmation check for ${w.id}:`, scheduleError?.message || 'RPC did not confirm schedule');
        continue;
      }

      const normNet = normalizeNetworkCode(w.network);

      if (normNet === 'TRC20') {
        const { isConfirmed, confirmations, success, actualCostTrx, blockNumber } = await getTronTransactionConfirmations(w.tx_hash);

        if (isConfirmed && success) {
          // A successful transaction receipt alone does not prove this was the
          // requested payout. Verify the confirmed canonical USDT Transfer event.
          if (!blockNumber || !/^[a-fA-F0-9]{64}$/.test(String(w.tx_hash || ''))) {
            console.error(`[Withdrawal Worker] TRON payout evidence unavailable for ${w.id}; settlement withheld`);
            continue;
          }
          const tronWeb = getTronWeb(true);
          const privateKey = tronWeb.defaultPrivateKey;
          const expectedSender = privateKey ? tronWeb.address.fromPrivateKey(privateKey) : false;
          if (!expectedSender) {
            console.error(`[Withdrawal Worker] TRON hot-wallet address unavailable for ${w.id}; settlement withheld`);
            continue;
          }
          const eventUrl = `${TRON_CONFIG.fullHost.replace(/\/$/, '')}/v1/transactions/${encodeURIComponent(w.tx_hash)}/events?only_confirmed=true`;
          const eventHeaders: Record<string, string> = {};
          if (TRON_CONFIG.apiKey) eventHeaders['TRON-PRO-API-KEY'] = TRON_CONFIG.apiKey;
          let eventResponse: Response;
          let eventPayload: unknown;
          try {
            eventResponse = await fetch(eventUrl, { headers: eventHeaders, signal: AbortSignal.timeout(8000) });
            if (!eventResponse.ok) throw new Error(`TRON event API returned HTTP ${eventResponse.status}`);
            eventPayload = await eventResponse.json();
          } catch (eventError) {
            console.error(`[Withdrawal Worker] TRON confirmed event lookup failed for ${w.id}; settlement withheld:`, eventError instanceof Error ? eventError.message : 'unknown error');
            continue;
          }
          const { verifyTronWithdrawalEvidence } = await import('@/lib/blockchain/verify-tron-withdrawal');
          const payoutEvidence = verifyTronWithdrawalEvidence({
            txHash: String(w.tx_hash),
            destinationAddress: String(w.to_address || ''),
            expectedAmount: w.amount,
            expectedSender,
            blockNumber,
            tokenContract: TRON_CONFIG.usdtContract,
            events: eventPayload,
          });
          if (!payoutEvidence.verified) {
            console.error(`[Withdrawal Worker] TRON payout evidence rejected for ${w.id}: ${payoutEvidence.reason}; settlement withheld`);
            continue;
          }
          const actualTrxStr = actualCostTrx && actualCostTrx.trim().length > 0 ? actualCostTrx.trim() : '0';
          const { data: settlementData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualTrxStr,
            p_gas_asset: 'TRX',
          });
          if (confErr || !settlementData || settlementData.success !== true) {
            console.error(`[Withdrawal Worker] TRON settlement not confirmed for ${w.id}:`, confErr?.message || settlementData);
          } else {
            confirmed++;
          }
        } else if (success === false && confirmations >= TRON_CONFIG.requiredConfirmations) {
          // A reverted TRON receipt can be orphaned; do not refund before solid-block depth.
          const measuredTrx = Number(actualCostTrx || 0);
          if (!Number.isFinite(measuredTrx) || measuredTrx <= 0) {
            console.error(`[Withdrawal Worker] TRON revert gas cost is unavailable for ${w.id}; refund held for reconciliation`);
            continue;
          }
          const { data: refundData, error: refundError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: 'TRON transaction reverted on-chain',
            p_actual_gas_amount: measuredTrx,
            p_gas_asset: 'TRX',
            p_is_verified_unbroadcast: true,
          });
          if (refundError || !refundData || refundData.success !== true) {
            console.error(`[Withdrawal Worker] TRON revert refund not confirmed for ${w.id}:`, refundError?.message || refundData);
          }
        }
      } else if (SUPPORTED_EVM_CHAINS[normNet]) {
        const chain = SUPPORTED_EVM_CHAINS[normNet];
        const provider = getEvmProvider(normNet);
        const { confirmations, status } = await getTransactionConfirmations(provider, w.tx_hash);
        const gasAsset = normNet === 'BEP20' ? 'BNB' : 'ETH';

        if (confirmations < chain.requiredConfirmations || (status !== 0 && status !== 1)) {
          if (
            status === undefined &&
            confirmations === 0 &&
            Number.isSafeInteger(Number(w.nonce)) &&
            Number(w.nonce) >= 0
          ) {
            try {
              const hotWallet = getEvmHotWalletSigner(normNet);
              const [expectedTransaction, expectedReceipt] = await Promise.all([
                provider.getTransaction(w.tx_hash),
                provider.getTransactionReceipt(w.tx_hash),
              ]);
              if (hotWallet.address && !expectedTransaction && !expectedReceipt) {
                const [latestNonce, pendingNonce] = await Promise.all([
                  provider.getTransactionCount(hotWallet.address, 'latest'),
                  provider.getTransactionCount(hotWallet.address, 'pending'),
                ]);
                const expectedNonce = Number(w.nonce);
                if (
                  Number.isSafeInteger(latestNonce) &&
                  Number.isSafeInteger(pendingNonce) &&
                  (latestNonce > expectedNonce || pendingNonce > expectedNonce)
                ) {
                  await recordEvmWithdrawalNonceIncident({
                    withdrawalId: w.id,
                    network: normNet,
                    walletAddress: hotWallet.address,
                    expectedNonce,
                    expectedTxHash: String(w.tx_hash),
                    observedLatestNonce: latestNonce,
                    observedPendingNonce: pendingNonce,
                    reason: 'Persisted withdrawal transaction and receipt are unavailable while the shared hot-wallet nonce has advanced.',
                  });
                  console.error(
                    `[Withdrawal Worker] EVM nonce incident recorded for ${w.id}; withdrawal and nonce reservations remain locked for manual reconciliation.`
                  );
                }
              }
            } catch (incidentError) {
              console.error(
                `[Withdrawal Worker] Could not record EVM nonce incident for ${w.id}; funds remain reserved:`,
                incidentError
              );
            }
          }

          try {
            await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, 'Receipt missing, non-canonical, or below finality threshold on latest confirmation pass');
          } catch (invalidationError) {
            console.error(`[Withdrawal Worker] Could not invalidate stale EVM receipt proof for ${w.id}:`, invalidationError);
          }
          continue;
        }

        // A missing/unknown receipt status is not proof of success; only an explicit
        // EVM receipt status of 1 may release the reserved withdrawal liability.
        if (confirmations >= chain.requiredConfirmations && status === 1) {
          const hotWallet = getEvmHotWalletSigner(normNet);
          if (!hotWallet.address || w.nonce === null || w.nonce === undefined || !Number.isSafeInteger(Number(w.nonce))) {
            try {
              await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, 'Hot-wallet signer or durable nonce identity unavailable during finality recheck');
            } catch (invalidationError) {
              console.error(`[Withdrawal Worker] Could not invalidate EVM proof with missing signer/nonce for ${w.id}:`, invalidationError);
            }
            console.error(`[Withdrawal Worker] EVM signer/nonce identity unavailable for ${w.id}; settlement withheld`);
            continue;
          }
          const evidence = await verifyEvmWithdrawalEvidence({
            provider,
            txHash: w.tx_hash,
            network: normNet,
            assetSymbol: String(w.asset_symbol || ''),
            destinationAddress: String(w.to_address || ''),
            amount: w.amount,
            expectedSender: hotWallet.address,
          });
          if (!evidence.verified) {
            try {
              await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, `Payout evidence rejected: ${evidence.reason}`);
            } catch (invalidationError) {
              console.error(`[Withdrawal Worker] Could not invalidate rejected EVM receipt proof for ${w.id}:`, invalidationError);
            }
            console.error(`[Withdrawal Worker] EVM payout evidence rejected for ${w.id}: ${evidence.reason}; settlement withheld`);
            continue;
          }
          const receiptProof = await getFinalizedEvmWithdrawalReceiptProof({
            provider,
            txHash: w.tx_hash,
            network: normNet,
            expectedSender: hotWallet.address,
            expectedNonce: Number(w.nonce),
          });
          if (!receiptProof.verified || receiptProof.receiptStatus !== 1) {
            try {
              await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, `Success receipt proof revalidation failed: ${receiptProof.verified ? 'receipt status changed' : receiptProof.reason}`);
            } catch (invalidationError) {
              console.error(`[Withdrawal Worker] Could not invalidate stale EVM success proof for ${w.id}:`, invalidationError);
            }
            console.error(`[Withdrawal Worker] EVM success receipt proof rejected for ${w.id}: ${receiptProof.verified ? 'receipt status changed' : receiptProof.reason}; settlement withheld`);
            continue;
          }
          try {
            await persistEvmWithdrawalReceiptProof(w.id, receiptProof);
          } catch (proofError) {
            console.error(`[Withdrawal Worker] EVM success receipt proof not persisted for ${w.id}; settlement withheld:`, proofError);
            continue;
          }
          const actualGasStr = receiptProof.actualGasAmount;
          const { data: settlementData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
            p_withdrawal_id: w.id,
            p_tx_hash: w.tx_hash,
            p_actual_gas_amount: actualGasStr,
            p_gas_asset: gasAsset,
          });
          if (confErr || !settlementData || settlementData.success !== true) {
            console.error(`[Withdrawal Worker] EVM settlement not confirmed for ${w.id}:`, confErr?.message || settlementData);
          } else {
            confirmed++;
          }
        } else if (status === 0 && confirmations >= chain.requiredConfirmations) {
          // A reverted receipt can be reorged just like a successful receipt.
          // Persist canonical receipt, signer and nonce evidence before refunding.
          const hotWallet = getEvmHotWalletSigner(normNet);
          if (!hotWallet.address || w.nonce === null || w.nonce === undefined || !Number.isSafeInteger(Number(w.nonce))) {
            try {
              await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, 'Hot-wallet signer or durable nonce identity unavailable during revert finality recheck');
            } catch (invalidationError) {
              console.error(`[Withdrawal Worker] Could not invalidate EVM revert proof with missing signer/nonce for ${w.id}:`, invalidationError);
            }
            console.error(`[Withdrawal Worker] EVM signer/nonce identity unavailable for reverted withdrawal ${w.id}; refund held`);
            continue;
          }
          const receiptProof = await getFinalizedEvmWithdrawalReceiptProof({
            provider,
            txHash: w.tx_hash,
            network: normNet,
            expectedSender: hotWallet.address,
            expectedNonce: Number(w.nonce),
          });
          if (!receiptProof.verified || receiptProof.receiptStatus !== 0) {
            try {
              await invalidateEvmWithdrawalReceiptProof(w.id, normNet, w.tx_hash, `Revert receipt proof revalidation failed: ${receiptProof.verified ? 'receipt status changed' : receiptProof.reason}`);
            } catch (invalidationError) {
              console.error(`[Withdrawal Worker] Could not invalidate stale EVM revert proof for ${w.id}:`, invalidationError);
            }
            console.error(`[Withdrawal Worker] EVM revert receipt proof rejected for ${w.id}: ${receiptProof.verified ? 'receipt status changed' : receiptProof.reason}; refund held`);
            continue;
          }
          try {
            await persistEvmWithdrawalReceiptProof(w.id, receiptProof);
          } catch (proofError) {
            console.error(`[Withdrawal Worker] EVM revert receipt proof not persisted for ${w.id}; refund withheld:`, proofError);
            continue;
          }
          const measuredGas = receiptProof.actualGasAmount;
          const { data: refundData, error: refundError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: w.id,
            p_error_reason: `EVM transaction reverted on-chain on network ${w.network}`,
            p_actual_gas_amount: measuredGas,
            p_gas_asset: gasAsset,
            p_is_verified_unbroadcast: true,
          });
          if (refundError || !refundData || refundData.success !== true) {
            console.error(`[Withdrawal Worker] EVM revert refund not confirmed for ${w.id}:`, refundError?.message || refundData);
          }
        }
      } else if (normNet === 'BTC') {
        try {
          const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
          const res = await fetch(`${btcApiBase}/tx/${w.tx_hash}`);
          if (res.ok) {
            const txData = await res.json();
            if (!bitcoinLikePayoutMatches(txData, w.tx_hash, w.to_address, w.amount)) {
              console.error(`[Withdrawal Worker] BTC/LTC payout mismatch for ${w.id}; settlement withheld`);
              continue;
            }
            const tipRes = await fetch(`${btcApiBase}/blocks/tip/height`);
            const tipText = tipRes.ok ? (await tipRes.text()).trim() : '';
            const tipHeight = /^\d+$/.test(tipText) ? Number(tipText) : NaN;
            const requiredConfirmations = Number.parseInt(process.env.BTC_REQUIRED_CONFIRMATIONS || '3', 10);
            if (txData && txData.status?.confirmed === true && hasRequiredConfirmations(txData.status.block_height, tipHeight, requiredConfirmations) && Number.isSafeInteger(txData.fee) && txData.fee >= 0) {
              let actualFeeBtc = '0';
              if (typeof txData.fee === 'number' && txData.fee >= 0) {
                const feeSat = BigInt(txData.fee);
                const whole = feeSat / 100000000n;
                const fraction = (feeSat % 100000000n).toString().padStart(8, '0');
                actualFeeBtc = `${whole}.${fraction}`;
              } else if (Array.isArray(txData.vin) && Array.isArray(txData.vout)) {
                const btcInputs = txData.vin as Array<{ prevout?: { value?: number | string | bigint } }>;
                const btcOutputs = txData.vout as Array<{ value?: number | string | bigint }>;
                const inputSumSat = btcInputs.reduce((acc: bigint, v) => acc + BigInt(v.prevout?.value ?? 0), 0n);
                const outputSumSat = btcOutputs.reduce((acc: bigint, v) => acc + BigInt(v.value ?? 0), 0n);
                if (inputSumSat >= outputSumSat) {
                  const feeSat = inputSumSat - outputSumSat;
                  const whole = feeSat / 100000000n;
                  const fraction = (feeSat % 100000000n).toString().padStart(8, '0');
                  actualFeeBtc = `${whole}.${fraction}`;
                }
              }

              const { data: settlementData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
                p_actual_gas_amount: actualFeeBtc,
                p_gas_asset: 'BTC',
              });
              if (confErr || !settlementData || settlementData.success !== true) {
                console.error(`[Withdrawal Worker] BTC settlement not confirmed for ${w.id}:`, confErr?.message || settlementData);
              } else {
                confirmed++;
              }
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
            if (!bitcoinLikePayoutMatches(txData, w.tx_hash, w.to_address, w.amount)) {
              console.error(`[Withdrawal Worker] BTC/LTC payout mismatch for ${w.id}; settlement withheld`);
              continue;
            }
            const tipRes = await fetch(`${ltcApiBase}/blocks/tip/height`);
            const tipText = tipRes.ok ? (await tipRes.text()).trim() : '';
            const tipHeight = /^\d+$/.test(tipText) ? Number(tipText) : NaN;
            const requiredConfirmations = Number.parseInt(process.env.LTC_REQUIRED_CONFIRMATIONS || '6', 10);
            if (txData && txData.status?.confirmed === true && hasRequiredConfirmations(txData.status.block_height, tipHeight, requiredConfirmations) && Number.isSafeInteger(txData.fee) && txData.fee >= 0) {
              let actualFeeLtc = '0';
              if (typeof txData.fee === 'number' && txData.fee >= 0) {
                const feeLit = BigInt(txData.fee);
                const whole = feeLit / 100000000n;
                const fraction = (feeLit % 100000000n).toString().padStart(8, '0');
                actualFeeLtc = `${whole}.${fraction}`;
              } else if (Array.isArray(txData.vin) && Array.isArray(txData.vout)) {
                const ltcInputs = txData.vin as Array<{ prevout?: { value?: number | string | bigint } }>;
                const ltcOutputs = txData.vout as Array<{ value?: number | string | bigint }>;
                const inputSumLit = ltcInputs.reduce((acc: bigint, v) => acc + BigInt(v.prevout?.value ?? 0), 0n);
                const outputSumLit = ltcOutputs.reduce((acc: bigint, v) => acc + BigInt(v.value ?? 0), 0n);
                if (inputSumLit >= outputSumLit) {
                  const feeLit = inputSumLit - outputSumLit;
                  const whole = feeLit / 100000000n;
                  const fraction = (feeLit % 100000000n).toString().padStart(8, '0');
                  actualFeeLtc = `${whole}.${fraction}`;
                }
              }

              const { data: settlementData, error: confErr } = await supabaseAdmin.rpc('complete_onchain_withdrawal', {
                p_withdrawal_id: w.id,
                p_tx_hash: w.tx_hash,
                p_actual_gas_amount: actualFeeLtc,
                p_gas_asset: 'LTC',
              });
              if (confErr || !settlementData || settlementData.success !== true) {
                console.error(`[Withdrawal Worker] LTC settlement not confirmed for ${w.id}:`, confErr?.message || settlementData);
              } else {
                confirmed++;
              }
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
 * Enforces a PostgreSQL owner-token lease to coordinate independent worker instances
 */
export async function processAllPendingWithdrawals(maxBatch: number = 20): Promise<{
  totalProcessed: number;
  results: WithdrawalProcessResult[];
  locked?: boolean;
}> {
  // The canonical claim RPC performs SKIP LOCKED plus a per-withdrawal
  // worker_id/lease_expires_at fence. A process-wide advisory lease is not
  // safe across independent PostgREST database sessions and is not required.
  const batchLimit = Number.isSafeInteger(maxBatch) && maxBatch > 0
    ? Math.min(maxBatch, 100)
    : 20;
  const workerId = randomUUID();
  const results: WithdrawalProcessResult[] = [];
  let count = 0;

  while (count < batchLimit) {
    const result = await processWithdrawalQueue(workerId);
    if (!result.processed) break;
    results.push(result);
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

