import { ethers } from 'ethers';
import TronWeb from 'tronweb';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { LTC_NETWORK } from '@/lib/crypto/hd-engine';

const ECPair = ECPairFactory(ecc);

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
    case 'TRC20':
    case 'TRON':
      return process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
    default:
      return (
        process.env.ETH_RPC_URL ||
        process.env.EVM_RPC_URL ||
        'https://cloudflare-eth.com'
      );
  }
}

/**
 * Signs and broadcasts a TRON TRC-20 on-chain withdrawal
 */
export async function processTronWithdrawalOnChain(
  withdrawal: WithdrawalTask,
  tronPrivateKeyHex?: string
): Promise<string> {
  const privKey =
    tronPrivateKeyHex ||
    process.env.HOT_WALLET_TRON_PRIVATE_KEY ||
    process.env.TRON_HOT_WALLET_PRIVATE_KEY ||
    process.env.TRON_PRIVATE_KEY;

  if (!privKey) {
    throw new Error('HOT_WALLET_TRON_PRIVATE_KEY is not configured for TRC20 withdrawals');
  }

  const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  const tronWeb = new (TronWeb as any)({
    fullHost: tronHost,
    privateKey: privKey,
  });

  const supabase = getSupabaseAdminClient();
  const usdtContractAddress = process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const contract = await tronWeb.contract().at(usdtContractAddress);

  const amountNum = Number(withdrawal.amount);
  const amountSun = Math.round(amountNum * 1_000_000);

  console.log(`[TRON Withdrawal Engine] Sending ${amountNum} TRC20 USDT to ${withdrawal.destination_address}...`);

  const txid = await contract.transfer(withdrawal.destination_address, amountSun).send({
    feeLimit: 50_000_000, // 50 TRX priority fee limit
  });

  console.log(`[TRON Withdrawal Engine] Broadcast Successful. TxID: ${txid}`);

  try {
    await supabase.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: txid,
      p_actual_gas_amount: 0,
      p_gas_asset: 'TRX',
    });
  } catch (dbErr) {
    console.warn('[TRON Withdrawal Engine] DB notice on update:', dbErr);
  }

  return txid;
}

/**
 * Signs and broadcasts a Bitcoin (BTC Native SegWit) withdrawal
 */
export async function processBtcWithdrawalOnChain(
  withdrawal: WithdrawalTask,
  btcPrivateKeyHex?: string
): Promise<string> {
  const privKey =
    btcPrivateKeyHex ||
    process.env.HOT_WALLET_BTC_PRIVATE_KEY ||
    process.env.BTC_HOT_WALLET_PRIVATE_KEY ||
    process.env.BTC_PRIVATE_KEY;

  if (!privKey) {
    throw new Error('HOT_WALLET_BTC_PRIVATE_KEY is not configured for BTC withdrawals');
  }

  const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privKey.replace(/^0x/, ''), 'hex'), {
    network: bitcoin.networks.bitcoin,
  });

  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: bitcoin.networks.bitcoin,
  });

  const hotWalletAddress = p2wpkh.address!;
  const utxoRes = await fetch(`${btcApiBase}/address/${hotWalletAddress}/utxo`);
  if (!utxoRes.ok) {
    throw new Error(`Failed to fetch BTC Hot Wallet UTXOs: ${utxoRes.statusText}`);
  }

  const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
  const amountSat = Math.round(Number(withdrawal.amount) * 100_000_000);

  const prioritySatPerVb = 25;
  const estimatedVsize = 68 * Math.max(1, utxos.length) + 31 * 2 + 10;
  const networkFeeSat = estimatedVsize * prioritySatPerVb;

  const totalNeeded = amountSat + networkFeeSat;
  let collected = 0;
  const inputsToUse: typeof utxos = [];

  for (const utxo of utxos) {
    inputsToUse.push(utxo);
    collected += utxo.value;
    if (collected >= totalNeeded) break;
  }

  if (collected < totalNeeded) {
    throw new Error(`Insufficient BTC in Hot Wallet: Have ${(collected / 1e8).toFixed(6)} BTC, Need ${(totalNeeded / 1e8).toFixed(6)} BTC`);
  }

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

  for (const input of inputsToUse) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: p2wpkh.output!,
        value: input.value,
      },
    });
  }

  // Payout output to user
  psbt.addOutput({
    address: withdrawal.destination_address,
    value: amountSat,
  });

  // Change output back to Hot Wallet
  const changeSat = collected - amountSat - networkFeeSat;
  if (changeSat > 546) {
    psbt.addOutput({
      address: hotWalletAddress,
      value: changeSat,
    });
  }

  const btcSigner: bitcoin.Signer = {
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
  };

  psbt.signAllInputs(btcSigner);
  psbt.finalizeAllInputs();

  const rawTxHex = psbt.extractTransaction().toHex();

  const broadcastRes = await fetch(`${btcApiBase}/tx`, {
    method: 'POST',
    body: rawTxHex,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text();
    throw new Error(`BTC broadcast failed: ${errText}`);
  }

  const txid = (await broadcastRes.text()).trim();
  console.log(`[BTC Withdrawal Engine] Broadcast Successful. TxID: ${txid}`);

  const supabase = getSupabaseAdminClient();
  try {
    const feeBtc = Number((networkFeeSat / 1e8).toFixed(8));
    await supabase.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: txid,
      p_actual_gas_amount: feeBtc,
      p_gas_asset: 'BTC',
    });
  } catch (dbErr) {
    console.warn('[BTC Withdrawal Engine] DB notice on update:', dbErr);
  }

  return txid;
}

/**
 * Signs and broadcasts a Litecoin (LTC Native SegWit) withdrawal
 */
export async function processLtcWithdrawalOnChain(
  withdrawal: WithdrawalTask,
  ltcPrivateKeyHex?: string
): Promise<string> {
  const privKey =
    ltcPrivateKeyHex ||
    process.env.HOT_WALLET_LTC_PRIVATE_KEY ||
    process.env.LTC_HOT_WALLET_PRIVATE_KEY ||
    process.env.LTC_PRIVATE_KEY;

  if (!privKey) {
    throw new Error('HOT_WALLET_LTC_PRIVATE_KEY is not configured for LTC withdrawals');
  }

  const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
  const keyPair = ECPair.fromPrivateKey(Buffer.from(privKey.replace(/^0x/, ''), 'hex'), {
    network: LTC_NETWORK as any,
  });

  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: LTC_NETWORK as any,
  });

  const hotWalletAddress = p2wpkh.address!;
  const utxoRes = await fetch(`${ltcApiBase}/address/${hotWalletAddress}/utxo`);
  if (!utxoRes.ok) {
    throw new Error(`Failed to fetch LTC Hot Wallet UTXOs: ${utxoRes.statusText}`);
  }

  const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
  const amountLit = Math.round(Number(withdrawal.amount) * 100_000_000);

  const priorityLitPerVb = 3;
  const estimatedVsize = 68 * Math.max(1, utxos.length) + 31 * 2 + 10;
  const networkFeeLit = estimatedVsize * priorityLitPerVb;

  const totalNeeded = amountLit + networkFeeLit;
  let collected = 0;
  const inputsToUse: typeof utxos = [];

  for (const utxo of utxos) {
    inputsToUse.push(utxo);
    collected += utxo.value;
    if (collected >= totalNeeded) break;
  }

  if (collected < totalNeeded) {
    throw new Error(`Insufficient LTC in Hot Wallet: Have ${(collected / 1e8).toFixed(6)} LTC, Need ${(totalNeeded / 1e8).toFixed(6)} LTC`);
  }

  const psbt = new bitcoin.Psbt({ network: LTC_NETWORK as any });

  for (const input of inputsToUse) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: p2wpkh.output!,
        value: input.value,
      },
    });
  }

  // Payout output to user
  psbt.addOutput({
    address: withdrawal.destination_address,
    value: amountLit,
  });

  // Change output back to Hot Wallet
  const changeLit = collected - amountLit - networkFeeLit;
  if (changeLit > 546) {
    psbt.addOutput({
      address: hotWalletAddress,
      value: changeLit,
    });
  }

  const ltcSigner: bitcoin.Signer = {
    publicKey: Buffer.from(keyPair.publicKey),
    sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
  };

  psbt.signAllInputs(ltcSigner);
  psbt.finalizeAllInputs();

  const rawTxHex = psbt.extractTransaction().toHex();

  const broadcastRes = await fetch(`${ltcApiBase}/tx`, {
    method: 'POST',
    body: rawTxHex,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text();
    throw new Error(`LTC broadcast failed: ${errText}`);
  }

  const txid = (await broadcastRes.text()).trim();
  console.log(`[LTC Withdrawal Engine] Broadcast Successful. TxID: ${txid}`);

  const supabase = getSupabaseAdminClient();
  try {
    const feeLtc = Number((networkFeeLit / 1e8).toFixed(8));
    await supabase.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: txid,
      p_actual_gas_amount: feeLtc,
      p_gas_asset: 'LTC',
    });
  } catch (dbErr) {
    console.warn('[LTC Withdrawal Engine] DB notice on update:', dbErr);
  }

  return txid;
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
  const network = (withdrawal.network || 'ERC20').toUpperCase();
  const amountStr = String(withdrawal.amount);

  // Calculate Priority Gas Pricing
  const feeData = await provider.getFeeData();
  const gasPrice2X = feeData.gasPrice ? (feeData.gasPrice * 125n) / 100n : undefined;
  const maxFeePerGas2X = feeData.maxFeePerGas ? (feeData.maxFeePerGas * 125n) / 100n : undefined;
  const maxPriorityFeePerGas2X = feeData.maxPriorityFeePerGas ? (feeData.maxPriorityFeePerGas * 125n) / 100n : undefined;

  const txOverrides: any = {};
  if (maxFeePerGas2X) {
    txOverrides.maxFeePerGas = maxFeePerGas2X;
    txOverrides.maxPriorityFeePerGas = maxPriorityFeePerGas2X;
  } else if (gasPrice2X) {
    txOverrides.gasPrice = gasPrice2X;
  }

  if (symbol === 'ETH') {
    // Native Transfer
    const value = ethers.parseEther(amountStr);

    txResponse = await wallet.sendTransaction({
      to: withdrawal.destination_address,
      value: value,
      ...txOverrides,
    });
  } else if (symbol === 'USDT') {
    // Token Transfer (USDT BEP-20 / USDT ERC-20)
    let tokenContractAddress: string;
    let decimals: number = 6;

    if (network === 'BEP20' || network === 'BSC' || network === 'BINANCE') {
      tokenContractAddress = process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955';
      decimals = 18; // BSC USDT uses 18 decimals
    } else {
      tokenContractAddress = process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      decimals = 6; // Ethereum USDT uses 6 decimals
    }

    const contract = new ethers.Contract(tokenContractAddress, ERC20_ABI, wallet);
    try {
      decimals = await contract.decimals();
    } catch {
      // Keep default
    }

    const parsedAmount = ethers.parseUnits(amountStr, decimals);
    txResponse = await contract.transfer(withdrawal.destination_address, parsedAmount, txOverrides);
  } else {
    throw new Error(`Unsupported EVM asset: ${symbol}`);
  }

  console.log(`[Withdrawal Engine] Broadcast Successful. TxHash: ${txResponse.hash}`);

  // Settle via authoritative complete_onchain_withdrawal RPC
  try {
    const gasAsset = (withdrawal.network_code || '').toUpperCase().includes('BEP') || (withdrawal.network_code || '').toUpperCase().includes('BSC') ? 'BNB' : 'ETH';
    await supabase.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: withdrawal.id,
      p_tx_hash: txResponse.hash,
      p_actual_gas_amount: 0,
      p_gas_asset: gasAsset,
    });
  } catch (dbErr) {
    console.warn('[Withdrawal Engine] DB notice on RPC execution:', dbErr);
  }

  return txResponse.hash;
}

/**
 * Sign and broadcast router for pending records
 */
export async function signAndBroadcast(withdrawal: WithdrawalRecord): Promise<string> {
  const normNet = (withdrawal.network_code || '').toUpperCase().trim();
  const normAsset = (withdrawal.asset_code || '').toUpperCase().trim();

  const task: WithdrawalTask = {
    id: withdrawal.id,
    user_id: withdrawal.user_id,
    destination_address: withdrawal.destination_address,
    amount: withdrawal.amount,
    asset_symbol: withdrawal.asset_code,
    network: withdrawal.network_code,
  };

  if (normNet === 'TRC20' || normNet === 'TRON') {
    return processTronWithdrawalOnChain(task);
  }

  if (normNet === 'BTC' || normAsset === 'BTC') {
    return processBtcWithdrawalOnChain(task);
  }

  if (normNet === 'LTC' || normAsset === 'LTC') {
    return processLtcWithdrawalOnChain(task);
  }

  const privateKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is not configured');
  }

  const rpcUrl = getRpcUrlForNetwork(withdrawal.network_code);
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
    const networkCode = (item.network || item.network_code || 'TRC20').toUpperCase().trim();
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

      let txid: string;

      if (networkCode === 'TRC20' || networkCode === 'TRON') {
        txid = await processTronWithdrawalOnChain(task);
      } else if (networkCode === 'BTC' || assetCode === 'BTC') {
        txid = await processBtcWithdrawalOnChain(task);
      } else if (networkCode === 'LTC' || assetCode === 'LTC') {
        txid = await processLtcWithdrawalOnChain(task);
      } else {
        const privateKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
        if (!privateKey) {
          throw new Error('EVM_HOT_WALLET_PRIVATE_KEY is not configured');
        }

        const rpcUrl = getRpcUrlForNetwork(networkCode);
        txid = await processEvmWithdrawalOnChain(task, privateKey, rpcUrl);
      }

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

      if (isPermanentlyFailed) {
        // Trigger automated refund via process_failed_withdrawal RPC
        try {
          await supabaseAdmin.rpc('process_failed_withdrawal', {
            p_withdrawal_id: item.id,
            p_error_reason: errorMsg,
            p_is_verified_unbroadcast: true,
          });
        } catch (rpcErr) {
          console.error('[processPendingWithdrawals] Refund RPC failed:', rpcErr);
        }
      } else {
        await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'processing',
            broadcast_attempts: attempts,
            broadcast_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }

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
