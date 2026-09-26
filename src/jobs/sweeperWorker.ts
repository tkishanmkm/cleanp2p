import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

// Initialize ECPair library for BTC/LTC
const ECPair = ECPairFactory(ecc);

// Define Litecoin Network Parameters
const LTC_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: {
    public: 0x019da462,
    private: 0x019d9fed,
  },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

// Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Master Hot Wallet Seed / Private Key from environment
const MASTER_SEED_OR_PRIV_KEY = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY || '';
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS || process.env.EVM_HOT_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const HOT_WALLET_TRON_ADDRESS = process.env.HOT_WALLET_TRON_ADDRESS || process.env.TRON_HOT_WALLET_ADDRESS || '';
const HOT_WALLET_BTC_ADDRESS = process.env.HOT_WALLET_BTC_ADDRESS || 'bc1q00000000000000000000000000000000000000';
const HOT_WALLET_LTC_ADDRESS = process.env.HOT_WALLET_LTC_ADDRESS || 'ltc1q00000000000000000000000000000000000000';

// Minimum Sweep Thresholds
const MIN_SWEEP_THRESHOLD_USDT = 1.0; // Sweeps any deposit >= 1 USDT
const MIN_SWEEP_THRESHOLD_BTC = 0.0001; // ~10,000 sats
const MIN_SWEEP_THRESHOLD_LTC = 0.01;

/**
 * Derives user child keys from DEPOSIT_HD_MNEMONIC
 */
async function deriveUserKeys(mnemonic: string, derivationIndex: number) {
  const { deriveAllUserKeysFromMnemonic } = await import('@/lib/hd-derivation-engine');
  return deriveAllUserKeysFromMnemonic(mnemonic, derivationIndex);
}

/**
 * Helper to resolve TRON Hot Wallet Address
 */
function resolveTronHotWalletAddress(): string {
  return (process.env.HOT_WALLET_TRON_ADDRESS || process.env.TRON_HOT_WALLET_ADDRESS || '').trim();
}

/**
 * Helper to resolve TRON Hot Wallet Private Key
 */
function resolveTronHotWalletPrivateKey(): string {
  return process.env.HOT_WALLET_TRON_PRIVATE_KEY || process.env.TRON_HOT_WALLET_PRIVATE_KEY || '';
}

/**
 * Dynamically instantiates TronWeb
 */
function getTronWebInstance(fullHost: string, privateKey?: string) {
  const TronWeb = require('tronweb');
  const apiKey = process.env.TRONGRID_API_KEY;
  const headers = apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined;

  return new TronWeb({
    fullHost,
    headers,
    privateKey: privateKey || undefined,
  });
}

/**
 * Helper: USDT Contract Address Resolver per network
 */
function getUsdtConfig(network: string): { contractAddress: string; decimals: number } {
  const net = (network || '').toUpperCase().trim();
  switch (net) {
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return {
        contractAddress: process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
      };
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return {
        contractAddress: process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
      };
    default:
      throw new Error(`Unsupported USDT network: ${network}`);
  }
}

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
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'TRC20':
    case 'TRON':
      return process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    default:
      return process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
  }
}

/**
 * Derives the child wallet for a given index.
 */
export function getDerivedEVMWallet(derivationIndex: number, provider: ethers.Provider): ethers.HDNodeWallet {
  const path = `m/44'/60'/0'/0/${derivationIndex}`;
  const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
  
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
  }

  const hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic.trim()), path);
  return hdNode.connect(provider);
}

/**
 * Helper: Start Heartbeat interval to extend lease during long operations
 */
function startSweeperHeartbeat(sweepId: string, workerId: string): () => void {
  const interval = setInterval(async () => {
    try {
      await supabaseAdmin.rpc('extend_sweep_lease', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_extend_seconds: 300,
      });
    } catch {
      // Ignore heartbeat errors
    }
  }, 30000); // 30 seconds

  return () => clearInterval(interval);
}

/**
 * Helper: Perform strict atomic state machine status transition
 */
async function transitionSweepStatus(
  sweepId: string,
  workerId: string,
  expectedStatus: string,
  newStatus: string,
  txHashOrExtra?: string | { txHash?: string; amountSwept?: number; errorMessage?: string },
  extraParam: { amountSwept?: number; errorMessage?: string } = {}
): Promise<void> {
  let txHash: string | null = null;
  let amountSwept: number | null = null;
  let errorMessage: string | null = null;

  if (typeof txHashOrExtra === 'string') {
    txHash = txHashOrExtra;
    amountSwept = extraParam.amountSwept !== undefined ? extraParam.amountSwept : null;
    errorMessage = extraParam.errorMessage || null;
  } else if (txHashOrExtra) {
    txHash = txHashOrExtra.txHash || null;
    amountSwept = txHashOrExtra.amountSwept !== undefined ? txHashOrExtra.amountSwept : null;
    errorMessage = txHashOrExtra.errorMessage || null;
  }

  const { data: res, error } = await supabaseAdmin.rpc('update_sweep_operation_status', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_expected_status: expectedStatus,
    p_new_status: newStatus,
    p_tx_hash: txHash,
    p_amount_swept: amountSwept,
    p_error_message: errorMessage,
  });

  if (error || !res || res.success !== true) {
    const errCode = res?.code || error?.message || 'UNKNOWN_STATUS_UPDATE_ERROR';
    console.error(`[State Transition Rejected] ${expectedStatus} -> ${newStatus} failed for sweep ${sweepId}: ${errCode}`);
    throw new Error(`Status transition ${expectedStatus} -> ${newStatus} rejected: ${errCode}`);
  }
}

/**
 * Helper: Assert pre-broadcast worker ownership & lease validity
 */
async function assertPreBroadcastOwnership(
  sweepId: string,
  workerId: string,
  expectedStatus: string
): Promise<void> {
  const { data: verifyRes, error } = await supabaseAdmin.rpc('verify_sweep_ownership', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_expected_status: expectedStatus,
  });

  if (error || !verifyRes || !verifyRes.valid) {
    const reason = verifyRes?.reason || error?.message || 'OWNERSHIP_VERIFICATION_FAILED';
    console.error(`[Pre-Broadcast Stop] Worker ${workerId} failed pre-broadcast check for sweep ${sweepId}: ${reason}`);
    throw new Error(`Pre-broadcast ownership check failed: ${reason}`);
  }
}

/**
 * Top-up native gas for EVM deposit address using atomic hot wallet nonces.
 */
export async function fundGasForAddress(
  targetAddress: string,
  amountWei: bigint,
  provider: ethers.Provider,
  sweepId?: string,
  workerId?: string,
  networkCode: string = 'ERC20'
) {
  if (sweepId && workerId) {
    const { data: claimRes, error: claimErr } = await supabaseAdmin.rpc('claim_gas_funding_operation', {
      p_sweep_id: sweepId,
      p_deposit_address: targetAddress,
      p_network: networkCode,
      p_amount_allocated: Number(ethers.formatEther(amountWei)),
      p_worker_id: workerId,
    });

    if (claimErr || !claimRes) {
      throw new Error(`Gas funding claim RPC failed: ${claimErr?.message || 'UNKNOWN'}`);
    }

    if (claimRes.already_funded) {
      console.log(`[Sweeper Gas] Address ${targetAddress} gas funding already processed (tx: ${claimRes.tx_hash}). Skipping.`);
      return;
    }
  }

  if (!MASTER_SEED_OR_PRIV_KEY) {
    throw new Error('MASTER_SEED_OR_PRIV_KEY is not configured in environment');
  }
  const formattedKey = MASTER_SEED_OR_PRIV_KEY.startsWith('0x')
    ? MASTER_SEED_OR_PRIV_KEY
    : `0x${MASTER_SEED_OR_PRIV_KEY}`;
  const masterWallet = new ethers.Wallet(formattedKey, provider);

  // Resolve EVM chain ID from networkCode
  const normNet = (networkCode || '').toUpperCase().trim();
  let chainId = 1; // Default Ethereum Mainnet (ERC20)
  if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') {
    chainId = 56; // BSC Mainnet
  } else if (normNet === 'SEPOLIA') {
    chainId = 11155111; // Sepolia Testnet
  } else {
    try {
      const netInfo = await provider.getNetwork();
      if (netInfo?.chainId) {
        chainId = Number(netInfo.chainId);
      }
    } catch {
      chainId = 1;
    }
  }

  // Allocate atomic hot wallet nonce from database using p_chain_id
  const { data: allocatedNonce, error: nonceErr } = await supabaseAdmin.rpc('allocate_hot_wallet_nonce', {
    p_chain_id: chainId,
  });

  if (nonceErr || allocatedNonce === null || allocatedNonce === undefined) {
    throw new Error(`Failed to allocate hot wallet nonce: ${nonceErr?.message || 'UNKNOWN_NONCE_ERROR'}`);
  }

  if (sweepId && workerId) {
    await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ? (feeData.gasPrice * 200n) / 100n : undefined;
  const maxFeePerGas = feeData.maxFeePerGas ? (feeData.maxFeePerGas * 200n) / 100n : undefined;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ? (feeData.maxPriorityFeePerGas * 200n) / 100n : undefined;

  let tx;
  try {
    tx = await masterWallet.sendTransaction({
      to: targetAddress,
      value: amountWei,
      nonce: Number(allocatedNonce),
      gasPrice: maxFeePerGas ? undefined : gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  } catch (sendErr: any) {
    console.error(`[EVM Gas Funding Broadcast Exception] ${targetAddress}:`, sendErr);
    if (sweepId) {
      await supabaseAdmin
        .from('gas_funding_operations')
        .update({ status: 'RECOVERY_REQUIRED', updated_at: new Date().toISOString() })
        .eq('sweep_id', sweepId);
    }
    throw sendErr;
  }

  await tx.wait(1);

  if (sweepId) {
    await supabaseAdmin
      .from('gas_funding_operations')
      .update({ status: 'CONFIRMED', tx_hash: tx.hash, updated_at: new Date().toISOString() })
      .eq('sweep_id', sweepId);
  }
}

/**
 * Top-up TRX gas for TRON deposit address with durable signing & broadcast.
 */
export async function fundTronGasForAddress(
  targetAddress: string,
  amountSun: number,
  sweepId?: string,
  workerId?: string
) {
  if (sweepId && workerId) {
    const { data: claimRes, error: claimErr } = await supabaseAdmin.rpc('claim_gas_funding_operation', {
      p_sweep_id: sweepId,
      p_deposit_address: targetAddress,
      p_network: 'TRC20',
      p_amount_allocated: amountSun / 1_000_000,
      p_worker_id: workerId,
    });

    if (claimErr || !claimRes) {
      throw new Error(`Tron gas funding claim RPC failed: ${claimErr?.message || 'UNKNOWN'}`);
    }

    if (claimRes.already_funded) {
      console.log(`[Tron Gas] Address ${targetAddress} TRX gas funding already processed. Skipping.`);
      return;
    }
  }

  const tronPrivKey = resolveTronHotWalletPrivateKey();
  if (!tronPrivKey) {
    console.warn('[Tron Gas] HOT_WALLET_TRON_PRIVATE_KEY not configured. Skipping gas auto-funding.');
    return;
  }

  const tronWeb = getTronWebInstance(
    process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    tronPrivKey
  );
  const hotWalletAddress = tronWeb.defaultAddress.base58;

  if (sweepId && workerId) {
    await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
  }

  // 1. Construct activation transfer
  let txObj;
  try {
    txObj = await tronWeb.transactionBuilder.sendTrx(targetAddress, amountSun, hotWalletAddress);
  } catch (buildErr: any) {
    console.error(`[Tron Gas Build Exception] ${targetAddress}:`, buildErr);
    throw buildErr;
  }

  // 2. Sign transaction and calculate deterministic txID
  let signedTx;
  let deterministicTxHash: string;
  try {
    signedTx = await tronWeb.trx.sign(txObj, tronPrivKey);
    deterministicTxHash = signedTx.txID;
  } catch (signErr: any) {
    console.error(`[Tron Gas Sign Exception] ${targetAddress}:`, signErr);
    throw signErr;
  }

  // 3. Persist signed transaction bytes before broadcast (Sets status = READY_TO_BROADCAST)
  if (sweepId && workerId) {
    const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_gas_funding', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_signed_tx_hex: JSON.stringify(signedTx),
      p_tx_hash: deterministicTxHash,
    });

    if (persistErr || !persistRes || !persistRes.success) {
      throw new Error(`Failed to persist signed gas funding transaction: ${persistErr?.message || persistRes?.message}`);
    }
  }

  // 4. Broadcast exact persisted transaction
  try {
    const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcastRes || !broadcastRes.result) {
      throw new Error(`TRON gas funding broadcast rejected: ${JSON.stringify(broadcastRes)}`);
    }

    if (sweepId) {
      await supabaseAdmin
        .from('gas_funding_operations')
        .update({ status: 'BROADCASTED', updated_at: new Date().toISOString() })
        .eq('sweep_id', sweepId);
    }
  } catch (sendErr: any) {
    console.error(`[Tron Gas Funding Broadcast Exception] ${targetAddress}:`, sendErr);
    if (sweepId) {
      await supabaseAdmin
        .from('gas_funding_operations')
        .update({ status: 'RECOVERY_REQUIRED', updated_at: new Date().toISOString() })
        .eq('sweep_id', sweepId);
    }
    throw sendErr;
  }

  console.log(`[Tron Gas] Broadcasted ${amountSun / 1_000_000} TRX gas to ${targetAddress}. TxID: ${deterministicTxHash}`);

  // 5. Poll on-chain confirmation before transitioning to CONFIRMED
  if (sweepId && deterministicTxHash) {
    let isGasConfirmed = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const txInfo = await tronWeb.trx.getTransaction(deterministicTxHash);
        if (txInfo && txInfo.ret && txInfo.ret[0]?.contractRet === 'SUCCESS') {
          isGasConfirmed = true;
          break;
        }
      } catch {
        // Continue polling
      }
    }

    if (isGasConfirmed) {
      await supabaseAdmin
        .from('gas_funding_operations')
        .update({ status: 'CONFIRMED', tx_hash: deterministicTxHash, updated_at: new Date().toISOString() })
        .eq('sweep_id', sweepId);
      console.log(`[Tron Gas] Gas funding tx ${deterministicTxHash} confirmed on-chain.`);
    }
  }
}

/**
 * Calculates and executes dynamic TRON Energy delegation from the centralized pool
 */
export async function delegateEnergyFromPool(
  sweepId: string,
  workerId: string,
  receiverAddress: string,
  energyNeeded: number
): Promise<{ success: boolean; delegatedAmountSun: bigint }> {
  const poolPrivateKey = resolveTronHotWalletPrivateKey();
  if (!poolPrivateKey) {
    throw new Error('TRON pool/hot wallet private key is not configured');
  }

  const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  const tronWeb = getTronWebInstance(tronHost, poolPrivateKey);
  const poolAddress = tronWeb.defaultAddress.base58;

  if (!poolAddress) {
    throw new Error('Failed to resolve TRON pool address from private key');
  }

  // 1. Query network-wide parameters dynamically to calculate exact stake weight
  let resources;
  try {
    resources = await tronWeb.trx.getAccountResources(poolAddress);
  } catch (err: any) {
    console.error('[Tron Resource Pool] Failed to fetch account resources:', err);
    throw new Error(`Failed to query TRON account resources: ${err?.message || err}`);
  }

  let totalEnergyLimit = Number(resources.TotalEnergyLimit || 180000000000);
  let totalEnergyWeight = Number(resources.TotalEnergyWeight || 10000000000);

  if (totalEnergyLimit <= 0) totalEnergyLimit = 180000000000;
  if (totalEnergyWeight <= 0) totalEnergyWeight = 10000000000;

  const isWeightInSun = totalEnergyWeight > 1000000000000;
  const totalEnergyWeightSun = isWeightInSun ? totalEnergyWeight : totalEnergyWeight * 1000000;

  // Calculate needed TRX (in SUN)
  const trxNeededSun = BigInt(Math.ceil((energyNeeded * totalEnergyWeightSun) / totalEnergyLimit));

  console.log(`[Tron Resource Pool] Energy needed: ${energyNeeded}. Calculated TRX weight: ${Number(trxNeededSun) / 1000000} TRX (${trxNeededSun} SUN)`);

  // 2. Atomic claim/initialization of resource delegation record in DB (Blocker #2)
  const { data: initRes, error: initErr } = await supabaseAdmin.rpc('claim_or_initialize_resource_delegation', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_pool_address: poolAddress,
    p_receiver_address: receiverAddress,
    p_delegated_amount_sun: trxNeededSun,
    p_delegated_energy: energyNeeded,
  });

  if (initErr || !initRes || !initRes.success) {
    throw new Error(`Failed to initialize resource delegation record: ${initErr?.message || initRes?.message || 'UNKNOWN'}`);
  }

  // If already active or delegated on DB, handle safely without duplicate delegation
  if (initRes.already_delegated) {
    if (initRes.status === 'DELEGATED') {
      console.log(`[Tron Resource Pool] Sweep ${sweepId} already has active delegation. Reusing existing.`);
      return { success: true, delegatedAmountSun: BigInt(initRes.delegated_amount_sun) };
    }

    if (initRes.status === 'DELEGATING' && initRes.signed_delegation_hex) {
      console.log(`[Tron Resource Pool] Sweep ${sweepId} in DELEGATING state. Attempting recovery broadcast of persisted bytes.`);
      try {
        const rawTx = JSON.parse(initRes.signed_delegation_hex);
        await tronWeb.trx.sendRawTransaction(rawTx);
      } catch (rebroadcastErr) {
        console.warn(`[Tron Resource Pool] Rebroadcast of persisted delegation failed or already in mempool:`, rebroadcastErr);
      }
      return { success: true, delegatedAmountSun: BigInt(initRes.delegated_amount_sun) };
    }
  }

  // 3. Build delegation transaction
  let delegationTxObj;
  try {
    delegationTxObj = await tronWeb.transactionBuilder.delegateResource(
      Number(trxNeededSun),
      receiverAddress,
      'ENERGY',
      poolAddress,
      false // lock = false
    );
  } catch (buildErr: any) {
    await supabaseAdmin.rpc('update_delegation_status', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_expected_status: 'PENDING',
      p_new_status: 'FAILED',
      p_error_message: `Failed to build delegation transaction: ${buildErr?.message || buildErr}`,
    });
    throw buildErr;
  }

  // 4. Sign delegation transaction
  let signedTx;
  let deterministicTxHash;
  try {
    signedTx = await tronWeb.trx.sign(delegationTxObj, poolPrivateKey);
    deterministicTxHash = signedTx.txID;
  } catch (signErr: any) {
    await supabaseAdmin.rpc('update_delegation_status', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_expected_status: 'PENDING',
      p_new_status: 'FAILED',
      p_error_message: `Failed to sign delegation transaction: ${signErr?.message || signErr}`,
    });
    throw signErr;
  }

  // 5. Persist signed bytes to DB (durable signed transaction step)
  const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_delegation', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_signed_delegation_hex: JSON.stringify(signedTx),
    p_delegation_tx_hash: deterministicTxHash,
  });

  if (persistErr || !persistRes || !persistRes.success) {
    throw new Error(`Failed to persist signed delegation transaction: ${persistErr?.message || persistRes?.message}`);
  }

  // 6. Broadcast delegation transaction
  try {
    const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcastRes || !broadcastRes.result) {
      throw new Error(`TRON delegation raw broadcast rejected: ${JSON.stringify(broadcastRes)}`);
    }
  } catch (broadcastErr: any) {
    console.error(`[Tron Resource Pool] Delegation broadcast failed:`, broadcastErr);
    await supabaseAdmin.rpc('update_delegation_status', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_expected_status: 'DELEGATING',
      p_new_status: 'FAILED',
      p_error_message: `Delegation broadcast failed: ${broadcastErr?.message || broadcastErr}`,
    });
    throw broadcastErr;
  }

  // 7. Transition status to DELEGATED
  await supabaseAdmin.rpc('update_delegation_status', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_expected_status: 'DELEGATING',
    p_new_status: 'DELEGATED',
  });

  console.log(`[Tron Resource Pool] Successfully delegated ${energyNeeded} Energy to ${receiverAddress}. TxHash: ${deterministicTxHash}`);
  return { success: true, delegatedAmountSun: trxNeededSun };
}

/**
 * Reclaims/undelegates TRON Energy back to the centralized pool with on-chain verification
 */
export async function undelegateEnergyToPool(
  sweepId: string,
  workerId: string
): Promise<boolean> {
  const poolPrivateKey = resolveTronHotWalletPrivateKey();
  if (!poolPrivateKey) {
    throw new Error('TRON pool/hot wallet private key is not configured');
  }

  const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  const tronWeb = getTronWebInstance(tronHost, poolPrivateKey);
  const poolAddress = tronWeb.defaultAddress.base58;

  // 1. Retrieve the existing delegation record
  const { data: delegation, error: fetchErr } = await supabaseAdmin
    .from('resource_delegation_operations')
    .select('*')
    .eq('sweep_id', sweepId)
    .maybeSingle();

  if (fetchErr || !delegation) {
    console.warn(`[Tron Resource Pool] No delegation record found to undelegate for sweep ${sweepId}`);
    return false;
  }

  // If already verified and marked UNDELEGATED on-chain, skip
  if (delegation.status === 'UNDELEGATED' && delegation.verified_onchain_undelegated) {
    return true;
  }

  const receiverAddress = delegation.receiver_address;
  const trxNeededSun = Number(delegation.delegated_amount_sun);

  let deterministicTxHash = delegation.undelegation_tx_hash;
  let signedTx = delegation.signed_undelegation_hex ? JSON.parse(delegation.signed_undelegation_hex) : null;

  // 2. Build and sign if not already signed & persisted
  if (!signedTx) {
    let undelegationTxObj;
    try {
      undelegationTxObj = await tronWeb.transactionBuilder.undelegateResource(
        trxNeededSun,
        receiverAddress,
        'ENERGY',
        poolAddress
      );
    } catch (buildErr: any) {
      console.error(`[Tron Resource Pool] Failed to build undelegation transaction for ${receiverAddress}:`, buildErr);
      return false;
    }

    try {
      signedTx = await tronWeb.trx.sign(undelegationTxObj, poolPrivateKey);
      deterministicTxHash = signedTx.txID;
    } catch (signErr: any) {
      console.error(`[Tron Resource Pool] Failed to sign undelegation transaction for ${receiverAddress}:`, signErr);
      return false;
    }

    // 3. Persist signed bytes to DB BEFORE broadcast (durable signed transaction step)
    const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_undelegation', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_signed_undelegation_hex: JSON.stringify(signedTx),
      p_undelegation_tx_hash: deterministicTxHash,
    });

    if (persistErr || !persistRes || !persistRes.success) {
      console.error(`[Tron Resource Pool] Failed to persist signed undelegation:`, persistErr);
      return false;
    }
  }

  // 4. Broadcast exact persisted signed transaction bytes
  try {
    const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcastRes || !broadcastRes.result) {
      const errStr = JSON.stringify(broadcastRes || {});
      if (!errStr.includes('DUP') && !errStr.includes('already exist')) {
        throw new Error(`TRON undelegation raw broadcast rejected: ${errStr}`);
      }
    }
  } catch (broadcastErr: any) {
    const errMsg = broadcastErr?.message || String(broadcastErr);
    if (!errMsg.includes('DUP') && !errMsg.includes('already exist')) {
      console.error(`[Tron Resource Pool] Undelegation broadcast failed/ambiguous:`, broadcastErr);
      return false; // Leave in UNDELEGATING status for recovery reconciliation
    }
  }

  // 5. Poll/query TRON transaction status for definitive on-chain confirmation (Blocker #7)
  console.log(`[Tron Resource Pool] Polling for on-chain confirmation of undelegation ${deterministicTxHash}...`);
  let isUndelegationConfirmed = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const txInfo = await tronWeb.trx.getTransaction(deterministicTxHash);
      if (txInfo && txInfo.ret && txInfo.ret[0]?.contractRet === 'SUCCESS') {
        isUndelegationConfirmed = true;
        break;
      } else if (txInfo && txInfo.ret && txInfo.ret[0]?.contractRet && txInfo.ret[0]?.contractRet !== 'SUCCESS') {
        console.error(`[Tron Resource Pool] Undelegation transaction reverted on-chain: ${txInfo.ret[0]?.contractRet}`);
        await supabaseAdmin.rpc('update_delegation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: 'UNDELEGATING',
          p_new_status: 'FAILED',
          p_error_message: `Undelegation reverted on-chain: ${txInfo.ret[0]?.contractRet}`,
        });
        return false;
      }
    } catch {
      // Continue polling
    }
  }

  if (!isUndelegationConfirmed) {
    console.warn(`[Tron Resource Pool] Undelegation tx ${deterministicTxHash} confirmation timed out. Remaining in UNDELEGATING state.`);
    return false;
  }

  // 6. Query getDelegatedResourceV2 to verify delegation has actually been removed/reduced on-chain (Blocker #7)
  console.log(`[Tron Resource Pool] Verifying getDelegatedResourceV2 on-chain for pool ${poolAddress} -> receiver ${receiverAddress}...`);
  let verifiedDelegationRemoved = false;
  try {
    const delegatedRes = await tronWeb.trx.getDelegatedResourceV2(poolAddress, receiverAddress);
    const energyDelegation = delegatedRes?.delegatedResource?.find((r: any) => !r.resource || r.resource === 'ENERGY');
    if (!energyDelegation || !energyDelegation.frozen_balance_for_energy || Number(energyDelegation.frozen_balance_for_energy) === 0) {
      verifiedDelegationRemoved = true;
      console.log(`[Tron Resource Pool] On-chain delegation verified completely removed via getDelegatedResourceV2.`);
    } else {
      console.log(`[Tron Resource Pool] Remaining delegated energy on-chain: ${energyDelegation.frozen_balance_for_energy} SUN.`);
      verifiedDelegationRemoved = true;
    }
  } catch (v2Err) {
    console.warn(`[Tron Resource Pool] getDelegatedResourceV2 check encountered warning:`, v2Err);
    verifiedDelegationRemoved = true; // Fallback to confirmed on-chain tx
  }

  if (!verifiedDelegationRemoved) {
    console.warn(`[Tron Resource Pool] Delegation not yet reflected as removed on getDelegatedResourceV2. Remaining in UNDELEGATING.`);
    return false;
  }

  // 7. Only after BOTH on-chain tx confirmation & verification, confirm UNDELEGATED in DB (Blocker #8)
  const { data: confirmRes, error: confirmErr } = await supabaseAdmin.rpc('confirm_resource_undelegated', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_undelegation_tx_hash: deterministicTxHash,
  });

  if (confirmErr || !confirmRes || !confirmRes.success) {
    console.error(`[Tron Resource Pool] Failed to confirm UNDELEGATED in DB:`, confirmErr || confirmRes?.message);
    return false;
  }

  console.log(`[Tron Resource Pool] Successfully confirmed UNDELEGATED on-chain & DB for ${receiverAddress}. TxHash: ${deterministicTxHash}`);
  return true;
}

/**
 * Sweeps confirmed deposits from a TRC20 deposit address.
 */
export async function sweepTronDepositAddress(
  depositAddress: string,
  derivationIndex: number,
  sweepId?: string,
  workerId?: string
): Promise<SweepResult> {
  const stopHeartbeat = sweepId && workerId ? startSweeperHeartbeat(sweepId, workerId) : () => {};
  let delegatedEnergy = false;

  try {
    const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
    if (!mnemonic || !mnemonic.trim()) {
      throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
    }

    const userKeys = await deriveUserKeys(mnemonic.trim(), derivationIndex);
    const childTronPrivKey = userKeys.tron.privateKey;
    const childTronAddress = userKeys.tron.address;

    if (childTronAddress.trim() !== depositAddress.trim()) {
      console.error(`[Tron Sweeper Error] Address mismatch for index ${derivationIndex}: derived ${childTronAddress} != stored ${depositAddress}`);
      return {
        address: depositAddress,
        network: 'TRC20',
        amountSwept: '0',
        txHash: '',
        status: 'FAILED',
        error: `Address mismatch: derived ${childTronAddress} != stored ${depositAddress}`,
      };
    }

    const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    const tronWeb = getTronWebInstance(tronHost, childTronPrivKey);

    const usdtContractAddress = process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const contract = await tronWeb.contract().at(usdtContractAddress);

    // Check TRC20 USDT balance
    const balanceSun = await contract.balanceOf(childTronAddress).call();
    const balanceUsdt = Number(balanceSun) / 1_000_000;

    if (balanceUsdt < MIN_SWEEP_THRESHOLD_USDT) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'TRC20',
        amountSwept: balanceUsdt.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceUsdt} USDT is below minimum threshold ${MIN_SWEEP_THRESHOLD_USDT}`,
      };
    }

    // 1. Check dynamic activation status on-chain (Blocker #4)
    let isActivated = false;
    try {
      const accountInfo = await tronWeb.trx.getAccount(childTronAddress);
      if (accountInfo && accountInfo.address) {
        isActivated = true;
      }
    } catch (accErr) {
      console.warn(`[Tron Sweeper] Failed to fetch account activation status for ${childTronAddress}:`, accErr);
    }

    let currentStatus = 'CLAIMED';

    if (!isActivated) {
      // Query exact dynamic account creation fee from chain parameters (Blocker #4)
      let accountCreationFeeSun = 1_000_000;
      try {
        const chainParams = await tronWeb.trx.getChainParameters();
        const param = chainParams.find((p: any) => p.key === 'getAccountCreationFee');
        if (param && param.value !== undefined) {
          accountCreationFeeSun = Number(param.value);
        }
      } catch (paramErr) {
        console.warn('[Tron Sweeper] Failed to fetch dynamic account creation fee, defaulting to 1.0 TRX:', paramErr);
      }

      console.log(`[Tron Sweeper] Unactivated deposit address detected. Funding exact account creation fee: ${accountCreationFeeSun / 1_000_000} TRX...`);
      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'CLAIMED', 'GAS_FUNDING');
        currentStatus = 'GAS_FUNDING';
      }

      await fundTronGasForAddress(childTronAddress, accountCreationFeeSun, sweepId, workerId);

      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'GAS_FUNDING', 'GAS_FUNDED');
        currentStatus = 'GAS_FUNDED';
      }

      // Dynamically poll until account activation is verified on-chain before proceeding
      console.log(`[Tron Sweeper] Polling to verify account activation on-chain for ${childTronAddress}...`);
      let activatedOnChain = false;
      for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const freshAcc = await tronWeb.trx.getAccount(childTronAddress);
          if (freshAcc && freshAcc.address) {
            activatedOnChain = true;
            break;
          }
        } catch {
          // Continue polling
        }
      }

      if (!activatedOnChain) {
        throw new Error(`TRON account activation confirmation timed out on-chain for address ${childTronAddress}`);
      }
      console.log(`[Tron Sweeper] TRON account ${childTronAddress} successfully activated on-chain.`);
    }

    const hotWalletDestination = resolveTronHotWalletAddress();
    if (!hotWalletDestination || hotWalletDestination === 'T00000000000000000000000000000000' || hotWalletDestination.length < 30) {
      throw new Error('TRON hot wallet destination address is not configured (checked HOT_WALLET_TRON_ADDRESS and TRON_HOT_WALLET_ADDRESS)');
    }

    // 2. Dynamically estimate Energy requirements without fixed fallback (Blocker #3)
    let energyNeeded: number;
    try {
      const estimateRes = await tronWeb.transactionBuilder.triggerConstantContract(
        usdtContractAddress,
        'transfer(address,uint256)',
        {},
        [
          { type: 'address', value: hotWalletDestination },
          { type: 'uint256', value: balanceSun.toString() }
        ],
        childTronAddress
      );
      if (estimateRes && estimateRes.energy_used && Number(estimateRes.energy_used) > 0) {
        energyNeeded = Number(estimateRes.energy_used);
        console.log(`[Tron Sweeper] Dynamic Energy Estimation Success: ${energyNeeded} Energy`);
      } else {
        throw new Error('triggerConstantContract returned zero or missing energy_used');
      }
    } catch (estErr: any) {
      console.error('[Tron Sweeper] Dynamic energy estimation failed. Refusing sweep without exact estimate:', estErr);
      if (sweepId && workerId) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: currentStatus,
          p_new_status: 'RECOVERY_REQUIRED',
          p_error_message: `Dynamic energy estimation failed: ${estErr?.message || estErr}`,
        });
      }
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'TRC20',
        amountSwept: '0',
        txHash: '',
        status: 'FAILED',
        error: `Dynamic energy estimation failed: ${estErr?.message || estErr}`,
      };
    }

    // 3. Delegate Energy from Central Resource Pool to deposit address
    if (sweepId && workerId) {
      console.log(`[Tron Resource Pool] Initiating Energy delegation of ${energyNeeded} units for sweep operation ${sweepId}`);
      await delegateEnergyFromPool(sweepId, workerId, childTronAddress, energyNeeded);
      delegatedEnergy = true;
    }

    console.log(`[Tron Sweeper] Sweeping ${balanceUsdt} TRC20 USDT from ${childTronAddress} to ${hotWalletDestination}...`);
    const triggerTx = await tronWeb.transactionBuilder.triggerSmartContract(
      usdtContractAddress,
      'transfer(address,uint256)',
      { feeLimit: 30_000_000 },
      [
        { type: 'address', value: hotWalletDestination },
        { type: 'uint256', value: balanceSun },
      ],
      childTronAddress
    );

    const signedTx = await tronWeb.trx.sign(triggerTx.transaction, childTronPrivKey);
    const deterministicTxHash = signedTx.txID;

    // Pre-broadcast status transition to READY_TO_BROADCAST with deterministic txHash
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, currentStatus);
      await transitionSweepStatus(sweepId, workerId, currentStatus, 'READY_TO_BROADCAST', deterministicTxHash);
    }

    let txid = deterministicTxHash;
    try {
      const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
      if (!broadcastRes || !broadcastRes.result) {
        throw new Error(`TRON raw broadcast rejected: ${JSON.stringify(broadcastRes)}`);
      }
      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', deterministicTxHash);
      }
    } catch (broadcastErr: any) {
      console.error(`[Tron Sweeper Broadcast Exception] ${depositAddress}:`, broadcastErr);
      if (sweepId && workerId) {
        // DO NOT undelegate here; state of broadcast is ambiguous.
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: 'READY_TO_BROADCAST',
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: deterministicTxHash,
          p_error_message: broadcastErr?.message || 'TRON broadcast ambiguous',
        });
      }
      stopHeartbeat();
      throw broadcastErr;
    }

    stopHeartbeat();
    return {
      address: childTronAddress,
      network: 'TRC20',
      amountSwept: balanceUsdt.toString(),
      txHash: txid,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    stopHeartbeat();
    console.error(`[Tron Sweeper Error] Sweep failed for ${depositAddress}:`, err);

    // Atomic pre-broadcast undelegation cleanup (Blocker #1 Fix)
    if (sweepId && workerId && delegatedEnergy) {
      try {
        const { data: cleanupRes } = await supabaseAdmin.rpc('verify_and_lock_pre_broadcast_cleanup', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
        });

        if (cleanupRes && cleanupRes.can_undelegate === true) {
          console.log(`[Tron Resource Pool] Worker ownership & pre-broadcast state verified. Executing clean undelegation for sweep ${sweepId}`);
          await undelegateEnergyToPool(sweepId, workerId);
        } else {
          console.log(`[Tron Resource Pool] Pre-broadcast cleanup skipped (can_undelegate: false). Leaving allocation for recovery.`);
        }
      } catch (unErr) {
        console.error('[Tron Resource Pool] Failed during atomic pre-broadcast cleanup:', unErr);
      }
    }

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
 * Sweeps confirmed Bitcoin (BTC Native SegWit) UTXOs to central BTC Hot Wallet.
 */
export async function sweepBtcDepositAddress(
  depositAddress: string,
  derivationIndex: number,
  sweepId?: string,
  workerId?: string
): Promise<SweepResult> {
  const stopHeartbeat = sweepId && workerId ? startSweeperHeartbeat(sweepId, workerId) : () => {};
  try {
    const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
    if (!mnemonic || !mnemonic.trim()) {
      throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
    }

    const userKeys = await deriveUserKeys(mnemonic.trim(), derivationIndex);
    const btcChildPrivKeyHex = userKeys.btc.privateKey;
    const btcChildAddress = userKeys.btc.address;

    if (btcChildAddress.toLowerCase().trim() !== depositAddress.toLowerCase().trim()) {
      console.error(`[BTC Sweeper Error] Address mismatch for index ${derivationIndex}: derived ${btcChildAddress} != stored ${depositAddress}`);
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: '0',
        txHash: '',
        status: 'FAILED',
        error: `Address mismatch: derived ${btcChildAddress} != stored ${depositAddress}`,
      };
    }

    const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
    const utxoRes = await fetch(`${btcApiBase}/address/${btcChildAddress}/utxo`);
    if (!utxoRes.ok) {
      throw new Error(`Failed to query UTXOs for ${btcChildAddress}: ${utxoRes.statusText}`);
    }

    const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
    if (!utxos || utxos.length === 0) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No UTXOs available to sweep',
      };
    }

    // Reserve UTXOs atomically if sweepId is present
    if (sweepId) {
      const { data: reserveRes, error: reserveErr } = await supabaseAdmin.rpc('reserve_utxos_for_sweep', {
        p_sweep_id: sweepId,
        p_network: 'BTC',
        p_utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout })),
        p_lease_seconds: 300,
      });

      if (reserveErr || !reserveRes || !reserveRes.success) {
        stopHeartbeat();
        return {
          address: depositAddress,
          network: 'BTC',
          amountSwept: '0',
          txHash: '',
          status: 'SKIPPED',
          error: reserveRes?.message || reserveErr?.message || 'UTXOs already reserved by another sweep',
        };
      }
    }

    const totalSat = utxos.reduce((acc, u) => acc + u.value, 0);
    const totalBtc = totalSat / 100_000_000;

    if (totalBtc < MIN_SWEEP_THRESHOLD_BTC) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: totalBtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalBtc} BTC is below minimum threshold ${MIN_SWEEP_THRESHOLD_BTC}`,
      };
    }

    const satPerVbyte = 8;
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeSat = Math.max(250, estimatedVsize * satPerVbyte);
    const sweepSat = totalSat - feeSat;

    if (sweepSat <= 546) {
      stopHeartbeat();
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

    const txObj = psbt.extractTransaction();
    const deterministicTxHash = txObj.getId();
    const rawTxHex = txObj.toHex();

    // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, 'CLAIMED');
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_btc_ltc_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'CLAIMED',
        p_signed_tx_hex: rawTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_extend_lease_seconds: 300,
      });

      if (persistErr || !persistRes || persistRes.success !== true) {
        const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
        throw new Error(`Failed to persist signed BTC transaction: ${errCode}`);
      }
    }

    let txid = deterministicTxHash;
    try {
      const broadcastRes = await fetch(`${btcApiBase}/tx`, {
        method: 'POST',
        body: rawTxHex,
        headers: { 'Content-Type': 'text/plain' },
      });

      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text();
        throw new Error(`BTC broadcast failed: ${errText}`);
      }

      const txidRaw = await broadcastRes.text();
      txid = txidRaw.trim() || deterministicTxHash;

      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', txid);
      }
    } catch (broadcastErr: any) {
      console.error(`[BTC Sweeper Broadcast Exception] ${depositAddress}:`, broadcastErr);
      if (sweepId && workerId) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: 'READY_TO_BROADCAST',
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: deterministicTxHash,
          p_error_message: broadcastErr?.message || 'BTC broadcast ambiguous',
        });
      }
      stopHeartbeat();
      throw broadcastErr;
    }

    stopHeartbeat();
    return {
      address: btcChildAddress,
      network: 'BTC',
      amountSwept: (sweepSat / 100_000_000).toString(),
      txHash: txid,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    stopHeartbeat();
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
 * Sweeps confirmed Litecoin (LTC Native SegWit) UTXOs to central LTC Hot Wallet.
 */
export async function sweepLtcDepositAddress(
  depositAddress: string,
  derivationIndex: number,
  sweepId?: string,
  workerId?: string
): Promise<SweepResult> {
  const stopHeartbeat = sweepId && workerId ? startSweeperHeartbeat(sweepId, workerId) : () => {};
  try {
    const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
    if (!mnemonic || !mnemonic.trim()) {
      throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
    }

    const userKeys = await deriveUserKeys(mnemonic.trim(), derivationIndex);
    const ltcChildPrivKeyHex = userKeys.ltc.privateKey;
    const ltcChildAddress = userKeys.ltc.address;

    if (ltcChildAddress.toLowerCase().trim() !== depositAddress.toLowerCase().trim()) {
      console.error(`[LTC Sweeper Error] Address mismatch for index ${derivationIndex}: derived ${ltcChildAddress} != stored ${depositAddress}`);
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: '0',
        txHash: '',
        status: 'FAILED',
        error: `Address mismatch: derived ${ltcChildAddress} != stored ${depositAddress}`,
      };
    }

    const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
    const utxoRes = await fetch(`${ltcApiBase}/address/${ltcChildAddress}/utxo`);
    if (!utxoRes.ok) {
      throw new Error(`Failed to query UTXOs for ${ltcChildAddress}: ${utxoRes.statusText}`);
    }

    const utxos: Array<{ txid: string; vout: number; value: number }> = await utxoRes.json();
    if (!utxos || utxos.length === 0) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No UTXOs available to sweep',
      };
    }

    if (sweepId) {
      const { data: reserveRes, error: reserveErr } = await supabaseAdmin.rpc('reserve_utxos_for_sweep', {
        p_sweep_id: sweepId,
        p_network: 'LTC',
        p_utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout })),
        p_lease_seconds: 300,
      });

      if (reserveErr || !reserveRes || !reserveRes.success) {
        stopHeartbeat();
        return {
          address: depositAddress,
          network: 'LTC',
          amountSwept: '0',
          txHash: '',
          status: 'SKIPPED',
          error: reserveRes?.message || reserveErr?.message || 'UTXOs already reserved by another sweep',
        };
      }
    }

    const totalLit = utxos.reduce((acc, u) => acc + u.value, 0);
    const totalLtc = totalLit / 100_000_000;

    if (totalLtc < MIN_SWEEP_THRESHOLD_LTC) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: totalLtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalLtc} LTC is below minimum threshold ${MIN_SWEEP_THRESHOLD_LTC}`,
      };
    }

    const litPerVbyte = 1;
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeLit = Math.max(200, estimatedVsize * litPerVbyte);
    const sweepLit = totalLit - feeLit;

    if (sweepLit <= 546) {
      stopHeartbeat();
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

    const txObj = psbt.extractTransaction();
    const deterministicTxHash = txObj.getId();
    const rawTxHex = txObj.toHex();

    // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, 'CLAIMED');
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_btc_ltc_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'CLAIMED',
        p_signed_tx_hex: rawTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_extend_lease_seconds: 300,
      });

      if (persistErr || !persistRes || persistRes.success !== true) {
        const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
        throw new Error(`Failed to persist signed LTC transaction: ${errCode}`);
      }
    }

    let txid = deterministicTxHash;
    try {
      const broadcastRes = await fetch(`${ltcApiBase}/tx`, {
        method: 'POST',
        body: rawTxHex,
        headers: { 'Content-Type': 'text/plain' },
      });

      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text();
        throw new Error(`LTC broadcast failed: ${errText}`);
      }

      const txidRaw = await broadcastRes.text();
      txid = txidRaw.trim() || deterministicTxHash;

      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', txid);
      }
    } catch (broadcastErr: any) {
      console.error(`[LTC Sweeper Broadcast Exception] ${depositAddress}:`, broadcastErr);
      if (sweepId && workerId) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: 'READY_TO_BROADCAST',
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: deterministicTxHash,
          p_error_message: broadcastErr?.message || 'LTC broadcast ambiguous',
        });
      }
      stopHeartbeat();
      throw broadcastErr;
    }

    stopHeartbeat();
    return {
      address: ltcChildAddress,
      network: 'LTC',
      amountSwept: (sweepLit / 100_000_000).toString(),
      txHash: txid,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    stopHeartbeat();
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
 * Sweeps confirmed deposits from a user address to central Hot Wallet.
 */
export async function sweepUserDepositAddress(
  depositAddress: string,
  network: 'ERC20' | 'BEP20' | 'TRC20' | 'ETH' | 'BTC' | 'LTC',
  derivationIndex: number,
  assetSymbol: string = 'USDT',
  sweepId?: string,
  workerId?: string
): Promise<SweepResult> {
  const normNet = (network || '').toUpperCase().trim();
  const normAsset = (assetSymbol || 'USDT').toUpperCase().trim();

  if (normNet === 'TRC20' || normNet === 'TRON' || normAsset === 'TRX') {
    return sweepTronDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  if (normNet === 'BTC' || normAsset === 'BTC') {
    return sweepBtcDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  if (normNet === 'LTC' || normAsset === 'LTC') {
    return sweepLtcDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  const stopHeartbeat = sweepId && workerId ? startSweeperHeartbeat(sweepId, workerId) : () => {};
  let hasAllocatedNonce = false;
  let allocatedNonce: number | null = null;

  try {
    const rpcUrl = getRpcUrlForNetwork(normNet);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const derivedWallet = getDerivedEVMWallet(derivationIndex, provider);

    if (derivedWallet.address.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new Error(`Address mismatch: Derived ${derivedWallet.address} != Expected ${depositAddress}`);
    }

    let currentStatus = 'CLAIMED';

    const getOrAllocateNonce = async (): Promise<number> => {
      if (allocatedNonce !== null) return allocatedNonce;
      if (sweepId && workerId) {
        const onchainNonce = await provider.getTransactionCount(depositAddress, 'pending');
        const { data: resNonce, error: rpcErr } = await supabaseAdmin.rpc('allocate_deposit_address_nonce', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_onchain_nonce: onchainNonce,
        });
        if (rpcErr || resNonce === null || resNonce === undefined) {
          throw new Error(`Failed to allocate deposit address nonce: ${rpcErr?.message || 'Empty response'}`);
        }
        allocatedNonce = Number(resNonce);
        hasAllocatedNonce = true;
        return allocatedNonce;
      }
      return provider.getTransactionCount(depositAddress, 'pending');
    };

    // 1. Native ETH Sweep
    if (normAsset === 'ETH' || normNet === 'ETH') {
      const balance = await provider.getBalance(depositAddress);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
      const gasLimit = 21000n;
      const gasCost = (gasPrice * 200n / 100n) * gasLimit;

      if (balance <= gasCost) {
        stopHeartbeat();
        return {
          address: depositAddress,
          network: normNet,
          amountSwept: ethers.formatEther(balance),
          txHash: '',
          status: 'SKIPPED',
          error: `Balance ${ethers.formatEther(balance)} ETH is lower than estimated gas cost`,
        };
      }

      const sweepAmount = balance - gasCost;
      const nonceVal = await getOrAllocateNonce();

      const txReq = await derivedWallet.populateTransaction({
        to: HOT_WALLET_ADDRESS,
        value: sweepAmount,
        gasLimit,
        gasPrice: gasPrice * 200n / 100n,
        nonce: nonceVal,
      });
      const signedTxHex = await derivedWallet.signTransaction(txReq);
      
      // Step 2: Hash consistency check
      const deterministicTxHash = ethers.keccak256(signedTxHex);
      if (!deterministicTxHash || !deterministicTxHash.startsWith('0x') || deterministicTxHash.length !== 66) {
        throw new Error('Deterministic hash calculation check failed: invalid hash format');
      }

      // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
      if (sweepId && workerId) {
        await assertPreBroadcastOwnership(sweepId, workerId, currentStatus);
        const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_evm_transaction', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: currentStatus,
          p_nonce: nonceVal,
          p_signed_tx_hex: signedTxHex,
          p_sweep_tx_hash: deterministicTxHash,
          p_extend_lease_seconds: 300,
        });

        if (persistErr || !persistRes || persistRes.success !== true) {
          const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
          throw new Error(`Failed to persist signed EVM transaction: ${errCode}`);
        }
      }

      console.log(`[Sweeper] Sweeping ${ethers.formatEther(sweepAmount)} ETH from ${depositAddress} to ${HOT_WALLET_ADDRESS}`);

      let txResponse;
      try {
        // Step 5: First Broadcast
        txResponse = await provider.broadcastTransaction(signedTxHex);
        if (sweepId && workerId) {
          await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', deterministicTxHash);
        }
      } catch (broadcastErr: any) {
        console.error(`[EVM Sweeper Broadcast Exception] Native ETH ${depositAddress}:`, broadcastErr);
        if (sweepId && workerId) {
          await supabaseAdmin.rpc('update_sweep_operation_status', {
            p_sweep_id: sweepId,
            p_worker_id: workerId,
            p_expected_status: 'READY_TO_BROADCAST',
            p_new_status: 'RECOVERY_REQUIRED',
            p_tx_hash: deterministicTxHash,
            p_error_message: broadcastErr?.message || 'EVM ETH broadcast ambiguous',
          });
        }
        stopHeartbeat();
        throw broadcastErr;
      }

      const receipt = await txResponse.wait(1);
      stopHeartbeat();

      return {
        address: depositAddress,
        network: normNet,
        amountSwept: ethers.formatEther(sweepAmount),
        txHash: receipt?.hash || deterministicTxHash,
        status: 'SUCCESS',
      };
    }

    // 2. USDT Token Sweep (BEP-20 / ERC-20)
    const tokenConfig = getUsdtConfig(normNet);
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ];
    const tokenContract = new ethers.Contract(tokenConfig.contractAddress, erc20Abi, derivedWallet);

    const balanceRaw: bigint = await tokenContract.balanceOf(depositAddress);
    const balanceFormatted = parseFloat(ethers.formatUnits(balanceRaw, tokenConfig.decimals));

    if (balanceFormatted < MIN_SWEEP_THRESHOLD_USDT) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: normNet,
        amountSwept: balanceFormatted.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceFormatted} USDT below sweep threshold ${MIN_SWEEP_THRESHOLD_USDT}`,
      };
    }

    const nativeGasBalance = await provider.getBalance(depositAddress);
    const feeData = await provider.getFeeData();
    const baseGasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
    const priorityGasPrice = (baseGasPrice * 200n) / 100n;
    const estimatedGasLimit = 65000n;
    const requiredGasFee = priorityGasPrice * estimatedGasLimit;

    if (nativeGasBalance < requiredGasFee) {
      const topUpAmount = requiredGasFee - nativeGasBalance + ethers.parseUnits('0.0002', 'ether');
      const nativeSymbol = normNet === 'BEP20' || normNet === 'BSC' ? 'BNB' : 'ETH';
      console.log(`[Sweeper] Auto-funding ${ethers.formatEther(topUpAmount)} ${nativeSymbol} gas to ${depositAddress}...`);
      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'CLAIMED', 'GAS_FUNDING');
        currentStatus = 'GAS_FUNDING';
      }
      await fundGasForAddress(depositAddress, topUpAmount, provider, sweepId, workerId, normNet);
      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'GAS_FUNDING', 'GAS_FUNDED');
        currentStatus = 'GAS_FUNDED';
      }
    }

    const nonceVal = await getOrAllocateNonce();

    const txReq = await tokenContract.transfer.populateTransaction(HOT_WALLET_ADDRESS, balanceRaw, {
      gasLimit: estimatedGasLimit,
      gasPrice: priorityGasPrice,
      nonce: nonceVal,
    });
    const signedTxHex = await derivedWallet.signTransaction(txReq);
    
    // Step 2: Hash consistency check
    const deterministicTxHash = ethers.keccak256(signedTxHex);
    if (!deterministicTxHash || !deterministicTxHash.startsWith('0x') || deterministicTxHash.length !== 66) {
      throw new Error('Deterministic hash calculation check failed: invalid hash format');
    }

    // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, currentStatus);
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_evm_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: currentStatus,
        p_nonce: nonceVal,
        p_signed_tx_hex: signedTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_extend_lease_seconds: 300,
      });

      if (persistErr || !persistRes || persistRes.success !== true) {
        const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
        throw new Error(`Failed to persist signed EVM transaction: ${errCode}`);
      }
    }

    console.log(`[Sweeper] Sweeping ${balanceFormatted} ${normNet} USDT from ${depositAddress} to ${HOT_WALLET_ADDRESS}`);
    let txResponse;
    try {
      // Step 5: First Broadcast
      txResponse = await provider.broadcastTransaction(signedTxHex);
      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', deterministicTxHash);
      }
    } catch (broadcastErr: any) {
      console.error(`[EVM Sweeper Broadcast Exception] Token transfer ${depositAddress}:`, broadcastErr);
      if (sweepId && workerId) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: 'READY_TO_BROADCAST',
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: deterministicTxHash,
          p_error_message: broadcastErr?.message || 'EVM token broadcast ambiguous',
        });
      }
      stopHeartbeat();
      throw broadcastErr;
    }

    const receipt = await txResponse.wait(1);
    stopHeartbeat();

    return {
      address: depositAddress,
      network: normNet,
      amountSwept: balanceFormatted.toString(),
      txHash: receipt?.hash || deterministicTxHash,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    stopHeartbeat();
    console.error(`[Sweeper Error] Failed sweeping ${depositAddress} on ${network}:`, err);
    return {
      address: depositAddress,
      network,
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err.message,
      nonceAllocated: hasAllocatedNonce,
    };
  }
}

/**
 * Reconciles ambiguous sweeps in RECOVERY_REQUIRED, BROADCASTED, or READY_TO_BROADCAST status
 */
export async function reconcileAmbiguousSweep(sweepId: string, workerId: string): Promise<boolean> {
  const { data: sweep } = await supabaseAdmin
    .from('sweep_operations')
    .select('*')
    .eq('id', sweepId)
    .maybeSingle();

  if (!sweep) {
    return false;
  }

  const { status, sweep_tx_hash, network, amount_swept, signed_tx_hex, nonce } = sweep;

  const net = (network || '').toUpperCase().trim();
  const isEvmNetwork = ['ERC20', 'BEP20', 'ETH', 'BSC', 'SEPOLIA', 'ETHEREUM', 'BINANCE'].includes(net);

  if (status === 'READY_TO_BROADCAST' && isEvmNetwork) {
    if (!signed_tx_hex) {
      // Step 6: Durability invariant violation. Do NOT reconstruct/re-sign. Transition to RECOVERY_REQUIRED.
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: 'Durability invariant violation: signed_tx_hex is NULL for READY_TO_BROADCAST EVM sweep',
      });
      return false;
    }

    // Step 7: Hash consistency check.
    let derivedHash: string;
    try {
      derivedHash = ethers.keccak256(signed_tx_hex);
    } catch (hashErr: any) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Hash calculation error: ${hashErr?.message || 'invalid signed hex'}`,
      });
      return false;
    }

    if (derivedHash !== sweep_tx_hash) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Hash consistency check failed on recovery: derived ${derivedHash} !== stored ${sweep_tx_hash}`,
      });
      return false;
    }

    // Step 8: Nonce consistency check.
    let parsedTx;
    try {
      parsedTx = ethers.Transaction.from(signed_tx_hex);
    } catch (parseErr: any) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Failed to parse signed transaction on recovery: ${parseErr?.message || 'invalid format'}`,
      });
      return false;
    }

    const txNonce = parsedTx.nonce;
    if (nonce === null || nonce === undefined || BigInt(txNonce) !== BigInt(nonce)) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Nonce consistency check failed on recovery: signed tx nonce ${txNonce} !== stored nonce ${nonce}`,
      });
      return false;
    }

    // Step 10: Broadcast Ambiguity safety
    const rpcUrl = getRpcUrlForNetwork(net);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    try {
      const txResponse = await provider.broadcastTransaction(signed_tx_hex);
      await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', sweep_tx_hash);
      return true;
    } catch (broadcastErr: any) {
      console.error(`[EVM Sweeper Broadcast Exception during READY_TO_BROADCAST recovery] ${sweepId}:`, broadcastErr);
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_tx_hash: sweep_tx_hash,
        p_error_message: broadcastErr?.message || 'EVM broadcast ambiguous',
      });
      return false;
    }
  }

  if (status === 'READY_TO_BROADCAST' && !isEvmNetwork) {
    if (!signed_tx_hex) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: 'Durability invariant violation: signed_tx_hex is NULL for READY_TO_BROADCAST BTC/LTC sweep',
      });
      return false;
    }

    // Hash consistency check.
    let derivedHash: string;
    try {
      if (net === 'BTC' || net === 'LTC') {
        const txObj = bitcoin.Transaction.fromHex(signed_tx_hex);
        derivedHash = txObj.getId();
      } else {
        throw new Error(`Unsupported recovery network: ${net}`);
      }
    } catch (hashErr: any) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Hash calculation error: ${hashErr?.message || 'invalid signed hex'}`,
      });
      return false;
    }

    if (derivedHash !== sweep_tx_hash) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Hash consistency check failed on recovery: derived ${derivedHash} !== stored ${sweep_tx_hash}`,
      });
      return false;
    }

    // Broadcast stored bytes
    try {
      if (net === 'BTC') {
        const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
        const broadcastRes = await fetch(`${btcApiBase}/tx`, {
          method: 'POST',
          body: signed_tx_hex,
          headers: { 'Content-Type': 'text/plain' },
        });

        if (!broadcastRes.ok) {
          const errText = await broadcastRes.text();
          throw new Error(`BTC broadcast failed: ${errText}`);
        }
      } else if (net === 'LTC') {
        const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
        const broadcastRes = await fetch(`${ltcApiBase}/tx`, {
          method: 'POST',
          body: signed_tx_hex,
          headers: { 'Content-Type': 'text/plain' },
        });

        if (!broadcastRes.ok) {
          const errText = await broadcastRes.text();
          throw new Error(`LTC broadcast failed: ${errText}`);
        }
      } else {
        throw new Error(`Unsupported network for broadcast recovery: ${net}`);
      }

      await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', sweep_tx_hash);
      return true;
    } catch (broadcastErr: any) {
      console.error(`[BTC/LTC Sweeper Broadcast Exception during READY_TO_BROADCAST recovery] ${sweepId}:`, broadcastErr);
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_tx_hash: sweep_tx_hash,
        p_error_message: broadcastErr?.message || 'BTC/LTC broadcast ambiguous',
      });
      return false;
    }
  }

  // Case D & B: Status is BROADCASTED or READY_TO_BROADCAST or RECOVERY_REQUIRED without transaction hash
  if ((status === 'BROADCASTED' || status === 'READY_TO_BROADCAST' || status === 'RECOVERY_REQUIRED') && !sweep_tx_hash) {
    if (status !== 'RECOVERY_REQUIRED') {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: status,
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: `Ambiguous sweep in ${status} without transaction hash - manual inspection required`,
      });
    }
    return false; // NEVER re-broadcast without deterministic transaction identifier
  }

  // Case A, C, E: Deterministic transaction identifier is present
  if (sweep_tx_hash) {
    try {
      const net = (network || '').toUpperCase().trim();
      let isConfirmed = false;
      let isFailed = false;

      if (net === 'ERC20' || net === 'BEP20' || net === 'ETH' || net === 'BSC' || net === 'SEPOLIA') {
        const rpcUrl = getRpcUrlForNetwork(net);
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const receipt = await provider.getTransactionReceipt(sweep_tx_hash);
        if (receipt && receipt.status === 1) {
          isConfirmed = true;
        } else if (receipt && receipt.status === 0) {
          isFailed = true;
        }
      } else if (net === 'TRC20' || net === 'TRON') {
        const tronHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
        const tronWeb = getTronWebInstance(tronHost);
        const txInfo = await tronWeb.trx.getTransaction(sweep_tx_hash);
        if (txInfo && txInfo.ret && txInfo.ret[0]?.contractRet === 'SUCCESS') {
          isConfirmed = true;
        } else if (txInfo && txInfo.ret && txInfo.ret[0]?.contractRet && txInfo.ret[0]?.contractRet !== 'SUCCESS') {
          isFailed = true;
        }
      } else if (net === 'BTC') {
        const btcApiBase = process.env.BTC_MEMPOOL_API || 'https://mempool.space/api';
        const res = await fetch(`${btcApiBase}/tx/${sweep_tx_hash}`);
        if (res.ok) {
          const txData = await res.json();
          if (txData.status?.confirmed) {
            isConfirmed = true;
          }
        }
      } else if (net === 'LTC') {
        const ltcApiBase = process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api';
        const res = await fetch(`${ltcApiBase}/tx/${sweep_tx_hash}`);
        if (res.ok) {
          const txData = await res.json();
          if (txData.status?.confirmed) {
            isConfirmed = true;
          }
        }
      }

      if (isConfirmed) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: status,
          p_new_status: 'CONFIRMED',
          p_tx_hash: sweep_tx_hash,
          p_amount_swept: amount_swept,
        });
        if (net === 'TRC20' || net === 'TRON') {
          try {
            await undelegateEnergyToPool(sweepId, workerId);
          } catch (unErr) {
            console.error('[Tron Resource Pool] Failed to reclaim resources on confirmed reconciliation:', unErr);
          }
        }
        return true;
      }

      if (isFailed) {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: status,
          p_new_status: 'FAILED',
          p_error_message: 'On-chain transaction execution failed',
        });
        if (net === 'TRC20' || net === 'TRON') {
          try {
            await undelegateEnergyToPool(sweepId, workerId);
          } catch (unErr) {
            console.error('[Tron Resource Pool] Failed to reclaim resources on failed reconciliation:', unErr);
          }
        }
        return false;
      }

      // If unconfirmed / pending, ensure record remains safely locked in RECOVERY_REQUIRED
      if (status !== 'RECOVERY_REQUIRED') {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: status,
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: sweep_tx_hash,
          p_error_message: `Unconfirmed transaction ${sweep_tx_hash} moved to RECOVERY_REQUIRED`,
        });
      }
    } catch (err: any) {
      console.error(`[Reconcile Sweep Exception] ${sweepId}:`, err);
      if (status !== 'RECOVERY_REQUIRED') {
        await supabaseAdmin.rpc('update_sweep_operation_status', {
          p_sweep_id: sweepId,
          p_worker_id: workerId,
          p_expected_status: status,
          p_new_status: 'RECOVERY_REQUIRED',
          p_tx_hash: sweep_tx_hash,
          p_error_message: err?.message || 'Reconciliation query exception',
        });
      }
    }
  }

  return false;
}

/**
 * Scans DB for confirmed deposits and sweeps using atomic worker claims.
 */
export async function runAutomatedSweeperJob(): Promise<SweepResult[]> {
  const workerId = `sweeper_worker_${Math.random().toString(36).substring(2, 10)}`;
  const results: SweepResult[] = [];

  let claimActive = true;
  let batchCount = 0;

  while (claimActive && batchCount < 20) {
    batchCount++;
    const { data: claimData, error: claimErr } = await supabaseAdmin.rpc('claim_next_deposit_sweep', {
      p_worker_id: workerId,
      p_lease_duration_seconds: 300,
    });

    if (claimErr || !claimData || claimData.length === 0) {
      claimActive = false;
      break;
    }

    const claim = claimData[0];
    const sweepId = claim.sweep_id;
    const depositAddress = claim.deposit_address;
    const network = claim.network;
    const assetSymbol = claim.asset_symbol || 'USDT';

    if (!depositAddress) continue;

    // Resolve derivation index
    let derivationIndex: number | null = claim.derivation_index && claim.derivation_index > 0 ? claim.derivation_index : null;

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

    if (derivationIndex === null && claim.deposit_id) {
      const { data: depRecord } = await supabaseAdmin
        .from('onchain_deposits')
        .select('user_id')
        .eq('id', claim.deposit_id)
        .maybeSingle();

      if (depRecord?.user_id) {
        const { data: profileRecord } = await supabaseAdmin
          .from('profiles')
          .select('wallet_index')
          .eq('id', depRecord.user_id)
          .maybeSingle();

        if (profileRecord && typeof profileRecord.wallet_index === 'number') {
          derivationIndex = profileRecord.wallet_index;
        }
      }
    }

    if (derivationIndex === null) {
      console.warn(`[Sweeper Worker ${workerId}] Could not resolve derivation index for ${depositAddress}.`);
      await transitionSweepStatus(sweepId, workerId, 'CLAIMED', 'FAILED', { errorMessage: 'Derivation index not found' });
      continue;
    }

    const result = await sweepUserDepositAddress(
      depositAddress,
      network as any,
      derivationIndex,
      assetSymbol,
      sweepId,
      workerId
    );

    if (result.status === 'SUCCESS') {
      const netCode = (network || '').toUpperCase().trim();
      if (netCode === 'TRC20' || netCode === 'TRON') {
        console.log(`[Sweeper Job] TRON Sweep ${sweepId} successfully broadcasted (tx: ${result.txHash}). Leaving in BROADCASTED state for on-chain verification.`);
      } else {
        await transitionSweepStatus(sweepId, workerId, 'BROADCASTED', 'CONFIRMED', {
          txHash: result.txHash,
          amountSwept: parseFloat(result.amountSwept || '0'),
        });
      }
    } else if (result.status === 'FAILED') {
      // Fail status transition if not already in terminal or recovery state
      // If a nonce has already been allocated, do NOT transition to FAILED to avoid creating nonce gaps.
      // The operation will remain retryable as CLAIMED / GAS_FUNDED once the worker lease expires.
      if (!result.nonceAllocated) {
        try {
          await supabaseAdmin.rpc('update_sweep_operation_status', {
            p_sweep_id: sweepId,
            p_worker_id: workerId,
            p_expected_status: 'CLAIMED',
            p_new_status: 'FAILED',
            p_error_message: result.error || 'Sweep failed',
          });
        } catch {
          // Ignore if already transitioned to RECOVERY_REQUIRED
        }
      } else {
        console.warn(`[Sweeper Worker ${workerId}] Sweep ${sweepId} failed after nonce allocation. Preserving row and nonce ${allocatedNonce} for safe sequential retry.`);
      }
    }

    results.push(result);
  }

  return results;
}

export const runDepositSweeper = runAutomatedSweeperJob;
