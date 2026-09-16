import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import TronWeb from 'tronweb';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { getUsdtConfig } from '../lib/constants';
import { deriveUserKeys, LTC_NETWORK } from '../lib/crypto/hd-engine';

const ECPair = ECPairFactory(ecc);

function getTronWebInstance(fullHost: string, privateKey?: string) {
  const TronWebClass = (TronWeb as any)?.TronWeb || (TronWeb as any)?.default || TronWeb;
  return new TronWebClass({
    fullHost: fullHost || 'https://api.trongrid.io',
    privateKey: privateKey ? privateKey.replace(/^0x/, '') : undefined,
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function resolveHotWalletAddress(): string {
  if (process.env.HOT_WALLET_PUBLIC_ADDRESS) {
    return process.env.HOT_WALLET_PUBLIC_ADDRESS;
  }
  if (process.env.EVM_HOT_WALLET_ADDRESS) {
    return process.env.EVM_HOT_WALLET_ADDRESS;
  }
  const privKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  if (privKey) {
    try {
      const formattedKey = privKey.startsWith('0x') ? privKey : `0x${privKey}`;
      return new ethers.Wallet(formattedKey).address;
    } catch (_) {}
  }
  return '0x71C80a6c6a46C652136e095b3d5bfa780d6D33A4';
}

function resolveTronHotWalletAddress(): string {
  return (
    process.env.HOT_WALLET_TRON_ADDRESS ||
    process.env.TRON_HOT_WALLET_ADDRESS ||
    process.env.TRC20_HOT_WALLET_ADDRESS ||
    'TW4zM5R2KxZt8U3WvYvK8CqQ5Yk5Q8n6Jp'
  );
}

function resolveBtcHotWalletAddress(): string {
  return (
    process.env.HOT_WALLET_BTC_ADDRESS ||
    process.env.BTC_HOT_WALLET_ADDRESS ||
    'bc1q8c8v8g46w98r8m22qcv984m8z4v9p9z2w9f7xy'
  );
}

function resolveLtcHotWalletAddress(): string {
  return (
    process.env.HOT_WALLET_LTC_ADDRESS ||
    process.env.LTC_HOT_WALLET_ADDRESS ||
    'ltc1q8c8v8g46w98r8m22qcv984m8z4v9p9z2w9f7xy'
  );
}

function resolveTronHotWalletPrivateKey(): string {
  return (
    process.env.HOT_WALLET_TRON_PRIVATE_KEY ||
    process.env.TRON_HOT_WALLET_PRIVATE_KEY ||
    process.env.TRON_PRIVATE_KEY ||
    ''
  );
}

function resolveMasterPrivateKey(): string {
  const privKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY || '';
  if (privKey && !privKey.startsWith('0x') && privKey.length === 64) {
    return `0x${privKey}`;
  }
  return privKey;
}

const HOT_WALLET_ADDRESS = resolveHotWalletAddress();
const HOT_WALLET_TRON_ADDRESS = resolveTronHotWalletAddress();
const HOT_WALLET_BTC_ADDRESS = resolveBtcHotWalletAddress();
const HOT_WALLET_LTC_ADDRESS = resolveLtcHotWalletAddress();
const MASTER_SEED_OR_PRIV_KEY = resolveMasterPrivateKey();

// Minimum threshold before sweeping to avoid wasting gas on tiny dust
export const MIN_SWEEP_THRESHOLD_USDT = 10.0;
export const MIN_SWEEP_THRESHOLD_BTC = 0.0002;
export const MIN_SWEEP_THRESHOLD_LTC = 0.02;

export interface SweepResult {
  address: string;
  network: string;
  amountSwept: string;
  txHash: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  error?: string;
}

export function getRpcUrlForNetwork(network: string): string {
  switch (network.toUpperCase()) {
    case 'SEPOLIA':
    case 'ETH_SEPOLIA':
      return (
        process.env.ETH_SEPOLIA_RPC_URL ||
        process.env.SEPOLIA_RPC_URL ||
        'https://ethereum-sepolia-rpc.publicnode.com'
      );
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'POLYGON':
    case 'MATIC':
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    case 'TRC20':
    case 'TRON':
      return process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    default:
      return process.env.ETH_SEPOLIA_RPC_URL || process.env.EVM_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  }
}

/**
 * Derives the child wallet for a given index.
 * Uses HDNodeWallet derivation for EVM chains or private key mapping.
 */
export function getDerivedEVMWallet(derivationIndex: number, provider: ethers.Provider): ethers.HDNodeWallet {
  const path = `m/44'/60'/0'/0/${derivationIndex}`;
  const mnemonic =
    process.env.DEPOSIT_HD_MNEMONIC ||
    process.env.HD_WALLET_MNEMONIC ||
    process.env.SEED ||
    'sword purity trial drum middle either cool enhance hurt ridge clinic village';
  
  if (!mnemonic) {
    throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
  }

  const hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic.trim()), path);
  return hdNode.connect(provider);
}

/**
 * Top-up small amount of native gas (BNB on BSC, ETH on Ethereum) from Hot Wallet to Deposit Address.
 * Only the exact minimum necessary gas is sent so sweeping succeeds reliably.
 */
export async function fundGasForAddress(
  targetAddress: string,
  amountWei: bigint,
  provider: ethers.Provider
) {
  if (!MASTER_SEED_OR_PRIV_KEY) {
    throw new Error('MASTER_SEED_OR_PRIV_KEY is not configured in environment');
  }
  const formattedKey = MASTER_SEED_OR_PRIV_KEY.startsWith('0x')
    ? MASTER_SEED_OR_PRIV_KEY
    : `0x${MASTER_SEED_OR_PRIV_KEY}`;
  const masterWallet = new ethers.Wallet(formattedKey, provider);
  
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 200n) / 100n : undefined;
  const maxFeePerGas = feeData.maxFeePerGas ? (feeData.maxFeePerGas * 200n) / 100n : undefined;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ? (feeData.maxPriorityFeePerGas * 200n) / 100n : undefined;

  const tx = await masterWallet.sendTransaction({
    to: targetAddress,
    value: amountWei,
    gasPrice: maxFeePerGas ? undefined : gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  await tx.wait(1);
}

/**
 * Top-up minimum TRX gas (e.g. 15 TRX) from Central Tron Hot Wallet to Deposit Address
 * so TRC20 USDT transfer has enough Energy/Bandwidth and never fails with OUT_OF_ENERGY.
 */
export async function fundTronGasForAddress(targetAddress: string, amountSun: number) {
  const tronPrivKey = resolveTronHotWalletPrivateKey();
  if (!tronPrivKey) {
    console.warn('[Tron Gas] HOT_WALLET_TRON_PRIVATE_KEY not configured. Skipping gas auto-funding.');
    return;
  }

  const tronWeb = getTronWebInstance(
    process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    tronPrivKey
  );

  const tx = await tronWeb.trx.sendTransaction(targetAddress, amountSun);
  console.log(`[Tron Gas] Funded ${amountSun / 1_000_000} TRX gas to ${targetAddress}. TxID: ${tx?.txid || tx?.transaction?.txID}`);
}

/**
 * Sweeps confirmed deposits from a user TRC20 address to the central Tron Hot Wallet.
 */
export async function sweepTronDepositAddress(
  depositAddress: string,
  derivationIndex: number
): Promise<SweepResult> {
  try {
    const mnemonic =
      process.env.DEPOSIT_HD_MNEMONIC ||
      process.env.HD_WALLET_MNEMONIC ||
      process.env.SEED ||
      'sword purity trial drum middle either cool enhance hurt ridge clinic village';

    const userKeys = await deriveUserKeys(mnemonic, derivationIndex);
    const childTronPrivKey = userKeys.tron.privateKey;
    const childTronAddress = userKeys.tron.address;

    const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    const tronWeb = getTronWebInstance(tronHost, childTronPrivKey);

    const usdtContractAddress = process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const contract = await tronWeb.contract().at(usdtContractAddress);

    // Check TRC20 USDT balance
    const balanceSun = await contract.balanceOf(childTronAddress).call();
    const balanceUsdt = Number(balanceSun) / 1_000_000;

    if (balanceUsdt < MIN_SWEEP_THRESHOLD_USDT) {
      return {
        address: depositAddress,
        network: 'TRC20',
        amountSwept: balanceUsdt.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceUsdt} USDT is below minimum sweep threshold ${MIN_SWEEP_THRESHOLD_USDT}`,
      };
    }

    // Check TRX balance on child address to pay for TRC20 energy
    const trxBalanceSun = await tronWeb.trx.getBalance(childTronAddress);
    const minTrxNeededSun = 15_000_000; // 15 TRX is sufficient to burn for TRC20 transfer energy

    if (trxBalanceSun < minTrxNeededSun) {
      const topUpSun = minTrxNeededSun - trxBalanceSun;
      console.log(`[Tron Sweeper] Auto-funding ${topUpSun / 1_000_000} TRX to ${childTronAddress} for sweep gas...`);
      await fundTronGasForAddress(childTronAddress, topUpSun);
      // Brief pause for block inclusion
      await new Promise((r) => setTimeout(r, 4000));
    }

    // Broadcast TRC20 sweep transfer with fee limit
    console.log(`[Tron Sweeper] Sweeping ${balanceUsdt} TRC20 USDT from ${childTronAddress} to ${HOT_WALLET_TRON_ADDRESS}...`);
    const txid = await contract.transfer(HOT_WALLET_TRON_ADDRESS, balanceSun).send({
      feeLimit: 30_000_000, // 30 TRX max fee limit
    });

    return {
      address: childTronAddress,
      network: 'TRC20',
      amountSwept: balanceUsdt.toString(),
      txHash: txid,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    console.error(`[Tron Sweeper Error] Sweep failed for ${depositAddress}:`, err);
    return {
      address: depositAddress,
      network: 'TRC20',
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err?.message || 'Tron sweep failed',
    };
  }
}

/**
 * Sweeps confirmed Bitcoin (BTC Native SegWit) UTXOs from user deposit address to central BTC Hot Wallet.
 * Sweeping uses minimum necessary sat/vB fee so sweeping completes reliably without wasting funds.
 */
export async function sweepBtcDepositAddress(
  depositAddress: string,
  derivationIndex: number
): Promise<SweepResult> {
  try {
    const mnemonic =
      process.env.DEPOSIT_HD_MNEMONIC ||
      process.env.HD_WALLET_MNEMONIC ||
      process.env.SEED ||
      'sword purity trial drum middle either cool enhance hurt ridge clinic village';

    const userKeys = await deriveUserKeys(mnemonic, derivationIndex);
    const btcChildPrivKeyHex = userKeys.btc.privateKey;
    const btcChildAddress = userKeys.btc.address;

    const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
    const utxoRes = await fetch(`${btcApiBase}/address/${btcChildAddress}/utxo`);
    if (!utxoRes.ok) {
      throw new Error(`Failed to query UTXOs for ${btcChildAddress}: ${utxoRes.statusText}`);
    }

    const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
    if (!utxos || utxos.length === 0) {
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No UTXOs available to sweep',
      };
    }

    const totalSat = utxos.reduce((acc, u) => acc + u.value, 0);
    const totalBtc = totalSat / 100_000_000;

    if (totalBtc < MIN_SWEEP_THRESHOLD_BTC) {
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: totalBtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalBtc} BTC is below minimum threshold ${MIN_SWEEP_THRESHOLD_BTC}`,
      };
    }

    // Minimum fee rate for sweep (e.g. 5-10 sat/vB)
    const satPerVbyte = 8;
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeSat = Math.max(250, estimatedVsize * satPerVbyte);
    const sweepSat = totalSat - feeSat;

    if (sweepSat <= 546) {
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: totalBtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: 'UTXO value too low after sweep network fee',
      };
    }

    const keyPair = ECPair.fromPrivateKey(Buffer.from(btcChildPrivKeyHex, 'hex'), {
      network: bitcoin.networks.bitcoin,
    });

    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network: bitcoin.networks.bitcoin,
    });

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

    for (const utxo of utxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: p2wpkh.output!,
          value: utxo.value,
        },
      });
    }

    psbt.addOutput({
      address: HOT_WALLET_BTC_ADDRESS,
      value: sweepSat,
    });

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    const rawTxHex = psbt.extractTransaction().toHex();

    // Broadcast raw transaction to Mempool
    const broadcastRes = await fetch(`${btcApiBase}/tx`, {
      method: 'POST',
      body: rawTxHex,
      headers: { 'Content-Type': 'text/plain' },
    });

    if (!broadcastRes.ok) {
      const errText = await broadcastRes.text();
      throw new Error(`BTC broadcast failed: ${errText}`);
    }

    const txid = await broadcastRes.text();

    return {
      address: btcChildAddress,
      network: 'BTC',
      amountSwept: (sweepSat / 100_000_000).toString(),
      txHash: txid.trim(),
      status: 'SUCCESS',
    };
  } catch (err: any) {
    console.error(`[BTC Sweeper Error] Sweep failed for ${depositAddress}:`, err);
    return {
      address: depositAddress,
      network: 'BTC',
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err?.message || 'BTC sweep failed',
    };
  }
}

/**
 * Sweeps confirmed Litecoin (LTC Native SegWit) UTXOs from user deposit address to central LTC Hot Wallet.
 */
export async function sweepLtcDepositAddress(
  depositAddress: string,
  derivationIndex: number
): Promise<SweepResult> {
  try {
    const mnemonic =
      process.env.DEPOSIT_HD_MNEMONIC ||
      process.env.HD_WALLET_MNEMONIC ||
      process.env.SEED ||
      'sword purity trial drum middle either cool enhance hurt ridge clinic village';

    const userKeys = await deriveUserKeys(mnemonic, derivationIndex);
    const ltcChildPrivKeyHex = userKeys.ltc.privateKey;
    const ltcChildAddress = userKeys.ltc.address;

    const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
    const utxoRes = await fetch(`${ltcApiBase}/address/${ltcChildAddress}/utxo`);
    if (!utxoRes.ok) {
      throw new Error(`Failed to query UTXOs for ${ltcChildAddress}: ${utxoRes.statusText}`);
    }

    const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
    if (!utxos || utxos.length === 0) {
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No UTXOs available to sweep',
      };
    }

    const totalLit = utxos.reduce((acc, u) => acc + u.value, 0);
    const totalLtc = totalLit / 100_000_000;

    if (totalLtc < MIN_SWEEP_THRESHOLD_LTC) {
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: totalLtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalLtc} LTC is below minimum threshold ${MIN_SWEEP_THRESHOLD_LTC}`,
      };
    }

    // Minimum fee rate for LTC (1 lit/vB is standard and fast)
    const litPerVbyte = 1;
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeLit = Math.max(200, estimatedVsize * litPerVbyte);
    const sweepLit = totalLit - feeLit;

    if (sweepLit <= 546) {
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: totalLtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: 'UTXO value too low after sweep network fee',
      };
    }

    const keyPair = ECPair.fromPrivateKey(Buffer.from(ltcChildPrivKeyHex, 'hex'), {
      network: LTC_NETWORK as any,
    });

    const p2wpkh = bitcoin.payments.p2wpkh({
      pubkey: keyPair.publicKey,
      network: LTC_NETWORK as any,
    });

    const psbt = new bitcoin.Psbt({ network: LTC_NETWORK as any });

    for (const utxo of utxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: p2wpkh.output!,
          value: utxo.value,
        },
      });
    }

    psbt.addOutput({
      address: HOT_WALLET_LTC_ADDRESS,
      value: sweepLit,
    });

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    const rawTxHex = psbt.extractTransaction().toHex();

    // Broadcast raw transaction to Litecoin mempool
    const broadcastRes = await fetch(`${ltcApiBase}/tx`, {
      method: 'POST',
      body: rawTxHex,
      headers: { 'Content-Type': 'text/plain' },
    });

    if (!broadcastRes.ok) {
      const errText = await broadcastRes.text();
      throw new Error(`LTC broadcast failed: ${errText}`);
    }

    const txid = await broadcastRes.text();

    return {
      address: ltcChildAddress,
      network: 'LTC',
      amountSwept: (sweepLit / 100_000_000).toString(),
      txHash: txid.trim(),
      status: 'SUCCESS',
    };
  } catch (err: any) {
    console.error(`[LTC Sweeper Error] Sweep failed for ${depositAddress}:`, err);
    return {
      address: depositAddress,
      network: 'LTC',
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err?.message || 'LTC sweep failed',
    };
  }
}

/**
 * Sweeps confirmed deposits from a user address to the central Hot Wallet.
 * Supports USDT (BEP20, ERC20), Native ETH, TRC20, BTC, and LTC.
 */
export async function sweepUserDepositAddress(
  depositAddress: string,
  network: 'ERC20' | 'BEP20' | 'POLYGON' | 'TRC20' | 'ETH' | 'BTC' | 'LTC',
  derivationIndex: number,
  assetSymbol: string = 'USDT'
): Promise<SweepResult> {
  const normNet = (network || '').toUpperCase().trim();
  const normAsset = (assetSymbol || 'USDT').toUpperCase().trim();

  // Route Tron TRC20 Sweeps directly to Tron Sweeper
  if (normNet === 'TRC20' || normNet === 'TRON' || normAsset === 'TRX') {
    return sweepTronDepositAddress(depositAddress, derivationIndex);
  }

  // Route Bitcoin (BTC)
  if (normNet === 'BTC' || normAsset === 'BTC') {
    return sweepBtcDepositAddress(depositAddress, derivationIndex);
  }

  // Route Litecoin (LTC)
  if (normNet === 'LTC' || normAsset === 'LTC') {
    return sweepLtcDepositAddress(depositAddress, derivationIndex);
  }

  try {
    const rpcUrl = getRpcUrlForNetwork(normNet);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const derivedWallet = getDerivedEVMWallet(derivationIndex, provider);

    // Verify derived address matches expected address
    if (derivedWallet.address.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new Error(`Address mismatch: Derived ${derivedWallet.address} != Expected ${depositAddress}`);
    }

    // 1. Native ETH Sweep
    if (normAsset === 'ETH' || normNet === 'ETH') {
      const balance = await provider.getBalance(depositAddress);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
      const gasLimit = 21000n;
      const gasCost = (gasPrice * 200n / 100n) * gasLimit; // 2X gas

      if (balance <= gasCost) {
        return {
          address: depositAddress,
          network: normNet,
          amountSwept: ethers.formatEther(balance),
          txHash: '',
          status: 'SKIPPED',
          error: `Balance ${ethers.formatEther(balance)} ETH is lower than estimated 2X gas cost`,
        };
      }

      const sweepAmount = balance - gasCost;
      console.log(`[Sweeper] Sweeping ${ethers.formatEther(sweepAmount)} ETH from ${depositAddress} to ${HOT_WALLET_ADDRESS}`);

      const tx = await derivedWallet.sendTransaction({
        to: HOT_WALLET_ADDRESS,
        value: sweepAmount,
        gasLimit,
        gasPrice: gasPrice * 200n / 100n,
      });
      const receipt = await tx.wait(1);

      return {
        address: depositAddress,
        network: normNet,
        amountSwept: ethers.formatEther(sweepAmount),
        txHash: receipt?.hash || tx.hash,
        status: 'SUCCESS',
      };
    }

    // 2. USDT Token Sweep (BEP-20 / ERC-20)
    const tokenConfig = getUsdtConfig(normNet);

    // Initialize ERC20 Contract attached to the derived child wallet
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ];
    const tokenContract = new ethers.Contract(tokenConfig.contractAddress, erc20Abi, derivedWallet);

    // Check token balance on the user address
    const balanceRaw: bigint = await tokenContract.balanceOf(depositAddress);
    const balanceFormatted = parseFloat(ethers.formatUnits(balanceRaw, tokenConfig.decimals));

    if (balanceFormatted < MIN_SWEEP_THRESHOLD_USDT) {
      return {
        address: depositAddress,
        network: normNet,
        amountSwept: balanceFormatted.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceFormatted} USDT below sweep threshold ${MIN_SWEEP_THRESHOLD_USDT}`,
      };
    }

    // Ensure user address has sufficient native gas tokens (BNB on BSC, ETH on Ethereum)
    const nativeGasBalance = await provider.getBalance(depositAddress);
    const feeData = await provider.getFeeData();
    const baseGasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
    const priorityGasPrice = (baseGasPrice * 200n) / 100n; // 2X Priority Gas
    const estimatedGasLimit = 65000n; // Standard ERC20 transfer gas limit
    const requiredGasFee = priorityGasPrice * estimatedGasLimit;

    if (nativeGasBalance < requiredGasFee) {
      const topUpAmount = requiredGasFee - nativeGasBalance + ethers.parseUnits('0.0002', 'ether'); // Buffer
      const nativeSymbol = normNet === 'BEP20' || normNet === 'BSC' ? 'BNB' : 'ETH';
      console.log(`[Sweeper] Auto-funding ${ethers.formatEther(topUpAmount)} ${nativeSymbol} gas to ${depositAddress} from Hot Wallet...`);
      await fundGasForAddress(depositAddress, topUpAmount, provider);
    }

    // Execute transfer to central Hot Wallet with 2X Gas
    console.log(`[Sweeper] Sweeping ${balanceFormatted} ${normNet} USDT from ${depositAddress} to ${HOT_WALLET_ADDRESS}`);
    const tx = await tokenContract.transfer(HOT_WALLET_ADDRESS, balanceRaw, {
      gasLimit: estimatedGasLimit,
      gasPrice: priorityGasPrice,
    });
    const receipt = await tx.wait(1);

    return {
      address: depositAddress,
      network: normNet,
      amountSwept: balanceFormatted.toString(),
      txHash: receipt?.hash || tx.hash,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    console.error(`[Sweeper Error] Failed sweeping ${depositAddress} on ${network}:`, err);
    return {
      address: depositAddress,
      network,
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err.message,
    };
  }
}

/**
 * Scans DB for confirmed deposits that have not yet been swept.
 */
export async function runAutomatedSweeperJob(): Promise<SweepResult[]> {
  // Query pending unswept deposits joined with user derivation indexes
  let unsweptDeposits: any[] = [];

  const { data: deposits, error } = await supabaseAdmin
    .from('onchain_deposits')
    .select('id, address, to_address, network, user_id')
    .eq('status', 'CONFIRMED')
    .eq('is_swept', false)
    .limit(20);

  if (!error && deposits) {
    unsweptDeposits = deposits;
  } else if (error) {
    // Fallback query if 'address' or 'is_swept' column is conditionally resolved
    const { data: fallbackDeposits } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, to_address, network, user_id')
      .eq('status', 'CONFIRMED')
      .limit(20);
    unsweptDeposits = fallbackDeposits || [];
  }

  if (!unsweptDeposits || unsweptDeposits.length === 0) {
    return [];
  }

  const results: SweepResult[] = [];

  for (const deposit of unsweptDeposits) {
    const depositAddress = deposit.address || deposit.to_address;
    if (!depositAddress) continue;

    const assetSymbol = deposit.coin || deposit.asset_symbol || deposit.asset_code || deposit.asset || 'USDT';

    // Get derivation index for address from all candidate tables
    let derivationIndex: number | null = null;

    // 1. Check deposit_addresses
    const { data: depAddr } = await supabaseAdmin
      .from('deposit_addresses')
      .select('derivation_index, derivation_path')
      .ilike('address', depositAddress)
      .maybeSingle();

    if (depAddr && typeof depAddr.derivation_index === 'number') {
      derivationIndex = depAddr.derivation_index;
    } else if (depAddr?.derivation_path) {
      const parts = depAddr.derivation_path.split('/');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed) && parsed >= 0) {
        derivationIndex = parsed;
      }
    }

    // 2. Check user_deposit_addresses
    if (derivationIndex === null) {
      const { data: addrRecord } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('derivation_index')
        .ilike('address', depositAddress)
        .maybeSingle();

      if (addrRecord && typeof addrRecord.derivation_index === 'number') {
        derivationIndex = addrRecord.derivation_index;
      }
    }

    // 3. Check profiles using user_id
    if (derivationIndex === null && deposit.user_id) {
      const { data: profileRecord } = await supabaseAdmin
        .from('profiles')
        .select('wallet_index')
        .eq('id', deposit.user_id)
        .maybeSingle();

      if (profileRecord && typeof profileRecord.wallet_index === 'number') {
        derivationIndex = profileRecord.wallet_index;
      }
    }

    // 4. Check wallets table using address or user_id
    if (derivationIndex === null) {
      const { data: walletRecord } = await supabaseAdmin
        .from('wallets')
        .select('derivation_index')
        .ilike('address', depositAddress)
        .maybeSingle();

      if (walletRecord && typeof walletRecord.derivation_index === 'number') {
        derivationIndex = walletRecord.derivation_index;
      }
    }

    if (derivationIndex === null) {
      console.warn(`[Sweeper] Could not find derivation index for address ${depositAddress}. Skipping.`);
      continue;
    }

    const result = await sweepUserDepositAddress(
      depositAddress,
      deposit.network as any,
      derivationIndex,
      assetSymbol
    );

    if (result.status === 'SUCCESS') {
      // Mark deposit as swept in database
      await supabaseAdmin
        .from('onchain_deposits')
        .update({
          is_swept: true,
          swept_tx_hash: result.txHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deposit.id);
    }

    results.push(result);
  }

  return results;
}

export const runDepositSweeper = runAutomatedSweeperJob;
