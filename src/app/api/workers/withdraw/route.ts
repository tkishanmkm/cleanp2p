import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import * as TronWebLib from 'tronweb';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export interface WithdrawalRequestPayload {
  withdrawalId?: string;
  asset: 'BTC' | 'ETH' | 'LTC' | 'USDT' | string;
  network: 'BTC' | 'ERC20' | 'BEP20' | 'TRC20' | 'LTC' | 'TRON' | string;
  toAddress: string;
  amount: string | number;
}

export interface WithdrawalExecutionResult {
  withdrawalId?: string;
  asset: string;
  network: string;
  toAddress: string;
  amount: string | number;
  txHash: string;
  status: 'BROADCASTED' | 'FAILED';
  gasUsedEstimated?: string;
  providerUsed: string;
  error?: string;
}

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
];

function getAdminClient() {
  return getSupabaseAdminClient();
}

async function recordBroadcast(supabase: ReturnType<typeof getAdminClient>, withdrawalId: string, txHash: string) {
  const { error: onchainError } = await supabase
    .from('onchain_withdrawals')
    .update({ status: 'BROADCASTED', tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq('id', withdrawalId);
  if (onchainError) throw new Error(`Could not persist on-chain broadcast: ${onchainError.message}`);

  const { error: withdrawalError } = await supabase
    .from('withdrawals')
    .update({ status: 'BROADCASTED', tx_hash: txHash, txid: txHash, broadcasted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', withdrawalId);
  if (withdrawalError) throw new Error(`Could not persist withdrawal broadcast: ${withdrawalError.message}`);
}

async function markAmbiguousBroadcast(supabase: ReturnType<typeof getAdminClient>, withdrawalId: string, txHash: string, message: string) {
  const [onchainResult, withdrawalResult] = await Promise.all([
    supabase.from('onchain_withdrawals')
      .update({ status: 'AMBIGUOUS_BROADCAST', tx_hash: txHash, error_message: message, updated_at: new Date().toISOString() })
      .eq('id', withdrawalId),
    supabase.from('withdrawals')
      .update({ status: 'AMBIGUOUS_BROADCAST', tx_hash: txHash, txid: txHash, broadcast_error: message, updated_at: new Date().toISOString() })
      .eq('id', withdrawalId),
  ]);
  if (onchainResult.error || withdrawalResult.error) {
    console.error('[Withdrawal Worker] Could not persist ambiguous broadcast state', {
      withdrawalId, onchainError: onchainResult.error?.message, withdrawalError: withdrawalResult.error?.message,
    });
  }
}

function getEvmRpcUrl(network: string): { url: string; providerName: string } {
  const normNet = network.toUpperCase();

  if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') {
    const bscUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    return { url: bscUrl, providerName: 'BNB Smart Chain RPC' };
  }

  const ethUrl =
    process.env.ETH_RPC_URL ||
    process.env.EVM_RPC_URL ||
    'https://cloudflare-eth.com';

  return { url: ethUrl, providerName: 'Ethereum Mainnet RPC' };
}

async function processEvmWithdrawal(
  toAddress: string,
  amount: string,
  asset: string,
  network: string
): Promise<{ txHash: string; gasEstimated: string; providerUsed: string }> {
  const rawKey =
    process.env.EVM_HOT_WALLET_PRIVATE_KEY ||
    process.env.HOT_WALLET_PRIVATE_KEY ||
    '';

  if (!rawKey) {
    throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is missing');
  }

  const formattedKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
  const { url: rpcUrl, providerName } = getEvmRpcUrl(network);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(formattedKey, provider);
  const normAsset = asset.toUpperCase();
  const normNet = network.toUpperCase();

  // 1. Native ETH
  if (normAsset === 'ETH') {
    const value = ethers.parseEther(amount);
    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({ to: toAddress, value }).catch(() => 21000n);

    const tx = await wallet.sendTransaction({
      to: toAddress,
      value,
      gasLimit: (BigInt(gasEstimate) * 120n) / 100n,
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    return { txHash: tx.hash, gasEstimated: gasEstimate.toString(), providerUsed: providerName };
  }

  // 2. Token Transfers: USDT ERC-20 or USDT BEP-20
  let tokenContractAddress = '';
  let decimals = 6;
  if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') {
    tokenContractAddress =
      process.env.USDT_CONTRACT_BEP20 ||
      '0x55d398326f99059fF775485246999027B3197955';
    decimals = 18;
  } else {
    tokenContractAddress =
      process.env.USDT_CONTRACT_ERC20 ||
      '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    decimals = 6;
  }

  const contract = new ethers.Contract(tokenContractAddress, ERC20_ABI, wallet);
  try {
    decimals = await contract.decimals();
  } catch {}

  const parsedAmount = ethers.parseUnits(amount, decimals);
  const gasEstimate = await contract.transfer.estimateGas(toAddress, parsedAmount).catch(() => 65000n);

  const tx = await contract.transfer(toAddress, parsedAmount, {
    gasLimit: (BigInt(gasEstimate) * 125n) / 100n,
  });

  return { txHash: tx.hash, gasEstimated: gasEstimate.toString(), providerUsed: `${providerName} (Smart Contract)` };
}

async function processTronWithdrawal(
  toAddress: string,
  amount: string
): Promise<{ txHash: string; gasEstimated: string; providerUsed: string }> {
  const rawKey = process.env.TRON_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_TRON_PRIVATE_KEY || '';
  if (!rawKey) {
    throw new Error('TRON_HOT_WALLET_PRIVATE_KEY is missing');
  }

  const cleanKey = rawKey.replace(/^0x/, '');
  const rpcUrl = process.env.TRON_RPC_URL || 'https://api.trongrid.io';

  const TronWebClass: any =
    (TronWebLib as any).TronWeb ||
    (TronWebLib as any).default ||
    TronWebLib;

  const tronWeb = new TronWebClass({
    fullHost: rpcUrl,
    privateKey: cleanKey,
  });

  // USDT TRC-20
  const contractAddress =
    process.env.USDT_CONTRACT_TRC20 ||
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  const contract = await tronWeb.contract().at(contractAddress);
  const parsedSun = Math.floor(parseFloat(amount) * 1_000_000);
  const tx = await contract.transfer(toAddress, parsedSun).send({
    feeLimit: 50_000_000,
  });

  const txHash = typeof tx === 'string' ? tx : tx?.transaction?.txID || tx?.txid || tx?.txID;
  if (!txHash) throw new Error(`TRC-20 transaction failed: ${JSON.stringify(tx)}`);

  return { txHash, gasEstimated: '32000 Energy', providerUsed: 'TRON TRC-20 JSON-RPC' };
}

async function processBtcWithdrawal(
  toAddress: string,
  amount: string
): Promise<{ txHash: string; gasEstimated: string; providerUsed: string }> {
  const privateKey = process.env.BTC_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_BTC_PRIVATE_KEY || '';
  if (!privateKey) throw new Error('BTC_HOT_WALLET_PRIVATE_KEY is missing');

  const btcRpc = process.env.BTC_RPC_URL;
  if (btcRpc) {
    try {
      const res = await fetch(btcRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '1.0',
          id: 'worker-withdraw-btc',
          method: 'sendtoaddress',
          params: [toAddress, parseFloat(amount)],
        }),
      });
      const data = await res.json();
      if (data.result) {
        return { txHash: data.result, gasEstimated: '141 vB', providerUsed: 'Bitcoin JSON-RPC' };
      }
    } catch {
      // Fallback
    }
  }

  throw new Error('Bitcoin RPC or mempool provider required for on-chain broadcast');
}

async function processLtcWithdrawal(
  toAddress: string,
  amount: string
): Promise<{ txHash: string; gasEstimated: string; providerUsed: string }> {
  const privateKey = process.env.LTC_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_LTC_PRIVATE_KEY || '';
  if (!privateKey) throw new Error('LTC_HOT_WALLET_PRIVATE_KEY is missing');

  const ltcRpc = process.env.LTC_RPC_URL;
  if (ltcRpc) {
    try {
      const res = await fetch(ltcRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '1.0',
          id: 'worker-withdraw-ltc',
          method: 'sendtoaddress',
          params: [toAddress, parseFloat(amount)],
        }),
      });
      const data = await res.json();
      if (data.result) {
        return { txHash: data.result, gasEstimated: '140 vB', providerUsed: 'Litecoin Generic JSON-RPC' };
      }
    } catch {
      // Fallback
    }
  }

  throw new Error('Litecoin RPC or mempool provider required for on-chain broadcast');
}

export async function POST(req: NextRequest) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [
        process.env.WITHDRAWAL_WORKER_SECRET,
        process.env.WORKER_SECRET,
      ],
      customHeaderNames: ['x-withdrawal-worker-secret', 'x-worker-secret'],
    });

    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: invalid WITHDRAWAL_WORKER_SECRET' },
        { status: 401 }
      );
    }

    let body: Partial<WithdrawalRequestPayload> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { withdrawalId, asset, network, toAddress, amount } = body;

    if (asset && network && toAddress && amount) {
      const normAsset = asset.toUpperCase().trim();
      const normNet = network.toUpperCase().trim();
      const amountStr = String(amount);

      let execution: { txHash: string; gasEstimated: string; providerUsed: string };

      if (normNet === 'BTC' || normAsset === 'BTC') {
        execution = await processBtcWithdrawal(toAddress, amountStr);
      } else if (normNet === 'LTC' || normAsset === 'LTC') {
        execution = await processLtcWithdrawal(toAddress, amountStr);
      } else if (normNet === 'TRC20' || normNet === 'TRON') {
        execution = await processTronWithdrawal(toAddress, amountStr);
      } else {
        execution = await processEvmWithdrawal(toAddress, amountStr, normAsset, normNet);
      }

      const supabase = getAdminClient();
      if (withdrawalId) {
        try {
          await recordBroadcast(supabase, withdrawalId, execution.txHash);
        } catch (persistErr) {
          const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
          await markAmbiguousBroadcast(supabase, withdrawalId, execution.txHash, message);
          return NextResponse.json({
            success: false,
            withdrawalId,
            txHash: execution.txHash,
            status: 'AMBIGUOUS_BROADCAST',
            error: 'Transaction was broadcast but its status could not be safely persisted. Do not retry; reconcile this transaction hash.',
          }, { status: 202 });
        }
      }

      const result: WithdrawalExecutionResult = {
        withdrawalId,
        asset: normAsset,
        network: normNet,
        toAddress,
        amount,
        txHash: execution.txHash,
        status: 'BROADCASTED',
        gasUsedEstimated: execution.gasEstimated,
        providerUsed: execution.providerUsed,
      };

      return NextResponse.json({
        success: true,
        result,
      });
    }

    // Process pending queue from database using claim_pending_withdrawals RPC
    const supabase = getAdminClient();
    const { data: queue, error: queueErr } = await supabase.rpc('claim_pending_withdrawals', {
      p_limit: 10,
    });

    if (queueErr) {
      return NextResponse.json(
        { success: false, error: `Queue query failed: ${queueErr.message}` },
        { status: 500 }
      );
    }

    if (!queue || queue.length === 0) {
      return NextResponse.json({
        success: true,
        processedCount: 0,
        message: 'No pending withdrawals in queue',
        results: [],
      });
    }

    const processedResults: WithdrawalExecutionResult[] = [];

    for (const item of queue) {
      const itemAsset = (item.asset_symbol || 'USDT').toUpperCase();
      const itemNet = (item.network || 'TRC20').toUpperCase();
      const itemTo = item.to_address || item.destination_address;
      const itemAmt = String(item.amount);

      if (!itemTo || !itemAmt) continue;

      let broadcastTxHash: string | null = null;
      try {
        let exec: { txHash: string; gasEstimated: string; providerUsed: string };
        if (itemNet === 'BTC' || itemAsset === 'BTC') {
          exec = await processBtcWithdrawal(itemTo, itemAmt);
        } else if (itemNet === 'LTC' || itemAsset === 'LTC') {
          exec = await processLtcWithdrawal(itemTo, itemAmt);
        } else if (itemNet === 'TRC20' || itemNet === 'TRON') {
          exec = await processTronWithdrawal(itemTo, itemAmt);
        } else {
          exec = await processEvmWithdrawal(itemTo, itemAmt, itemAsset, itemNet);
        }

        broadcastTxHash = exec.txHash;
        await recordBroadcast(supabase, item.id, exec.txHash);

        processedResults.push({
          withdrawalId: item.id,
          asset: itemAsset,
          network: itemNet,
          toAddress: itemTo,
          amount: itemAmt,
          txHash: exec.txHash,
          status: 'BROADCASTED',
          gasUsedEstimated: exec.gasEstimated,
          providerUsed: exec.providerUsed,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (broadcastTxHash) {
          // Once a tx hash exists, the transaction may already be on-chain.
          // Never use the verified-unbroadcast refund path in this branch.
          await markAmbiguousBroadcast(supabase, item.id, broadcastTxHash, errorMsg);
          processedResults.push({
            withdrawalId: item.id,
            asset: itemAsset,
            network: itemNet,
            toAddress: itemTo,
            amount: itemAmt,
            txHash: broadcastTxHash,
            status: 'FAILED',
            providerUsed: 'Reconciliation required',
            error: 'Broadcast may have succeeded; funds remain reserved and must not be refunded automatically.',
          });
        } else {
          const { error: refundError } = await supabase.rpc('process_failed_withdrawal', {
            p_withdrawal_id: item.id,
            p_error_reason: errorMsg,
            p_is_verified_unbroadcast: true,
          });
          if (refundError) console.error('[Withdrawal Worker] Pre-broadcast refund RPC failed', item.id, refundError.message);

          processedResults.push({
            withdrawalId: item.id,
            asset: itemAsset,
            network: itemNet,
            toAddress: itemTo,
            amount: itemAmt,
            txHash: '',
            status: 'FAILED',
            providerUsed: 'Error',
            error: refundError ? `${errorMsg}; refund status update failed: ${refundError.message}` : errorMsg,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: processedResults.length,
      successCount: processedResults.filter((r) => r.status === 'SUCCESS').length,
      failedCount: processedResults.filter((r) => r.status === 'FAILED').length,
      results: processedResults,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/workers/withdraw] Fatal error:', errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
