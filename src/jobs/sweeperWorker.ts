import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { supabaseService as supabaseAdmin } from '@/lib/supabase/service-role';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import bs58 from 'bs58';

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


// Master Hot Wallet Seed / Private Key from environment
const MASTER_SEED_OR_PRIV_KEY = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY || '';
const HOT_WALLET_ADDRESS = (process.env.HOT_WALLET_ADDRESS || process.env.EVM_HOT_WALLET_ADDRESS || '').trim();
const HOT_WALLET_TRON_ADDRESS = (process.env.HOT_WALLET_TRON_ADDRESS || process.env.TRON_HOT_WALLET_ADDRESS || '').trim();
const HOT_WALLET_BTC_ADDRESS = (process.env.HOT_WALLET_BTC_ADDRESS || '').trim();
const HOT_WALLET_LTC_ADDRESS = (process.env.HOT_WALLET_LTC_ADDRESS || '').trim();

function requireEvmHotWalletAddress(): string {
  if (!HOT_WALLET_ADDRESS || !ethers.isAddress(HOT_WALLET_ADDRESS) || HOT_WALLET_ADDRESS.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error('A valid non-zero EVM HOT_WALLET_ADDRESS must be configured before gas funding or sweeping.');
  }
  return ethers.getAddress(HOT_WALLET_ADDRESS);
}

function requireBitcoinHotWalletAddress(): string {
  if (!HOT_WALLET_BTC_ADDRESS) throw new Error('HOT_WALLET_BTC_ADDRESS is not configured; BTC sweep blocked.');
  bitcoin.address.toOutputScript(HOT_WALLET_BTC_ADDRESS, bitcoin.networks.bitcoin);
  return HOT_WALLET_BTC_ADDRESS;
}

function requireLitecoinHotWalletAddress(): string {
  if (!HOT_WALLET_LTC_ADDRESS) throw new Error('HOT_WALLET_LTC_ADDRESS is not configured; LTC sweep blocked.');
  bitcoin.address.toOutputScript(HOT_WALLET_LTC_ADDRESS, LTC_NETWORK as any);
  return HOT_WALLET_LTC_ADDRESS;
}


// A child deposit address is not gas-funded or swept until its confirmed balance is worth at least $5 USD.
const MIN_SWEEP_VALUE_USD = 5.0;

async function getFreshSweepUsdPrice(assetSymbol: string): Promise<number> {
  const asset = assetSymbol.toUpperCase().trim();
  if (asset === 'USDT' || asset === 'USDC') return 1.0;

  const { data, error } = await supabaseAdmin
    .from('crypto_market_prices')
    .select('price_in_fiat, updated_at')
    .eq('asset_symbol', asset)
    .eq('fiat_symbol', 'USD')
    .maybeSingle();
  const dbPrice = Number(data?.price_in_fiat);
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
  const ageMs = Date.now() - updatedAt;
  if (!error && Number.isFinite(dbPrice) && dbPrice > 0 && Number.isFinite(updatedAt) && ageMs >= -60_000 && ageMs <= 10 * 60_000) {
    return dbPrice;
  }

  const binanceSymbol: Record<string, string> = { BTC: 'BTCUSDT', ETH: 'ETHUSDT', LTC: 'LTCUSDT' };
  const geckoId: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', LTC: 'litecoin' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol[asset] || `${asset}USDT`}`, { cache: 'no-store', signal: controller.signal });
    if (response.ok) {
      const body = await response.json();
      const price = Number(body?.price);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {
    // Try the secondary market provider below.
  } finally {
    clearTimeout(timeout);
  }

  const fallbackController = new AbortController();
  const fallbackTimeout = setTimeout(() => fallbackController.abort(), 5000);
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoId[asset] || 'tether'}&vs_currencies=usd`, { cache: 'no-store', signal: fallbackController.signal });
    if (response.ok) {
      const body = await response.json();
      const price = Number(body?.[geckoId[asset] || 'tether']?.usd);
      if (Number.isFinite(price) && price > 0) return price;
    }
  } catch {
    // Fail closed below: no gas funding or sweep without a reliable price.
  } finally {
    clearTimeout(fallbackTimeout);
  }

  throw new Error(`Fresh USD price unavailable for ${asset}; sweep was not gas-funded or broadcast.`);
}

async function meetsMinimumSweepUsdValue(assetSymbol: string, amount: number): Promise<boolean> {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const price = await getFreshSweepUsdPrice(assetSymbol);
  return amount * price >= MIN_SWEEP_VALUE_USD;
}

/**
 * An EVM receipt is not final merely because a node returned it. Require the
 * receipt block to remain canonical and the configured confirmation depth.
 * ETH uses 12 confirmations and BSC uses 15, matching the deposit policy.
 */
async function getEvmSweepReceiptFinality(
  provider: ethers.JsonRpcProvider,
  txHash: string,
  network: string
): Promise<'PENDING' | 'CONFIRMED' | 'REVERTED'> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return 'PENDING';

  const canonicalBlock = await provider.getBlock(receipt.blockNumber);
  if (!canonicalBlock || canonicalBlock.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase()) {
    return 'PENDING';
  }

  const latestBlock = await provider.getBlockNumber();
  const confirmations = latestBlock - receipt.blockNumber + 1;
  const normalizedNetwork = network.toUpperCase().trim();
  const requiredConfirmations = ['BEP20', 'BSC', 'BINANCE'].includes(normalizedNetwork) ? 15 : 12;
  if (confirmations < requiredConfirmations) return 'PENDING';

  return receipt.status === 1 ? 'CONFIRMED' : 'REVERTED';
}

/**
 * Derives user child keys from DEPOSIT_HD_MNEMONIC
 */
async function deriveUserKeys(mnemonic: string, derivationIndex: number) {
  const bip39 = await import('@scure/bip39');
  const { HDKey } = await import('@scure/bip32');
  const { bech32 } = await import('bech32');
  const crypto = await import('crypto');
  const seed = await bip39.mnemonicToSeed(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);

  // BTC BIP84: m/84'/0'/0'/0/index
  const btcChild = master.derive(`m/84'/0'/0'/0/${derivationIndex}`);
  const btcPriv = Buffer.from(btcChild.privateKey!).toString('hex');
  const btcSha = crypto.createHash('sha256').update(btcChild.publicKey!).digest();
  const btcHash = crypto.createHash('ripemd160').update(btcSha).digest();
  const btcWords = bech32.toWords(btcHash);
  btcWords.unshift(0x00);
  const btcAddress = bech32.encode('bc', btcWords);

  // LTC BIP84: m/84'/2'/0'/0/index
  const ltcChild = master.derive(`m/84'/2'/0'/0/${derivationIndex}`);
  const ltcPriv = Buffer.from(ltcChild.privateKey!).toString('hex');
  const ltcSha = crypto.createHash('sha256').update(ltcChild.publicKey!).digest();
  const ltcHash = crypto.createHash('ripemd160').update(ltcSha).digest();
  const ltcWords = bech32.toWords(ltcHash);
  ltcWords.unshift(0x00);
  const ltcAddress = bech32.encode('ltc', ltcWords);

  // TRON BIP44: m/44'/195'/0'/0/index
  const tronChild = master.derive(`m/44'/195'/0'/0/${derivationIndex}`);
  const tronPriv = Buffer.from(tronChild.privateKey!).toString('hex');
  const tronUncompressedHex = ethers.SigningKey.computePublicKey(tronChild.publicKey!, false);
  const tronPubBytes = Buffer.from(tronUncompressedHex.slice(4), 'hex');
  const tronAddressHash = ethers.keccak256(tronPubBytes);
  const tronRawAddress = Buffer.concat([Buffer.from([0x41]), Buffer.from(tronAddressHash.slice(-40), 'hex')]);
  const h1 = crypto.createHash('sha256').update(tronRawAddress).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest();
  const tronAddress = bs58.encode(Buffer.concat([tronRawAddress, h2.subarray(0, 4)]));

  // EVM BIP44: m/44'/60'/0'/0/index
  const evmChild = master.derive(`m/44'/60'/0'/0/${derivationIndex}`);
  const evmPriv = Buffer.from(evmChild.privateKey!).toString('hex');
  const evmUncompressedHex = ethers.SigningKey.computePublicKey(evmChild.publicKey!, false);
  const evmPubBytes = Buffer.from(evmUncompressedHex.slice(4), 'hex');
  const evmAddressHash = ethers.keccak256(evmPubBytes);
  const evmAddress = ethers.getAddress(`0x${evmAddressHash.slice(-40)}`);

  return {
    btc: { privateKey: btcPriv, address: btcAddress },
    ltc: { privateKey: ltcPriv, address: ltcAddress },
    tron: { privateKey: tronPriv, address: tronAddress },
    evm: { privateKey: evmPriv, address: evmAddress },
  };
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
        // Canonical BSC mainnet USDT; environment overrides could sweep a counterfeit token.
        contractAddress: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
      };
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return {
        // Canonical Ethereum mainnet USDT; environment overrides are not accepted.
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
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
  nonceAllocated?: boolean;
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
 * Helper: Start a fail-closed heartbeat for long-running sweep operations.
 * A lost/failed renewal is sticky: the worker must not broadcast after it.
 */
type StopSweeperHeartbeat = (() => void) & {
  assertLease: () => Promise<void>;
};

function startSweeperHeartbeat(sweepId: string, workerId: string): StopSweeperHeartbeat {
  let leaseFailure: string | null = null;
  let heartbeatInFlight = false;

  const renewLease = async (): Promise<void> => {
    if (heartbeatInFlight || leaseFailure) return;
    heartbeatInFlight = true;
    try {
      const { data, error } = await supabaseAdmin.rpc('extend_sweep_lease', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_extend_seconds: 300,
      });
      if (error || !data || data.success !== true) {
        leaseFailure = error?.message || data?.code || 'SWEEP_LEASE_RENEWAL_REJECTED';
        console.error(`[Sweeper Lease Lost] Sweep ${sweepId}, worker ${workerId}: ${leaseFailure}`);
      }
    } catch (err: any) {
      leaseFailure = err?.message || 'SWEEP_LEASE_RENEWAL_FAILED';
      console.error(`[Sweeper Lease Lost] Sweep ${sweepId}, worker ${workerId}: ${leaseFailure}`);
    } finally {
      heartbeatInFlight = false;
    }
  };

  const interval = setInterval(() => {
    void renewLease();
  }, 30000);

  const stop = (() => clearInterval(interval)) as StopSweeperHeartbeat;
  stop.assertLease = async (): Promise<void> => {
    if (leaseFailure) {
      throw new Error(`Sweep worker lease was lost; refusing to broadcast: ${leaseFailure}`);
    }

    const { data, error } = await supabaseAdmin.rpc('verify_sweep_ownership', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_expected_status: null,
    });
    if (error || !data || data.valid !== true) {
      leaseFailure = error?.message || data?.reason || 'SWEEP_OWNERSHIP_VERIFICATION_FAILED';
      throw new Error(`Sweep worker lease verification failed; refusing to broadcast: ${leaseFailure}`);
    }
  };

  return stop;
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
  expectedStatus: string | null
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

/** All gas-funding status changes must pass through the lease-bound SQL state machine. */
async function updateGasFundingStatus(
  sweepId: string,
  workerId: string,
  newStatus: 'BROADCASTED' | 'CONFIRMED' | 'RECOVERY_REQUIRED' | 'FAILED',
  errorMessage?: string | null,
  txHash?: string | null
): Promise<void> {
  if (!sweepId || !workerId) {
    throw new Error('Gas funding state transition requires a claimed sweep ID and worker lease.');
  }
  const { data, error } = await supabaseAdmin.rpc('update_gas_funding_operation_status', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_new_status: newStatus,
    p_error_message: errorMessage ?? null,
    p_tx_hash: txHash ?? null,
  });
  if (error || !data || data.success !== true) {
    throw new Error(`Gas funding state transition to ${newStatus} failed: ${error?.message || data?.message || 'RPC did not confirm success'}`);
  }
}

/** Persist an observation-only incident when a signed EVM gas-funding nonce goes missing. */
async function recordEvmGasFundingNonceIncident(params: {
  sweepId: string;
  network: string;
  walletAddress: string;
  expectedNonce: number;
  expectedTxHash: string;
  observedLatestNonce: number;
  observedPendingNonce: number;
  reason: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('record_evm_gas_funding_nonce_incident', {
    p_sweep_id: params.sweepId,
    p_network: params.network,
    p_wallet_address: params.walletAddress,
    p_expected_nonce: params.expectedNonce,
    p_expected_tx_hash: params.expectedTxHash,
    p_observed_latest_nonce: params.observedLatestNonce,
    p_observed_pending_nonce: params.observedPendingNonce,
    p_reason: params.reason.slice(0, 1000),
  });

  if (error || !data || data.success !== true) {
    throw new Error(
      `EVM gas-funding nonce incident could not be persisted: ${error?.message || data?.message || 'RPC did not confirm success'}`
    );
  }
}

/** Persist the actual EVM network fee and outcome from a mined gas-funding receipt. */
async function recordEvmGasFundingReceipt(
  sweepId: string,
  workerId: string,
  expectedTxHash: string,
  receipt: ethers.TransactionReceipt
): Promise<void> {
  const txHash = String(receipt.hash || '').toLowerCase();
  const blockHash = String(receipt.blockHash || '').toLowerCase();
  const blockNumber = Number(receipt.blockNumber);
  const gasUsed = receipt.gasUsed;
  const effectiveGasPrice = receipt.gasPrice;

  if (
    txHash !== expectedTxHash.toLowerCase() ||
    (receipt.status !== 0 && receipt.status !== 1) ||
    typeof gasUsed !== 'bigint' ||
    gasUsed <= 0n ||
    typeof effectiveGasPrice !== 'bigint' ||
    effectiveGasPrice <= 0n ||
    !Number.isSafeInteger(blockNumber) ||
    blockNumber < 0 ||
    !/^0x[a-f0-9]{64}$/.test(blockHash)
  ) {
    throw new Error('Mined EVM gas-funding receipt is incomplete or does not match the persisted transaction.');
  }

  const { data, error } = await supabaseAdmin.rpc('record_evm_gas_funding_receipt', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_tx_hash: txHash,
    p_receipt_status: receipt.status,
    p_gas_used: gasUsed.toString(),
    p_effective_gas_price: effectiveGasPrice.toString(),
    p_block_number: blockNumber,
    p_block_hash: blockHash,
  });

  if (error || !data || data.success !== true) {
    throw new Error(
      `Failed to persist actual EVM gas-funding receipt: ${error?.message || data?.message || 'RPC did not confirm success'}`
    );
  }
}

/**
 * Top-up native gas for EVM deposit address with durable signing, hot-wallet solvency verification,
 * and abuse protection BEFORE network broadcast.
 */
export async function fundGasForAddress(
  targetAddress: string,
  amountWei: bigint,
  provider: ethers.Provider,
  sweepId?: string,
  workerId?: string,
  networkCode: string = 'ERC20',
  childSweepFeeWei?: bigint
) {
  if (!sweepId || !workerId) {
    throw new Error('EVM gas funding requires a database-claimed sweep ID and active worker lease.');
  }
  await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
  if (!MASTER_SEED_OR_PRIV_KEY) {
    throw new Error('MASTER_SEED_OR_PRIV_KEY is not configured in environment');
  }
  const formattedKey = MASTER_SEED_OR_PRIV_KEY.startsWith('0x')
    ? MASTER_SEED_OR_PRIV_KEY
    : `0x${MASTER_SEED_OR_PRIV_KEY}`;
  const masterWallet = new ethers.Wallet(formattedKey, provider);
  const hotWalletAddress = masterWallet.address;

  // Resolve EVM chain ID and network (Fail-Closed: Production mainnet only)
  const normNet = (networkCode || '').toUpperCase().trim();
  let chainId: number;
  if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') {
    chainId = 56; // BSC Mainnet
  } else if (normNet === 'ERC20' || normNet === 'ETH' || normNet === 'ETHEREUM') {
    chainId = 1; // Ethereum Mainnet (ERC20)
  } else {
    throw new Error(`Unsupported EVM network for gas funding: "${networkCode}". Production supports ERC20 (Chain ID 1) and BEP20 (Chain ID 56) only.`);
  }
  const providerNetwork = await provider.getNetwork();
  if (providerNetwork.chainId !== BigInt(chainId)) {
    throw new Error(
      `Gas-funding RPC chain mismatch: expected ${chainId}, received ${providerNetwork.chainId}`
    );
  }
  if (!ethers.isAddress(targetAddress)) {
    throw new Error('Gas-funding destination is not a valid EVM address.');
  }

  const nativeSymbol = chainId === 56 ? 'BNB' : 'ETH';

  // Never create a new funding operation when the child already has enough gas.
  // However, a durable prior signature must still be reconciled even if the
  // balance is now sufficient; otherwise a broadcasted top-up can be orphaned.
  const currentChildBalance = await provider.getBalance(targetAddress);
  const { data: priorGasFunding, error: priorGasFundingError } = await supabaseAdmin
    .from('gas_funding_operations')
    .select('status, tx_hash, signed_tx_hex, amount_allocated, nonce, funding_wallet_address')
    .eq('sweep_id', sweepId)
    .maybeSingle();

  if (priorGasFundingError) {
    throw new Error(`Unable to inspect prior gas-funding state: ${priorGasFundingError.message}`);
  }

  const priorGasStatus = String(priorGasFunding?.status || '').toUpperCase();
  const hasDurableFundingToReconcile = [
    'READY_TO_BROADCAST',
    'BROADCASTED',
    'RECOVERY_REQUIRED',
  ].includes(priorGasStatus);
  const hasAllocatedNonceWithoutSignedPayload =
    priorGasStatus === 'PENDING' &&
    priorGasFunding?.nonce !== null &&
    priorGasFunding?.nonce !== undefined;

  if (
    hasDurableFundingToReconcile &&
    (!priorGasFunding?.tx_hash || !priorGasFunding?.signed_tx_hex)
  ) {
    throw new Error('Prior gas-funding operation has an incomplete durable transaction; manual reconciliation is required.');
  }

  if (
    childSweepFeeWei &&
    currentChildBalance >= childSweepFeeWei &&
    !hasDurableFundingToReconcile &&
    !hasAllocatedNonceWithoutSignedPayload
  ) {
    console.log(`[Sweeper Gas] Child ${targetAddress} already has sufficient ${nativeSymbol} balance (${ethers.formatEther(currentChildBalance)} >= ${ethers.formatEther(childSweepFeeWei)}). No new funding is required.`);
    return;
  }

  // Check if gas funding operation is claimed or already in progress
  if (sweepId && workerId) {
    const { data: claimRes, error: claimErr } = await supabaseAdmin.rpc('claim_gas_funding_operation', {
      p_sweep_id: sweepId,
      p_deposit_address: targetAddress,
      p_network: normNet,
      p_amount_allocated: ethers.formatEther(amountWei),
      p_worker_id: workerId,
    });

    if (claimErr || !claimRes) {
      throw new Error(`Gas funding claim RPC failed: ${claimErr?.message || 'UNKNOWN'}`);
    }

    if (claimRes.already_funded) {
      console.log(`[Sweeper Gas] Address ${targetAddress} gas funding already confirmed (tx: ${claimRes.tx_hash}). Skipping.`);
      return;
    }

    // RECOVERY PATH: If signed raw tx already exists, DO NOT sign a second tx or allocate a new nonce!
    const existingSignedTx = claimRes.signed_tx_hex;
    const existingTxHash = claimRes.tx_hash;
    const existingStatus = claimRes.status;

    if (existingSignedTx && existingTxHash && (existingStatus === 'READY_TO_BROADCAST' || existingStatus === 'BROADCASTED' || existingStatus === 'RECOVERY_REQUIRED')) {
      console.log(`[Sweeper Gas Recovery] Found persisted signed funding tx for sweep ${sweepId}, txHash: ${existingTxHash}, status: ${existingStatus}. Reconciling...`);

      // Verify the immutable signed payload before querying or rebroadcasting it.
      let parsedFundingTx: ethers.Transaction;
      try {
        parsedFundingTx = ethers.Transaction.from(existingSignedTx);
      } catch {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Persisted EVM gas-funding signed transaction cannot be decoded', existingTxHash);
        throw new Error('Persisted EVM gas-funding transaction is malformed; manual reconciliation is required.');
      }
      const claimedNonce = Number(claimRes.nonce);
      const expectedFundingValue = ethers.parseEther(String(claimRes.amount_allocated));
      const parsedSignedHash = ethers.keccak256(existingSignedTx);
      if (
        claimRes.nonce === null ||
        claimRes.nonce === undefined ||
        !Number.isSafeInteger(claimedNonce) ||
        claimedNonce < 0 ||
        !Number.isFinite(Number(claimRes.amount_allocated)) ||
        Number(claimRes.amount_allocated) <= 0 ||
        parsedSignedHash.toLowerCase() !== existingTxHash.toLowerCase() ||
        parsedFundingTx.from?.toLowerCase() !== hotWalletAddress.toLowerCase() ||
        parsedFundingTx.to?.toLowerCase() !== targetAddress.toLowerCase() ||
        parsedFundingTx.value !== expectedFundingValue ||
        parsedFundingTx.chainId !== BigInt(chainId) ||
        parsedFundingTx.nonce !== claimedNonce
      ) {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Persisted EVM gas-funding payload failed hash, wallet, destination, amount, chain, or nonce integrity checks', existingTxHash);
        throw new Error('Persisted EVM gas-funding transaction failed integrity validation; manual reconciliation is required.');
      }

      // 1. Check if transaction is already mined on-chain
      let receipt = null;
      try {
        receipt = await provider.getTransactionReceipt(existingTxHash);
      } catch (qErr) {
        console.warn(`[Sweeper Gas Recovery] Failed to query receipt for ${existingTxHash}:`, qErr);
      }

      if (receipt && receipt.status === 1) {
        console.log(`[Sweeper Gas Recovery] Funding tx ${existingTxHash} is already confirmed on-chain!`);
        await recordEvmGasFundingReceipt(sweepId, workerId, existingTxHash, receipt);
        return;
      }

      if (receipt && receipt.status === 0) {
        const recoveryMessage =
          'Persisted EVM gas-funding transaction was mined but reverted; actual network fee has been recorded and manual reconciliation is required';
        await recordEvmGasFundingReceipt(sweepId, workerId, existingTxHash, receipt);
        throw new Error(`${recoveryMessage}: ${existingTxHash}`);
      }

      // 2. If not mined, rebroadcast the EXACT SAME signed raw transaction
      console.log(`[Sweeper Gas Recovery] Rebroadcasting exact persisted signed tx ${existingTxHash}...`);
      try {
        await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
        const rebroadcastResponse = await provider.broadcastTransaction(existingSignedTx);
        if (rebroadcastResponse.hash.toLowerCase() !== existingTxHash.toLowerCase()) {
          throw new Error('EVM gas-funding node returned a hash that differs from the persisted signed transaction.');
        }
        await updateGasFundingStatus(sweepId, workerId, 'BROADCASTED', null, existingTxHash);
      } catch (rebroadcastErr: any) {
        const errMsg = rebroadcastErr?.message || '';
        if (errMsg.includes('already known') || errMsg.includes('nonce too low') || errMsg.includes('ALREADY_EXISTS')) {
          console.log(`[Sweeper Gas Recovery] Tx already in mempool/blockchain: ${errMsg}`);
        } else {
          console.error(`[Sweeper Gas Recovery] Rebroadcast exception:`, rebroadcastErr);
          await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', errMsg, existingTxHash);
          throw rebroadcastErr;
        }
      }

      // 3. Wait for confirmation
      let isConfirmed = false;
      for (let attempt = 1; attempt <= 20; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          receipt = await provider.getTransactionReceipt(existingTxHash);
          if (receipt && receipt.status === 1) {
            isConfirmed = true;
            break;
          } else if (receipt && receipt.status === 0) {
            await recordEvmGasFundingReceipt(sweepId, workerId, existingTxHash, receipt);
            throw new Error(`Gas funding transaction reverted on-chain: ${existingTxHash}`);
          }
        } catch (receiptErr: any) {
          if (receiptErr.message?.includes('reverted')) throw receiptErr;
        }
      }

      if (isConfirmed && receipt && receipt.status === 1) {
        await recordEvmGasFundingReceipt(sweepId, workerId, existingTxHash, receipt);
        console.log(`[Sweeper Gas Recovery] Gas funding tx ${existingTxHash} confirmed with actual network fee recorded.`);
        return;
      } else {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Timed out waiting for on-chain gas funding receipt', existingTxHash);
        throw new Error(`Timed out waiting for gas funding tx ${existingTxHash} confirmation`);
      }
    }
  }

  // =========================================================================
  // FRESH FUNDING PIPELINE (Pre-broadcast persistence & solvency check)
  // =========================================================================

  // Quantity A: fundingAmount delivered to child
  const fundingAmount = amountWei;

  // Quantity B: fundingTxFee paid by hot wallet for the funding transaction
  const feeData = await provider.getFeeData();
  const fundingTxGasLimit = 21000n;
  const hasEip1559Quote =
    feeData.maxFeePerGas !== null &&
    feeData.maxFeePerGas > 0n &&
    feeData.maxPriorityFeePerGas !== null &&
    feeData.maxPriorityFeePerGas > 0n;

  let priorityGasPrice: bigint;
  let maxFeePerGas: bigint | undefined;
  let maxPriorityFeePerGas: bigint | undefined;
  let fundingTxFee: bigint;

  if (hasEip1559Quote) {
    maxFeePerGas = feeData.maxFeePerGas! * 2n;
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas! * 2n;
    if (maxFeePerGas < maxPriorityFeePerGas) {
      throw new Error('EIP-1559 fee quote is inconsistent: max fee is below priority fee.');
    }
    priorityGasPrice = maxPriorityFeePerGas;
    // Reserve the maximum fee cap for solvency; the actual receipt fee is lower or equal.
    fundingTxFee = maxFeePerGas * fundingTxGasLimit;
  } else {
    if (feeData.gasPrice === null || feeData.gasPrice <= 0n) {
      throw new Error(`Live ${nativeSymbol} gas-price quote is unavailable; refusing a hard-coded fee fallback.`);
    }
    priorityGasPrice = feeData.gasPrice * 2n;
    fundingTxFee = priorityGasPrice * fundingTxGasLimit;
  }

  // Quantity C: childSweepFee (provided or estimated)
  const childSweepFee = childSweepFeeWei || (
    (maxFeePerGas || priorityGasPrice) * 65000n
  );

  // Hot wallet total cost for this funding operation
  const hotWalletTotalCost = fundingAmount + fundingTxFee;

  // Step 3: Abuse Protection Check (per-address cooldown & daily ceiling)
  const cooldownSecs = parseInt(process.env.GAS_FUNDING_COOLDOWN_SECONDS || '300', 10);
  const dailyLimitNative = parseFloat(
    normNet === 'BEP20' || normNet === 'BSC'
      ? process.env.GAS_FUNDING_DAILY_LIMIT_BNB || '0.1'
      : process.env.GAS_FUNDING_DAILY_LIMIT_ETH || '0.05'
  );
  const dailyMaxOps = parseInt(process.env.GAS_FUNDING_DAILY_MAX_OPS || '5', 10);

  const { data: eligibilityRes, error: eligErr } = await supabaseAdmin.rpc('check_gas_funding_eligibility', {
    p_deposit_address: targetAddress,
    p_network: normNet,
    p_amount_allocated: Number(ethers.formatEther(fundingAmount)),
    p_cooldown_seconds: cooldownSecs,
    p_daily_limit: dailyLimitNative,
    p_daily_max_operations: dailyMaxOps,
  });

  if (eligErr || !eligibilityRes || eligibilityRes.eligible !== true) {
    const rejectReason = eligibilityRes?.reason || (eligErr ? 'GAS_FUNDING_POLICY_CHECK_UNAVAILABLE' : 'GAS_FUNDING_POLICY_REJECTED');
    const rejectMsg = eligibilityRes?.message || eligErr?.message || 'Gas funding eligibility could not be confirmed.';
    const targetStatus = eligErr || !eligibilityRes ? 'RECOVERY_REQUIRED' : 'FAILED';
    await updateGasFundingStatus(sweepId, workerId, targetStatus, `${rejectReason}: ${rejectMsg}`);
    throw new Error(`Gas funding rejected: ${rejectReason} - ${rejectMsg}`);
  }

  // Step 4: Verify Hot Wallet Solvency BEFORE Nonce Allocation and Broadcast
  const minReserveStr = normNet === 'BEP20' || normNet === 'BSC'
    ? process.env.HOT_WALLET_BNB_MIN_RESERVE || '0.02'
    : process.env.HOT_WALLET_ETH_MIN_RESERVE || '0.01';
  const configuredReserve = ethers.parseEther(minReserveStr);
  const requiredHotWalletBalance = hotWalletTotalCost + configuredReserve;

  const hotWalletBalance = await provider.getBalance(hotWalletAddress);
  console.log(`[Sweeper Gas Solvency] Hot Wallet: ${hotWalletAddress}, Balance: ${ethers.formatEther(hotWalletBalance)} ${nativeSymbol}, Required: ${ethers.formatEther(requiredHotWalletBalance)} ${nativeSymbol} (Funding: ${ethers.formatEther(fundingAmount)} + Fee: ${ethers.formatEther(fundingTxFee)} + Reserve: ${ethers.formatEther(configuredReserve)})`);

  if (hotWalletBalance < requiredHotWalletBalance) {
    const insolvMsg = `Hot wallet ${hotWalletAddress} has insufficient ${nativeSymbol} balance (${ethers.formatEther(hotWalletBalance)}). Required: ${ethers.formatEther(requiredHotWalletBalance)} (fundingAmount: ${ethers.formatEther(fundingAmount)} + fundingFee: ${ethers.formatEther(fundingTxFee)} + reserve: ${ethers.formatEther(configuredReserve)}).`;
    console.error(`[Hot Wallet Insolvency] ${insolvMsg}`);
    await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', insolvMsg);
    throw new Error(`HOT_WALLET_INSOLVENT: ${insolvMsg}`);
  }

  // Step 5: Obtain/allocate hot-wallet nonce safely
  const onchainPending = await provider.getTransactionCount(hotWalletAddress, 'pending');
  if (!Number.isSafeInteger(onchainPending) || onchainPending < 0) {
    throw new Error(`Provider returned an invalid pending nonce for hot wallet ${hotWalletAddress}.`);
  }
  const { data: allocatedNonce, error: nonceErr } = await supabaseAdmin.rpc('allocate_gas_funding_nonce', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_network: normNet,
    p_wallet_address: hotWalletAddress,
    p_onchain_pending_nonce: onchainPending,
  });

  if (nonceErr || allocatedNonce === null || allocatedNonce === undefined) {
    throw new Error(`Failed to allocate operation-bound hot-wallet nonce: ${nonceErr?.message || 'UNKNOWN_NONCE_ERROR'}`);
  }
  const nonceNumber = Number(allocatedNonce);
  if (!Number.isSafeInteger(nonceNumber) || nonceNumber < 0) {
    throw new Error(`Hot-wallet nonce allocator returned an invalid nonce: ${String(allocatedNonce)}`);
  }

  // Step 6: Pre-broadcast ownership check
  if (sweepId && workerId) {
    await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
  }

  // Step 7: Build unsigned native transfer
  const txReq: ethers.TransactionRequest = {
    to: targetAddress,
    value: fundingAmount,
    nonce: nonceNumber,
    chainId,
    gasLimit: fundingTxGasLimit,
    gasPrice: maxFeePerGas ? undefined : priorityGasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    type: maxFeePerGas ? 2 : 0,
  };

  // Step 8: Sign transaction and compute deterministic hash
  const populatedTx = await masterWallet.populateTransaction(txReq);
  const signedTxHex = await masterWallet.signTransaction(populatedTx);
  const deterministicTxHash = ethers.keccak256(signedTxHex);

  if (!deterministicTxHash || !deterministicTxHash.startsWith('0x') || deterministicTxHash.length !== 66) {
    throw new Error(`Deterministic hash calculation failed: invalid hash format ${deterministicTxHash}`);
  }

  // Step 9: Persist signed raw transaction + deterministic hash + nonce in gas_funding_operations BEFORE broadcast
  if (sweepId && workerId) {
    const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_gas_funding', {
      p_sweep_id: sweepId,
      p_worker_id: workerId,
      p_signed_tx_hex: signedTxHex,
      p_tx_hash: deterministicTxHash,
      p_nonce: BigInt(nonceNumber),
      p_funding_tx_fee: Number(ethers.formatEther(fundingTxFee)),
      p_child_sweep_fee: Number(ethers.formatEther(childSweepFee)),
    });

    if (persistErr || !persistRes || persistRes.success !== true) {
      throw new Error(`Failed to persist signed gas funding transaction: ${persistErr?.message || persistRes?.message || 'UNKNOWN'}`);
    }
  }

  // Step 10: Broadcast the EXACT persisted signed transaction
  console.log(`[Sweeper Gas Broadcast] Broadcasting ${ethers.formatEther(fundingAmount)} ${nativeSymbol} to ${targetAddress}. TxHash: ${deterministicTxHash}, Nonce: ${allocatedNonce}`);
  try {
    await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
    const broadcastResponse = await provider.broadcastTransaction(signedTxHex);
    if (broadcastResponse.hash.toLowerCase() !== deterministicTxHash.toLowerCase()) {
      throw new Error('EVM gas-funding node returned a hash that differs from the locally signed transaction.');
    }
    await updateGasFundingStatus(sweepId, workerId, 'BROADCASTED', null, deterministicTxHash);
  } catch (broadcastErr: any) {
    console.error(`[EVM Gas Funding Broadcast Exception] ${targetAddress}:`, broadcastErr);
    // Check if tx is already in mempool/blockchain
    let minedReceipt = null;
    try {
      minedReceipt = await provider.getTransactionReceipt(deterministicTxHash);
    } catch {}

    if (minedReceipt) {
      const receiptFinality = await getEvmSweepReceiptFinality(
        provider as ethers.JsonRpcProvider,
        deterministicTxHash,
        normNet
      );
      if (receiptFinality === 'CONFIRMED' || receiptFinality === 'REVERTED') {
        await recordEvmGasFundingReceipt(sweepId, workerId, deterministicTxHash, minedReceipt);
        if (receiptFinality === 'CONFIRMED') {
          console.log(`[Sweeper Gas] Transaction ${deterministicTxHash} reached required finality despite broadcast error.`);
          return;
        }
        throw new Error(`EVM gas-funding transaction reverted after required confirmations: ${deterministicTxHash}`);
      }
    }

    await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', broadcastErr?.message || 'EVM gas broadcast ambiguous or receipt not final', deterministicTxHash);
    throw broadcastErr;
  }

  // Step 11 & 12: Wait & verify actual on-chain receipt
  let isConfirmed = false;
  let isReverted = false;
  let finalReceipt: ethers.TransactionReceipt | null = null;
  for (let attempt = 1; attempt <= 20; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const receipt = await provider.getTransactionReceipt(deterministicTxHash);
      if (receipt) {
        finalReceipt = receipt;
        const finality = await getEvmSweepReceiptFinality(provider as ethers.JsonRpcProvider, deterministicTxHash, normNet);
        if (finality === 'CONFIRMED') {
          isConfirmed = true;
          break;
        }
        if (finality === 'REVERTED') {
          isReverted = true;
          break;
        }
      }
    } catch {
      // Continue polling; a missing receipt is not proof of failure or success.
    }
  }

  if (isReverted) {
    const recoveryMessage =
      'EVM gas-funding transaction was mined but reverted; actual network fee has been recorded and manual reconciliation is required';
    if (!finalReceipt || finalReceipt.status !== 0) {
      throw new Error('A reverted EVM gas-funding transaction was detected without its complete receipt; recovery remains required.');
    }
    await recordEvmGasFundingReceipt(sweepId, workerId, deterministicTxHash, finalReceipt);
    throw new Error(`${recoveryMessage}: ${deterministicTxHash}`);
  }

  if (!isConfirmed) {
    await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Timed out waiting for on-chain gas funding receipt', deterministicTxHash);
    throw new Error(`Timed out waiting for gas funding confirmation on ${deterministicTxHash}`);
  }

  // Record the receipt and actual fee atomically with the CONFIRMED state.
  if (!finalReceipt || finalReceipt.status !== 1) {
    throw new Error('EVM gas-funding confirmation is missing its successful transaction receipt.');
  }
  await recordEvmGasFundingReceipt(sweepId, workerId, deterministicTxHash, finalReceipt);
  console.log(`[Sweeper Gas] Gas funding tx ${deterministicTxHash} CONFIRMED; actual fee ${ethers.formatEther(finalReceipt.gasUsed * finalReceipt.gasPrice)} ${nativeSymbol} recorded.`);
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
  if (!sweepId || !workerId) {
    throw new Error('TRON gas funding requires a database-claimed sweep ID and active worker lease.');
  }
  await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');

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

    // Recovery must rebroadcast exactly the persisted signed transaction; never re-sign it.
    const persistedSignedJson = String(claimRes.signed_tx_hex || '');
    const persistedHash = String(claimRes.tx_hash || '').toLowerCase();
    const persistedStatus = String(claimRes.status || '').toUpperCase();
    if (persistedSignedJson || persistedHash) {
      if (
        !persistedSignedJson ||
        !/^[a-f0-9]{64}$/.test(persistedHash) ||
        !['READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'].includes(persistedStatus)
      ) {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Persisted TRON gas transaction material is incomplete or has an invalid state', persistedHash || null);
        throw new Error('Persisted TRON gas transaction material is incomplete; manual reconciliation is required.');
      }

      let persistedSignedTx: any;
      try {
        persistedSignedTx = JSON.parse(persistedSignedJson);
      } catch {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Persisted TRON signed transaction JSON is invalid', persistedHash);
        throw new Error('Persisted TRON signed transaction JSON is invalid; manual reconciliation is required.');
      }

      if (
        String(persistedSignedTx?.txID || '').toLowerCase() !== persistedHash ||
        !Array.isArray(persistedSignedTx?.signature) ||
        persistedSignedTx.signature.length === 0
      ) {
        await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Persisted TRON transaction hash/signature mismatch', persistedHash);
        throw new Error('Persisted TRON signed transaction failed integrity validation.');
      }

      const recoveryTronWeb = getTronWebInstance(process.env.TRON_RPC_URL || 'https://api.trongrid.io');
      const isConfirmed = async (): Promise<boolean> => {
        try {
          const txInfo = await recoveryTronWeb.trx.getTransaction(persistedHash);
          return Boolean(txInfo?.ret?.some((item: any) => item?.contractRet === 'SUCCESS'));
        } catch {
          return false;
        }
      };

      if (await isConfirmed()) {
        await updateGasFundingStatus(sweepId, workerId, 'CONFIRMED', null, persistedHash);
        return;
      }

      try {
        await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
        const rebroadcast = await recoveryTronWeb.trx.sendRawTransaction(persistedSignedTx);
        if (!rebroadcast?.result) {
          throw new Error('TRON node did not acknowledge exact persisted gas-funding transaction');
        }
        await updateGasFundingStatus(sweepId, workerId, 'BROADCASTED', null, persistedHash);
      } catch (broadcastError: any) {
        if (await isConfirmed()) {
          await updateGasFundingStatus(sweepId, workerId, 'CONFIRMED', null, persistedHash);
          return;
        }
        await updateGasFundingStatus(
          sweepId,
          workerId,
          'RECOVERY_REQUIRED',
          broadcastError?.message || 'TRON gas-funding rebroadcast outcome is ambiguous',
          persistedHash
        );
        throw broadcastError;
      }

      for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (await isConfirmed()) {
          await updateGasFundingStatus(sweepId, workerId, 'CONFIRMED', null, persistedHash);
          return;
        }
      }

      await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', 'Timed out confirming persisted TRON gas-funding transaction', persistedHash);
      throw new Error(`Timed out confirming persisted TRON gas-funding transaction ${persistedHash}`);
    }
  }

  const tronPrivKey = resolveTronHotWalletPrivateKey();
  if (!tronPrivKey) {
    await updateGasFundingStatus(sweepId, workerId, 'FAILED', 'HOT_WALLET_TRON_PRIVATE_KEY is not configured');
    throw new Error('HOT_WALLET_TRON_PRIVATE_KEY is not configured; TRON gas funding is blocked.');
  }

  const tronWeb = getTronWebInstance(
    process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    tronPrivKey
  );
  const hotWalletAddress = tronWeb.defaultAddress.base58;

  // Solvency check for TRON hot wallet
  const tronMinReserveSun = BigInt(process.env.HOT_WALLET_TRX_MIN_RESERVE || '50000000'); // 50 TRX default
  const hotBalanceSun = await tronWeb.trx.getBalance(hotWalletAddress);
  if (BigInt(hotBalanceSun) < BigInt(amountSun) + tronMinReserveSun) {
    const insolvMsg = `TRON hot wallet ${hotWalletAddress} has insufficient TRX (${hotBalanceSun / 1_000_000} TRX). Required: ${(Number(amountSun) + Number(tronMinReserveSun)) / 1_000_000} TRX.`;
    console.error(`[Tron Hot Wallet Insolvency] ${insolvMsg}`);
    await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', insolvMsg);
    throw new Error(`HOT_WALLET_INSOLVENT: ${insolvMsg}`);
  }

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
    await assertPreBroadcastOwnership(sweepId, workerId, 'GAS_FUNDING');
    const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcastRes || !broadcastRes.result) {
      throw new Error(`TRON gas funding broadcast rejected: ${JSON.stringify(broadcastRes)}`);
    }

    await updateGasFundingStatus(sweepId, workerId, 'BROADCASTED', null, deterministicTxHash);
  } catch (sendErr: any) {
    console.error(`[Tron Gas Funding Broadcast Exception] ${targetAddress}:`, sendErr);
    await updateGasFundingStatus(sweepId, workerId, 'RECOVERY_REQUIRED', sendErr?.message || 'TRON gas funding broadcast outcome is ambiguous', deterministicTxHash);
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
      await updateGasFundingStatus(sweepId, workerId, 'CONFIRMED', null, deterministicTxHash);
      console.log(`[Tron Gas] Gas funding tx ${deterministicTxHash} confirmed on-chain.`);
    } else {
      const recoveryMessage =
        'TRON gas-funding transaction was broadcast but did not reach successful confirmation within the polling window; reconcile the exact transaction before retrying';
      await updateGasFundingStatus(
        sweepId,
        workerId,
        'RECOVERY_REQUIRED',
        recoveryMessage,
        deterministicTxHash
      );
      throw new Error(`${recoveryMessage}: ${deterministicTxHash}`);
    }
  }
}

type TronTransactionOutcome = 'CONFIRMED' | 'REVERTED' | 'UNKNOWN';

/** Polls the exact deterministic TRON transaction; unknown is never treated as success. */
async function waitForTronTransactionOutcome(
  tronWeb: any,
  txHash: string,
  attempts: number = 12,
  intervalMs: number = 3000
): Promise<TronTransactionOutcome> {
  if (!/^[a-f0-9]{64}$/i.test(txHash)) {
    throw new Error('Invalid deterministic TRON transaction hash');
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const txInfo = await tronWeb.trx.getTransaction(txHash);
      const contractRet = txInfo?.ret?.[0]?.contractRet;
      if (contractRet === 'SUCCESS') return 'CONFIRMED';
      if (contractRet && contractRet !== 'SUCCESS') return 'REVERTED';
    } catch {
      // A query error is not proof of either execution or failure; keep checking.
    }
  }

  return 'UNKNOWN';
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

  const totalEnergyLimit = Number(resources?.TotalEnergyLimit);
  const totalEnergyWeight = Number(resources?.TotalEnergyWeight);
  if (
    !Number.isFinite(totalEnergyLimit) ||
    !Number.isFinite(totalEnergyWeight) ||
    totalEnergyLimit <= 0 ||
    totalEnergyWeight <= 0 ||
    !Number.isFinite(energyNeeded) ||
    energyNeeded <= 0
  ) {
    throw new Error('TRON Energy delegation requires valid live TotalEnergyLimit, TotalEnergyWeight and estimated energy values; refusing hard-coded fallbacks.');
  }

  const isWeightInSun = totalEnergyWeight > 1000000000000;
  const totalEnergyWeightSun = isWeightInSun ? totalEnergyWeight : totalEnergyWeight * 1000000;

  // Calculate needed TRX (in SUN) and reject unsafe floating-point conversion.
  const calculatedTrxNeededSun = Math.ceil((energyNeeded * totalEnergyWeightSun) / totalEnergyLimit);
  if (!Number.isSafeInteger(calculatedTrxNeededSun) || calculatedTrxNeededSun <= 0) {
    throw new Error('Calculated TRON Energy delegation amount is not a safe positive SUN integer.');
  }
  const trxNeededSun = BigInt(calculatedTrxNeededSun);

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

  // Reuse an existing delegation only after validating/confirming its exact persisted transaction.
  if (initRes.already_delegated) {
    if (initRes.status === 'DELEGATED') {
      console.log(`[Tron Resource Pool] Sweep ${sweepId} already has active delegation. Reusing existing.`);
      return { success: true, delegatedAmountSun: BigInt(initRes.delegated_amount_sun) };
    }

    if (initRes.status === 'UNDELEGATING') {
      throw new Error('TRON Energy for this sweep is currently being reclaimed; a new delegation is not permitted.');
    }

    if (initRes.status === 'DELEGATING') {
      if (!initRes.signed_delegation_hex || !initRes.delegation_tx_hash) {
        throw new Error('Existing TRON delegation is DELEGATING but its durable signed transaction is incomplete.');
      }

      let rawTx: any;
      try {
        rawTx = JSON.parse(initRes.signed_delegation_hex);
      } catch {
        throw new Error('Persisted TRON delegation payload is invalid JSON; manual reconciliation is required.');
      }

      if (
        String(rawTx?.txID || '').toLowerCase() !== String(initRes.delegation_tx_hash).toLowerCase() ||
        !Array.isArray(rawTx?.signature) ||
        rawTx.signature.length === 0 ||
        !rawTx?.raw_data_hex
      ) {
        throw new Error('Persisted TRON delegation hash/signature/raw-data mismatch; refusing replacement.');
      }

      await assertPreBroadcastOwnership(sweepId, workerId, null);

      const priorOutcome = await waitForTronTransactionOutcome(
        tronWeb,
        String(initRes.delegation_tx_hash)
      );

      if (priorOutcome === 'UNKNOWN') {
        try {
          await tronWeb.trx.sendRawTransaction(rawTx);
        } catch (rebroadcastErr: any) {
          console.warn('[Tron Resource Pool] Exact persisted delegation rebroadcast returned an ambiguous response:', rebroadcastErr);
        }
      } else if (priorOutcome === 'REVERTED') {
        throw new Error(`Persisted TRON delegation transaction reverted on-chain: ${initRes.delegation_tx_hash}. Manual reconciliation is required before a replacement delegation.`);
      }

      const confirmedOutcome = priorOutcome === 'CONFIRMED'
        ? 'CONFIRMED'
        : await waitForTronTransactionOutcome(tronWeb, String(initRes.delegation_tx_hash));

      if (confirmedOutcome !== 'CONFIRMED') {
        throw new Error(`Persisted TRON delegation transaction ${initRes.delegation_tx_hash} is not confirmed; keeping DELEGATING state for recovery.`);
      }

      const { data: recoveredStatus, error: recoveredStatusError } = await supabaseAdmin.rpc('update_delegation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'DELEGATING',
        p_new_status: 'DELEGATED',
      });
      if (recoveredStatusError || !recoveredStatus || recoveredStatus.success !== true) {
        throw new Error(`Failed to record confirmed TRON delegation: ${recoveredStatusError?.message || recoveredStatus?.message || 'RPC did not confirm success'}`);
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

  // 6. Broadcast only after revalidating the live sweep lease.
  try {
    await assertPreBroadcastOwnership(sweepId, workerId, null);
    const broadcastRes = await tronWeb.trx.sendRawTransaction(signedTx);
    if (!broadcastRes || !broadcastRes.result) {
      throw new Error(`TRON delegation raw broadcast returned an ambiguous response: ${JSON.stringify(broadcastRes)}`);
    }
  } catch (broadcastErr: any) {
    // The signed transaction is already durable. Do not mark it FAILED or
    // clear its bytes: the node may have accepted it despite the response.
    console.error(`[Tron Resource Pool] Delegation broadcast is ambiguous; retaining DELEGATING transaction ${deterministicTxHash}:`, broadcastErr);
    throw broadcastErr;
  }

  // 7. Mark DELEGATED only after the exact transaction is confirmed on-chain.
  const delegationOutcome = await waitForTronTransactionOutcome(tronWeb, deterministicTxHash);
  if (delegationOutcome !== 'CONFIRMED') {
    const outcomeMessage = delegationOutcome === 'REVERTED'
      ? 'TRON resource-delegation transaction reverted on-chain'
      : 'Timed out waiting for TRON resource-delegation confirmation';
    throw new Error(`${outcomeMessage}; durable transaction ${deterministicTxHash} remains in DELEGATING for reconciliation.`);
  }

  const { data: delegationStatusRes, error: delegationStatusErr } = await supabaseAdmin.rpc('update_delegation_status', {
    p_sweep_id: sweepId,
    p_worker_id: workerId,
    p_expected_status: 'DELEGATING',
    p_new_status: 'DELEGATED',
  });
  if (delegationStatusErr || !delegationStatusRes || delegationStatusRes.success !== true) {
    throw new Error(`Confirmed TRON delegation could not be recorded: ${delegationStatusErr?.message || delegationStatusRes?.message || 'RPC did not confirm success'}`);
  }

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

  // Only a verified active delegation may start a new undelegation.
  // An UNDELEGATING row must always carry its exact previously signed payload.
  if (
    (delegation.status === 'DELEGATED' &&
      (delegation.signed_undelegation_hex || delegation.undelegation_tx_hash)) ||
    (delegation.status === 'UNDELEGATING' &&
      (!delegation.signed_undelegation_hex || !delegation.undelegation_tx_hash)) ||
    !['DELEGATED', 'UNDELEGATING'].includes(String(delegation.status || '').toUpperCase())
  ) {
    console.warn(`[Tron Resource Pool] Delegation ${sweepId} is in non-reclaimable state ${delegation.status}; manual reconciliation is required.`);
    return false;
  }

  const receiverAddress = delegation.receiver_address;
  const trxNeededSun = Number(delegation.delegated_amount_sun);

  let deterministicTxHash = delegation.undelegation_tx_hash;
  let signedTx: any = null;
  if (delegation.signed_undelegation_hex) {
    try {
      signedTx = JSON.parse(delegation.signed_undelegation_hex);
    } catch {
      console.error('[Tron Resource Pool] Persisted undelegation payload is invalid JSON; refusing to create a replacement transaction.');
      return false;
    }

    if (
      !deterministicTxHash ||
      String(signedTx?.txID || '').toLowerCase() !== String(deterministicTxHash).toLowerCase() ||
      !Array.isArray(signedTx?.signature) ||
      signedTx.signature.length === 0 ||
      !signedTx?.raw_data_hex
    ) {
      console.error('[Tron Resource Pool] Persisted undelegation transaction hash/signature/raw-data mismatch; refusing to broadcast.');
      return false;
    }
  }

  // 2. Build and sign only when no durable undelegation transaction exists.
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

  // 4. Broadcast exact persisted signed transaction bytes only while this
  // worker still owns the live parent sweep lease.
  try {
    await assertPreBroadcastOwnership(sweepId, workerId, null);
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
        console.error(
          `[Tron Resource Pool] Undelegation transaction ${deterministicTxHash} reverted on-chain: ${txInfo.ret[0]?.contractRet}. Keeping the persisted UNDELEGATING record; a new signed attempt requires explicit reconciliation.`
        );
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
      console.warn(
        `[Tron Resource Pool] Energy still appears delegated (${energyDelegation.frozen_balance_for_energy} SUN); refusing to mark resources reclaimed.`
      );
      verifiedDelegationRemoved = false;
    }
  } catch (v2Err) {
    console.warn(
      '[Tron Resource Pool] Could not independently verify delegated Energy was reclaimed; leaving the operation pending recovery:',
      v2Err
    );
    verifiedDelegationRemoved = false;
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
  if (!sweepId || !workerId) {
    return { address: depositAddress, network: 'TRC20', amountSwept: '0', txHash: '', status: 'FAILED', error: 'A database-claimed sweep ID and worker lease are required before TRON sweep.' };
  }
  const stopHeartbeat = startSweeperHeartbeat(sweepId, workerId);
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

    const usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const contract = await tronWeb.contract().at(usdtContractAddress);

    // Check TRC20 USDT balance
    const balanceSun = await contract.balanceOf(childTronAddress).call();
    const balanceUsdt = Number(balanceSun) / 1_000_000;

    if (!(await meetsMinimumSweepUsdValue('USDT', balanceUsdt))) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'TRC20',
        amountSwept: balanceUsdt.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceUsdt} USDT is below the $${MIN_SWEEP_VALUE_USD} USD-equivalent sweep threshold`,
      };
    }
    if (!HOT_WALLET_TRON_ADDRESS || !tronWeb.isAddress(HOT_WALLET_TRON_ADDRESS)) {
      throw new Error('A valid HOT_WALLET_TRON_ADDRESS must be configured before gas funding or sweeping.');
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
    const { data: priorTronGasFunding, error: priorTronGasFundingError } = await supabaseAdmin
      .from('gas_funding_operations')
      .select('status, amount_allocated, tx_hash, signed_tx_hex')
      .eq('sweep_id', sweepId)
      .maybeSingle();

    if (priorTronGasFundingError) {
      throw new Error(`Unable to inspect existing TRON gas-funding operation: ${priorTronGasFundingError.message}`);
    }

    const priorTronGasStatus = String(priorTronGasFunding?.status || '').toUpperCase();
    const hasPriorTronGasTransaction = [
      'READY_TO_BROADCAST',
      'BROADCASTED',
      'RECOVERY_REQUIRED',
    ].includes(priorTronGasStatus);
    let recoveredPriorTronGasFunding = false;

    if (hasPriorTronGasTransaction) {
      if (
        !priorTronGasFunding?.tx_hash ||
        !priorTronGasFunding?.signed_tx_hex ||
        !priorTronGasFunding?.amount_allocated
      ) {
        throw new Error('Existing TRON gas-funding transaction is incomplete; refusing a new funding or sweep attempt.');
      }

      const priorAmountSun = Math.ceil(Number(priorTronGasFunding.amount_allocated) * 1_000_000);
      if (!Number.isSafeInteger(priorAmountSun) || priorAmountSun <= 0) {
        throw new Error('Existing TRON gas-funding amount is invalid; manual reconciliation is required.');
      }

      await transitionSweepStatus(sweepId, workerId, 'CLAIMED', 'GAS_FUNDING');
      currentStatus = 'GAS_FUNDING';
      await fundTronGasForAddress(childTronAddress, priorAmountSun, sweepId, workerId);
      await transitionSweepStatus(sweepId, workerId, 'GAS_FUNDING', 'GAS_FUNDED');
      currentStatus = 'GAS_FUNDED';
      recoveredPriorTronGasFunding = true;
    }

    if (!isActivated) {
      if (!recoveredPriorTronGasFunding) {
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
      await stopHeartbeat.assertLease();
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
 * Gets a live network fee recommendation from the configured mempool-compatible API.
 * Refuses to sign with a stale hard-coded fee if the fee provider is unavailable.
 */
async function getRecommendedUtxoFeeRate(
  apiBase: string,
  network: 'BTC' | 'LTC'
): Promise<number> {
  const baseUrl = apiBase.replace(new RegExp(String.fromCharCode(47) + '+$'), '');
  const response = await fetch(`${baseUrl}/v1/fees/recommended`);
  if (!response.ok) {
    throw new Error(`${network} fee recommendation request failed: HTTP ${response.status}`);
  }

  const feeData: any = await response.json();
  const candidates = [feeData?.halfHourFee, feeData?.fastestFee, feeData?.minimumFee];
  const feeRate = candidates.find((value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  );

  if (typeof feeRate !== 'number') {
    throw new Error(`${network} fee provider returned no valid positive recommended fee rate`);
  }

  return feeRate;
}

/**
 * Verify each provider-reported UTXO against the serialized previous transaction.
 * The raw transaction hash binds the output script/value to the outpoint; the
 * transaction metadata endpoint must also report a confirmed block inclusion.
 * Any disagreement fails closed before the UTXO is reserved or signed.
 */
async function verifyUtxoPrevouts(
  apiBase: string,
  network: 'BTC' | 'LTC',
  utxos: Array<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }>,
  expectedDepositScript: Buffer
): Promise<void> {
  if (!Array.isArray(utxos) || utxos.length === 0 || utxos.length > 100) {
    throw new Error(`${network} UTXO set is empty or exceeds the supported input limit`);
  }

  const baseUrl = apiBase.replace(new RegExp(String.fromCharCode(47) + '+$'), '');
  const uniqueTxids = [...new Set(utxos.map((utxo) => String(utxo.txid).toLowerCase()))];
  const previousTransactions = new Map<string, bitcoin.Transaction>();

  // Bound concurrency to avoid overwhelming public Esplora-compatible APIs.
  for (let offset = 0; offset < uniqueTxids.length; offset += 4) {
    const batch = uniqueTxids.slice(offset, offset + 4);
    await Promise.all(batch.map(async (txid) => {
      if (!/^[a-f0-9]{64}$/.test(txid)) {
        throw new Error(`${network} UTXO contains an invalid previous transaction ID`);
      }

      const [rawResponse, detailResponse] = await Promise.all([
        fetch(`${baseUrl}/tx/${txid}/hex`),
        fetch(`${baseUrl}/tx/${txid}`),
      ]);
      if (!rawResponse.ok || !detailResponse.ok) {
        throw new Error(`${network} previous transaction lookup failed for ${txid}`);
      }

      const rawHex = (await rawResponse.text()).trim();
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(rawHex)) {
        throw new Error(`${network} previous transaction endpoint returned invalid raw hex for ${txid}`);
      }

      const previousTx = bitcoin.Transaction.fromHex(rawHex);
      if (previousTx.getId().toLowerCase() !== txid) {
        throw new Error(`${network} previous transaction hash does not match requested outpoint ${txid}`);
      }

      const details: any = await detailResponse.json();
      const status = details?.status;
      if (details?.txid && String(details.txid).toLowerCase() !== txid) {
        throw new Error(`${network} transaction metadata ID mismatch for ${txid}`);
      }
      if (
        status?.confirmed !== true ||
        !Number.isSafeInteger(status?.block_height) ||
        status.block_height <= 0 ||
        !/^[a-f0-9]{64}$/i.test(String(status?.block_hash || ''))
      ) {
        throw new Error(`${network} previous transaction ${txid} is not confirmed in a verifiable block`);
      }

      previousTransactions.set(txid, previousTx);
    }));
  }

  const seenOutpoints = new Set<string>();
  for (const utxo of utxos) {
    const txid = String(utxo.txid).toLowerCase();
    const vout = utxo.vout;
    const outpoint = `${txid}:${vout}`;
    if (seenOutpoints.has(outpoint)) {
      throw new Error(`${network} UTXO provider returned duplicate outpoint ${outpoint}`);
    }
    seenOutpoints.add(outpoint);

    if (
      utxo.status?.confirmed !== true ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      vout > 0xffffffff ||
      !Number.isSafeInteger(utxo.value) ||
      utxo.value <= 0
    ) {
      throw new Error(`${network} UTXO provider returned an invalid or unconfirmed outpoint ${outpoint}`);
    }

    const previousTx = previousTransactions.get(txid);
    const previousOutput = previousTx?.outs[vout];
    if (!previousOutput) {
      throw new Error(`${network} UTXO references a missing previous output ${outpoint}`);
    }

    if (
      !Number.isSafeInteger(previousOutput.value) ||
      previousOutput.value <= 0 ||
      previousOutput.value !== utxo.value ||
      !Buffer.from(previousOutput.script).equals(expectedDepositScript)
    ) {
      throw new Error(`${network} previous output value or deposit script does not match UTXO ${outpoint}`);
    }
  }
}

/**
 * Check freshly signed raw transaction bytes against the exact reserved input set
 * and intended single output before the persistence RPC can move it to READY_TO_BROADCAST.
 */
function assertSignedUtxoTransactionMatchesIntent(
  signedTxHex: string,
  expectedTxid: string,
  network: 'BTC' | 'LTC',
  utxos: Array<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }>,
  expectedDestinationScript: Buffer,
  expectedOutputSat: number,
  expectedFeeSat: number
): void {
  const tx = bitcoin.Transaction.fromHex(signedTxHex);
  const actualInputs = tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex').toLowerCase(),
    vout: input.index,
  }));
  const expectedInputs = utxos.map((utxo) => ({
    txid: String(utxo.txid).toLowerCase(),
    vout: utxo.vout,
  }));

  const inputsMatch = actualInputs.length === expectedInputs.length &&
    actualInputs.every((input, index) =>
      input.txid === expectedInputs[index].txid &&
      input.vout === expectedInputs[index].vout
    );

  if (
    tx.getId().toLowerCase() !== expectedTxid.toLowerCase() ||
    !inputsMatch ||
    tx.ins.some((input) => !Array.isArray(input.witness) || input.witness.length < 2) ||
    tx.outs.length !== 1 ||
    !Number.isSafeInteger(tx.outs[0]?.value) ||
    !Buffer.from(tx.outs[0]?.script || Buffer.alloc(0)).equals(expectedDestinationScript) ||
    tx.outs[0].value !== expectedOutputSat
  ) {
    throw new Error(`${network} signed transaction does not match its expected input outpoints or destination output`);
  }

  const inputTotalSat = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const actualFeeSat = inputTotalSat - BigInt(tx.outs[0].value);
  if (
    inputTotalSat <= 0n ||
    actualFeeSat < 0n ||
    actualFeeSat !== BigInt(expectedFeeSat)
  ) {
    throw new Error(`${network} signed transaction input/output fee accounting does not match the persisted intent`);
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
  if (!sweepId || !workerId) {
    return { address: depositAddress, network: 'BTC', amountSwept: '0', txHash: '', status: 'FAILED', error: 'A database-claimed sweep ID and worker lease are required before BTC sweep.' };
  }
  const stopHeartbeat = startSweeperHeartbeat(sweepId, workerId);
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

    const apiUtxos: Array<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }> = await utxoRes.json();
    if (!Array.isArray(apiUtxos)) {
      throw new Error('UTXO provider returned an invalid response shape');
    }
    const utxos = apiUtxos.filter((utxo) => utxo?.status?.confirmed === true);
    if (utxos.some((utxo) =>
      !/^[a-f0-9]{64}$/i.test(String(utxo.txid || '')) ||
      !Number.isSafeInteger(utxo.vout) || utxo.vout < 0 ||
      !Number.isSafeInteger(utxo.value) || utxo.value <= 0
    )) {
      throw new Error('UTXO provider returned an invalid confirmed outpoint or value');
    }
    if (utxos.length === 0) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No confirmed UTXOs available to sweep',
      };
    }

    await verifyUtxoPrevouts(
      btcApiBase,
      'BTC',
      utxos,
      bitcoin.address.toOutputScript(btcChildAddress, bitcoin.networks.bitcoin)
    );

    const totalSat = utxos.reduce((acc, u) => acc + u.value, 0);
    if (!Number.isSafeInteger(totalSat) || totalSat <= 0) {
      throw new Error('BTC confirmed UTXO total exceeds safe integer bounds or is invalid');
    }
    const totalBtc = totalSat / 100_000_000;

    if (!(await meetsMinimumSweepUsdValue('BTC', totalBtc))) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'BTC',
        amountSwept: totalBtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalBtc} BTC is below the $${MIN_SWEEP_VALUE_USD} USD-equivalent sweep threshold`,
      };
    }
    const hotWalletBtcAddress = requireBitcoinHotWalletAddress();

    // The service-role reservation RPC is fenced to the active sweep worker.
    if (sweepId && !workerId) {
      stopHeartbeat();
      throw new Error('BTC sweep requires a worker ID before UTXO reservation');
    }

    // Reserve UTXOs only after the address balance meets the minimum USD value.
    if (sweepId && workerId) {
      const { data: reserveRes, error: reserveErr } = await supabaseAdmin.rpc('reserve_utxos_for_sweep', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_network: 'BTC',
        p_utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout, value_sat: String(u.value) })),
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

    const satPerVbyte = await getRecommendedUtxoFeeRate(btcApiBase, 'BTC');
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeSat = Math.max(250, Math.ceil(estimatedVsize * satPerVbyte));
    if (!Number.isSafeInteger(feeSat) || feeSat <= 0) {
      throw new Error('BTC recommended fee calculation is invalid');
    }
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
      pubkey: Buffer.from(keyPair.publicKey),
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
      address: hotWalletBtcAddress,
      value: sweepSat,
    });

    const btcSigner: bitcoin.Signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
    };

    psbt.signAllInputs(btcSigner);
    psbt.finalizeAllInputs();

    const txObj = psbt.extractTransaction();
    const deterministicTxHash = txObj.getId();
    const rawTxHex = txObj.toHex();

    assertSignedUtxoTransactionMatchesIntent(
      rawTxHex,
      deterministicTxHash,
      'BTC',
      utxos,
      bitcoin.address.toOutputScript(hotWalletBtcAddress, bitcoin.networks.bitcoin),
      sweepSat,
      feeSat
    );

    // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, 'CLAIMED');
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_btc_ltc_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'CLAIMED',
        p_signed_tx_hex: rawTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_signed_utxo_intent: {
          inputs: utxos.map((u) => ({
            txid: u.txid.toLowerCase(),
            vout: u.vout,
            value_sat: String(u.value),
          })),
          destination_script_hex: txObj.outs[0]?.script.toString('hex') || '',
          output_amount_sat: String(sweepSat),
          fee_amount_sat: String(feeSat),
        },
        p_extend_lease_seconds: 300,
      });

      if (persistErr || !persistRes || persistRes.success !== true) {
        const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
        throw new Error(`Failed to persist signed BTC transaction: ${errCode}`);
      }
    }

    let txid = deterministicTxHash;
    try {
      await stopHeartbeat.assertLease();
      const broadcastRes = await fetch(`${btcApiBase}/tx`, {
        method: 'POST',
        body: rawTxHex,
        headers: { 'Content-Type': 'text/plain' },
      });

      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text();
        throw new Error(`BTC broadcast failed: ${errText}`);
      }

      const txidRaw = (await broadcastRes.text()).trim();
      if (txidRaw && txidRaw.toLowerCase() !== deterministicTxHash.toLowerCase()) {
        throw new Error(`UTXO broadcast endpoint returned a transaction ID that does not match the locally derived signed transaction: ${txidRaw}`);
      }
      txid = deterministicTxHash;

      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', deterministicTxHash);
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
  if (!sweepId || !workerId) {
    return { address: depositAddress, network: 'LTC', amountSwept: '0', txHash: '', status: 'FAILED', error: 'A database-claimed sweep ID and worker lease are required before LTC sweep.' };
  }
  const stopHeartbeat = startSweeperHeartbeat(sweepId, workerId);
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

    const apiUtxos: Array<{ txid: string; vout: number; value: number; status?: { confirmed?: boolean } }> = await utxoRes.json();
    if (!Array.isArray(apiUtxos)) {
      throw new Error('UTXO provider returned an invalid response shape');
    }
    const utxos = apiUtxos.filter((utxo) => utxo?.status?.confirmed === true);
    if (utxos.some((utxo) =>
      !/^[a-f0-9]{64}$/i.test(String(utxo.txid || '')) ||
      !Number.isSafeInteger(utxo.vout) || utxo.vout < 0 ||
      !Number.isSafeInteger(utxo.value) || utxo.value <= 0
    )) {
      throw new Error('UTXO provider returned an invalid confirmed outpoint or value');
    }
    if (utxos.length === 0) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: '0',
        txHash: '',
        status: 'SKIPPED',
        error: 'No confirmed UTXOs available to sweep',
      };
    }

    await verifyUtxoPrevouts(
      ltcApiBase,
      'LTC',
      utxos,
      bitcoin.address.toOutputScript(ltcChildAddress, LTC_NETWORK as any)
    );

    const totalLit = utxos.reduce((acc, u) => acc + u.value, 0);
    if (!Number.isSafeInteger(totalLit) || totalLit <= 0) {
      throw new Error('LTC confirmed UTXO total exceeds safe integer bounds or is invalid');
    }
    const totalLtc = totalLit / 100_000_000;

    if (!(await meetsMinimumSweepUsdValue('LTC', totalLtc))) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: 'LTC',
        amountSwept: totalLtc.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${totalLtc} LTC is below the $${MIN_SWEEP_VALUE_USD} USD-equivalent sweep threshold`,
      };
    }
    const hotWalletLtcAddress = requireLitecoinHotWalletAddress();

    if (sweepId && !workerId) {
      stopHeartbeat();
      throw new Error('LTC sweep requires a worker ID before UTXO reservation');
    }

    if (sweepId && workerId) {
      const { data: reserveRes, error: reserveErr } = await supabaseAdmin.rpc('reserve_utxos_for_sweep', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_network: 'LTC',
        p_utxos: utxos.map((u) => ({ txid: u.txid, vout: u.vout, value_sat: String(u.value) })),
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

    const litPerVbyte = await getRecommendedUtxoFeeRate(ltcApiBase, 'LTC');
    const estimatedVsize = 68 * utxos.length + 31 + 10;
    const feeLit = Math.max(200, Math.ceil(estimatedVsize * litPerVbyte));
    if (!Number.isSafeInteger(feeLit) || feeLit <= 0) {
      throw new Error('LTC recommended fee calculation is invalid');
    }
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
      pubkey: Buffer.from(keyPair.publicKey),
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
      address: hotWalletLtcAddress,
      value: sweepLit,
    });

    const ltcSigner: bitcoin.Signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
    };

    psbt.signAllInputs(ltcSigner);
    psbt.finalizeAllInputs();

    const txObj = psbt.extractTransaction();
    const deterministicTxHash = txObj.getId();
    const rawTxHex = txObj.toHex();

    assertSignedUtxoTransactionMatchesIntent(
      rawTxHex,
      deterministicTxHash,
      'LTC',
      utxos,
      bitcoin.address.toOutputScript(hotWalletLtcAddress, LTC_NETWORK as any),
      sweepLit,
      feeLit
    );

    // Step 3 & 4: Durable database persistence & READY_TO_BROADCAST transition
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, 'CLAIMED');
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_btc_ltc_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'CLAIMED',
        p_signed_tx_hex: rawTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_signed_utxo_intent: {
          inputs: utxos.map((u) => ({
            txid: u.txid.toLowerCase(),
            vout: u.vout,
            value_sat: String(u.value),
          })),
          destination_script_hex: txObj.outs[0]?.script.toString('hex') || '',
          output_amount_sat: String(sweepLit),
          fee_amount_sat: String(feeLit),
        },
        p_extend_lease_seconds: 300,
      });

      if (persistErr || !persistRes || persistRes.success !== true) {
        const errCode = persistRes?.code || persistRes?.message || persistErr?.message || 'PERSIST_RPC_ERROR';
        throw new Error(`Failed to persist signed LTC transaction: ${errCode}`);
      }
    }

    let txid = deterministicTxHash;
    try {
      await stopHeartbeat.assertLease();
      const broadcastRes = await fetch(`${ltcApiBase}/tx`, {
        method: 'POST',
        body: rawTxHex,
        headers: { 'Content-Type': 'text/plain' },
      });

      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text();
        throw new Error(`LTC broadcast failed: ${errText}`);
      }

      const txidRaw = (await broadcastRes.text()).trim();
      if (txidRaw && txidRaw.toLowerCase() !== deterministicTxHash.toLowerCase()) {
        throw new Error(`UTXO broadcast endpoint returned a transaction ID that does not match the locally derived signed transaction: ${txidRaw}`);
      }
      txid = deterministicTxHash;

      if (sweepId && workerId) {
        await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', deterministicTxHash);
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

  if (!sweepId || !workerId) {
    return { address: depositAddress, network: normNet || 'UNKNOWN', amountSwept: '0', txHash: '', status: 'FAILED', error: 'A database-claimed sweep ID and worker lease are required before deposit sweep.' };
  }

  if (normNet === 'TRC20' || normNet === 'TRON' || normAsset === 'TRX') {
    return sweepTronDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  if (normNet === 'BTC' || normAsset === 'BTC') {
    return sweepBtcDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  if (normNet === 'LTC' || normAsset === 'LTC') {
    return sweepLtcDepositAddress(depositAddress, derivationIndex, sweepId, workerId);
  }

  const stopHeartbeat = startSweeperHeartbeat(sweepId, workerId);
  let hasAllocatedNonce = false;
  let allocatedNonce: number | null = null;

  try {
    const rpcUrl = getRpcUrlForNetwork(normNet);
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const expectedChainId = ['BEP20', 'BSC', 'BINANCE'].includes(normNet) ? 56n : 1n;
    const providerNetwork = await provider.getNetwork();
    if (providerNetwork.chainId !== expectedChainId) {
      throw new Error(
        `EVM RPC chain mismatch for ${normNet}: expected chain ID ${expectedChainId}, received ${providerNetwork.chainId}`
      );
    }

    const derivedWallet = getDerivedEVMWallet(derivationIndex, provider);

    if (derivedWallet.address.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new Error(`Address mismatch: Derived ${derivedWallet.address} != Expected ${depositAddress}`);
    }

    let currentStatus = 'CLAIMED';
    if (sweepId) {
      const { data: sweepRow } = await supabaseAdmin
        .from('sweep_operations')
        .select('status')
        .eq('id', sweepId)
        .maybeSingle();
      if (sweepRow?.status && ['CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED'].includes(sweepRow.status)) {
        currentStatus = sweepRow.status;
      }
    }

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
        const parsedNonce = Number(resNonce);
        if (!Number.isSafeInteger(parsedNonce) || parsedNonce < 0) {
          throw new Error(`Nonce allocator returned an invalid nonce value: ${String(resNonce)}`);
        }
        allocatedNonce = parsedNonce;
        hasAllocatedNonce = true;
        return allocatedNonce;
      }
      return provider.getTransactionCount(depositAddress, 'pending');
    };

    const holdEvmSweepForReceiptReconciliation = async (
      txHash: string,
      reason: string
    ): Promise<void> => {
      const { data, error } = await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'BROADCASTED',
        p_new_status: 'RECOVERY_REQUIRED',
        p_tx_hash: txHash,
        p_error_message: reason.slice(0, 1000),
      });
      if (error || !data || data.success !== true) {
        console.error(
          `[EVM Sweeper] Failed to persist receipt recovery hold for ${sweepId}:`,
          error || data
        );
      }
    };

    // 1. Native ETH Sweep
    if (normAsset === 'ETH' || normNet === 'ETH') {
      const balance = await provider.getBalance(depositAddress);
      const balanceEth = Number(ethers.formatEther(balance));
      if (!(await meetsMinimumSweepUsdValue('ETH', balanceEth))) {
        stopHeartbeat();
        return {
          address: depositAddress,
          network: normNet,
          amountSwept: ethers.formatEther(balance),
          txHash: '',
          status: 'SKIPPED',
          error: `Balance ${balanceEth} ETH is below the $${MIN_SWEEP_VALUE_USD} USD-equivalent sweep threshold`,
        };
      }
      const evmHotWalletAddress = requireEvmHotWalletAddress();
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (gasPrice === null || gasPrice === undefined || gasPrice <= 0n) {
        throw new Error(`Live ${normNet} gas-price/fee-cap quote is unavailable; refusing a hard-coded fee fallback.`);
      }
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
        to: evmHotWalletAddress,
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
          p_asset_code: 'ETH',
          p_token_contract: null,
          p_recipient: evmHotWalletAddress,
          p_amount_raw: sweepAmount.toString(),
          p_chain_id: 1,
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
        // Step 5: Revalidate the live owner lease immediately before broadcast.
        await stopHeartbeat.assertLease();
        txResponse = await provider.broadcastTransaction(signedTxHex);
        if (String(txResponse.hash).toLowerCase() !== deterministicTxHash.toLowerCase()) {
          throw new Error(`EVM node returned a broadcast hash that differs from the locally signed transaction: ${txResponse.hash}`);
        }
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

      let receipt;
      try {
        receipt = await txResponse.wait(1);
      } catch (receiptErr: any) {
        await holdEvmSweepForReceiptReconciliation(
          deterministicTxHash,
          `Native ETH sweep receipt is uncertain or reverted: ${receiptErr?.message || receiptErr}`
        );
        throw receiptErr;
      }
      if (!receipt || receipt.status !== 1) {
        const reason = `Native ETH sweep did not produce a successful receipt (status: ${String(receipt?.status)}).`;
        await holdEvmSweepForReceiptReconciliation(deterministicTxHash, reason);
        throw new Error(reason);
      }
      stopHeartbeat();

      return {
        address: depositAddress,
        network: normNet,
        amountSwept: ethers.formatEther(sweepAmount),
        txHash: deterministicTxHash,
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

    if (!(await meetsMinimumSweepUsdValue('USDT', balanceFormatted))) {
      stopHeartbeat();
      return {
        address: depositAddress,
        network: normNet,
        amountSwept: balanceFormatted.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceFormatted} USDT is below the $${MIN_SWEEP_VALUE_USD} USD-equivalent sweep threshold`,
      };
    }
    const evmHotWalletAddress = requireEvmHotWalletAddress();

    const nativeGasBalance = await provider.getBalance(depositAddress);
    const feeData = await provider.getFeeData();
    const baseGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (baseGasPrice === null || baseGasPrice === undefined || baseGasPrice <= 0n) {
      throw new Error(`Live ${normNet} gas-price/fee-cap quote is unavailable; refusing a hard-coded fee fallback.`);
    }
    const priorityGasPrice = (baseGasPrice * 200n) / 100n;
    const estimatedGasLimit = 65000n;
    const requiredGasFee = priorityGasPrice * estimatedGasLimit;

    const { data: existingGasFunding, error: existingGasFundingError } = await supabaseAdmin
      .from('gas_funding_operations')
      .select('status, amount_allocated, tx_hash, signed_tx_hex, nonce, funding_wallet_address')
      .eq('sweep_id', sweepId)
      .maybeSingle();

    if (existingGasFundingError) {
      throw new Error(`Unable to inspect existing EVM gas-funding operation: ${existingGasFundingError.message}`);
    }

    let existingGasFundingStatus = String(existingGasFunding?.status || '').toUpperCase();
    const hasPersistedGasFundingIdentity =
      Boolean(String(existingGasFunding?.tx_hash || '').trim()) ||
      Boolean(String(existingGasFunding?.signed_tx_hex || '').trim());

    if (
      existingGasFundingStatus === 'RECOVERY_REQUIRED' &&
      existingGasFunding?.nonce == null &&
      !existingGasFunding?.funding_wallet_address &&
      !hasPersistedGasFundingIdentity &&
      nativeGasBalance >= requiredGasFee
    ) {
      // There is no nonce reservation and no transaction identity, and the
      // child already has enough native gas. Close the pre-signing recovery
      // record instead of leaving an orphaned RECOVERY_REQUIRED child row.
      await updateGasFundingStatus(
        sweepId,
        workerId,
        'FAILED',
        'Closed pre-signing recovery: no nonce or signed transaction existed and child gas balance now covers the required sweep fee.'
      );
      existingGasFundingStatus = 'FAILED';
    }

    const hasAllocatedNonceWithoutSignedPayload =
      ['PENDING', 'RECOVERY_REQUIRED'].includes(existingGasFundingStatus) &&
      existingGasFunding?.nonce !== null &&
      existingGasFunding?.nonce !== undefined &&
      !hasPersistedGasFundingIdentity;
    const requiresGasFundingReconciliation =
      ['READY_TO_BROADCAST', 'BROADCASTED'].includes(existingGasFundingStatus) ||
      (existingGasFundingStatus === 'RECOVERY_REQUIRED' && hasPersistedGasFundingIdentity) ||
      hasAllocatedNonceWithoutSignedPayload;

    if (existingGasFundingStatus === 'CONFIRMED' && nativeGasBalance < requiredGasFee) {
      throw new Error(
        'A prior EVM gas-funding transaction is confirmed, but the child wallet still lacks the currently estimated sweep gas; refusing to silently reuse or duplicate that funding operation.'
      );
    }

    if (
      requiresGasFundingReconciliation &&
      !hasAllocatedNonceWithoutSignedPayload &&
      (
        !existingGasFunding?.tx_hash ||
        !existingGasFunding?.signed_tx_hex ||
        !existingGasFunding?.amount_allocated ||
        Number(existingGasFunding.amount_allocated) <= 0
      )
    ) {
      throw new Error('Existing EVM gas-funding transaction is incomplete; refusing a new funding or sweep attempt.');
    }
    if (
      hasAllocatedNonceWithoutSignedPayload &&
      (
        !existingGasFunding?.amount_allocated ||
        Number(existingGasFunding.amount_allocated) <= 0 ||
        !existingGasFunding?.funding_wallet_address
      )
    ) {
      throw new Error('Existing EVM gas-funding nonce reservation is incomplete; manual reconciliation is required.');
    }

    if (nativeGasBalance < requiredGasFee || requiresGasFundingReconciliation) {
      const gasBuffer = normNet === 'BEP20' || normNet === 'BSC'
        ? ethers.parseUnits(process.env.EVM_GAS_FUNDING_BUFFER_BNB || '0.0005', 'ether')
        : ethers.parseUnits(process.env.EVM_GAS_FUNDING_BUFFER_ETH || '0.0002', 'ether');
      const calculatedTopUpAmount = requiredGasFee - nativeGasBalance + gasBuffer;
      const topUpAmount = requiresGasFundingReconciliation
        ? ethers.parseEther(String(existingGasFunding?.amount_allocated ?? ''))
        : calculatedTopUpAmount;
      const nativeSymbol = normNet === 'BEP20' || normNet === 'BSC' ? 'BNB' : 'ETH';
      console.log(
        requiresGasFundingReconciliation
          ? `[Sweeper] Reconciling existing ${nativeSymbol} gas-funding transaction ${existingGasFunding?.tx_hash || 'unknown'} for ${depositAddress}.`
          : `[Sweeper] Auto-funding ${ethers.formatEther(topUpAmount)} ${nativeSymbol} gas to ${depositAddress}...`
      );
      if (sweepId && workerId && currentStatus === 'CLAIMED') {
        await transitionSweepStatus(sweepId, workerId, 'CLAIMED', 'GAS_FUNDING');
        currentStatus = 'GAS_FUNDING';
      }
      await fundGasForAddress(depositAddress, topUpAmount, provider, sweepId, workerId, normNet, requiredGasFee);
      if (sweepId && workerId && currentStatus === 'GAS_FUNDING') {
        await transitionSweepStatus(sweepId, workerId, 'GAS_FUNDING', 'GAS_FUNDED');
        currentStatus = 'GAS_FUNDED';
      }
    }

    const nonceVal = await getOrAllocateNonce();

    const txReq = await tokenContract.transfer.populateTransaction(evmHotWalletAddress, balanceRaw, {
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

    // Step 3 & 4: Persist signed bytes and immutable transfer intent before broadcast.
    if (sweepId && workerId) {
      await assertPreBroadcastOwnership(sweepId, workerId, currentStatus);
      const { data: persistRes, error: persistErr } = await supabaseAdmin.rpc('persist_signed_evm_transaction', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: currentStatus,
        p_nonce: nonceVal,
        p_signed_tx_hex: signedTxHex,
        p_sweep_tx_hash: deterministicTxHash,
        p_asset_code: 'USDT',
        p_token_contract: tokenConfig.contractAddress,
        p_recipient: evmHotWalletAddress,
        p_amount_raw: balanceRaw.toString(),
        p_chain_id: normNet === 'BEP20' || normNet === 'BSC' ? 56 : 1,
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
      // Step 5: Revalidate the live owner lease immediately before broadcast.
      await stopHeartbeat.assertLease();
      txResponse = await provider.broadcastTransaction(signedTxHex);
      if (String(txResponse.hash).toLowerCase() !== deterministicTxHash.toLowerCase()) {
        throw new Error(`EVM node returned a broadcast hash that differs from the locally signed transaction: ${txResponse.hash}`);
      }
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

    let receipt;
    try {
      receipt = await txResponse.wait(1);
    } catch (receiptErr: any) {
      await holdEvmSweepForReceiptReconciliation(
        deterministicTxHash,
        `USDT sweep receipt is uncertain or reverted: ${receiptErr?.message || receiptErr}`
      );
      throw receiptErr;
    }
    if (!receipt || receipt.status !== 1) {
      const reason = `USDT sweep did not produce a successful receipt (status: ${String(receipt?.status)}).`;
      await holdEvmSweepForReceiptReconciliation(deterministicTxHash, reason);
      throw new Error(reason);
    }
    stopHeartbeat();

    return {
      address: depositAddress,
      network: normNet,
      amountSwept: balanceFormatted.toString(),
      txHash: deterministicTxHash,
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
 * Returns a complete two-explorer proof only when every signed input has been
 * spent by a different transaction and that spend is deep enough in both views.
 * A missing/unconfirmed result returns null: absence is never proof of non-broadcast.
 */
async function collectConfirmedUtxoConflictProofs(
  network: 'BTC' | 'LTC',
  sweepTxHash: string,
  signedUtxoIntent: any
): Promise<Array<Record<string, string>> | null> {
  const primaryBase = (network === 'BTC'
    ? process.env.BTC_MEMPOOL_API || 'https://mempool.space/api'
    : process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api').replace(/\/+$/, '');
  const secondaryRaw = network === 'BTC'
    ? process.env.BTC_CONFLICT_PROOF_API || 'https://blockstream.info/api'
    : process.env.LTC_CONFLICT_PROOF_API;
  if (!secondaryRaw) return null;

  let primaryOrigin: string;
  let secondaryOrigin: string;
  let secondaryBase: string;
  try {
    const primaryUrl = new URL(primaryBase);
    secondaryBase = secondaryRaw.replace(/\/+$/, '');
    const secondaryUrl = new URL(secondaryBase);
    if (primaryUrl.protocol !== 'https:' || secondaryUrl.protocol !== 'https:') {
      return null;
    }
    primaryOrigin = primaryUrl.origin;
    secondaryOrigin = secondaryUrl.origin;
  } catch {
    return null;
  }
  if (!primaryOrigin || !secondaryOrigin || primaryOrigin === secondaryOrigin) return null;

  const inputs = Array.isArray(signedUtxoIntent?.inputs) ? signedUtxoIntent.inputs : [];
  if (inputs.length < 1 || inputs.length > 100) return null;
  const requiredConfirmations = network === 'BTC' ? 6 : 12;

  const readTip = async (base: string): Promise<number> => {
    const response = await fetch(`${base}/blocks/tip/height`);
    if (!response.ok) throw new Error(`Tip-height lookup failed: HTTP ${response.status}`);
    const height = Number((await response.text()).trim());
    if (!Number.isSafeInteger(height) || height <= 0) {
      throw new Error('Explorer returned an invalid chain tip height');
    }
    return height;
  };

  const [primaryTip, secondaryTip] = await Promise.all([
    readTip(primaryBase),
    readTip(secondaryBase),
  ]);

  const readConfirmedSpend = async (
    base: string,
    inputTxid: string,
    inputVout: number
  ): Promise<{ txid: string; blockHash: string; blockHeight: number } | null> => {
    const outspendResponse = await fetch(`${base}/tx/${inputTxid}/outspend/${inputVout}`);
    if (!outspendResponse.ok) {
      throw new Error(`Outspend lookup failed: HTTP ${outspendResponse.status}`);
    }
    const outspend: any = await outspendResponse.json();
    const spendingTxid = String(outspend?.txid || '').toLowerCase();
    if (outspend?.spent !== true || !/^[a-f0-9]{64}$/.test(spendingTxid)) return null;
    if (spendingTxid === sweepTxHash.toLowerCase()) return null;

    const [detailsResponse, rawResponse] = await Promise.all([
      fetch(`${base}/tx/${spendingTxid}`),
      fetch(`${base}/tx/${spendingTxid}/hex`),
    ]);
    if (!detailsResponse.ok || !rawResponse.ok) return null;

    const details: any = await detailsResponse.json();
    const rawHex = (await rawResponse.text()).trim();
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(rawHex)) return null;
    const spendingTx = bitcoin.Transaction.fromHex(rawHex);
    if (spendingTx.getId().toLowerCase() !== spendingTxid) return null;

    const actuallySpendsInput = spendingTx.ins.some((input) =>
      Buffer.from(input.hash).reverse().toString('hex').toLowerCase() === inputTxid &&
      input.index === inputVout
    );
    const status = details?.status;
    const blockHeight = Number(status?.block_height);
    const blockHash = String(status?.block_hash || '').toLowerCase();
    if (
      !actuallySpendsInput ||
      status?.confirmed !== true ||
      !Number.isSafeInteger(blockHeight) ||
      blockHeight <= 0 ||
      !/^[a-f0-9]{64}$/.test(blockHash)
    ) {
      return null;
    }

    const canonicalBlockResponse = await fetch(`${base}/block-height/${blockHeight}`);
    if (!canonicalBlockResponse.ok) return null;
    const canonicalBlockHash = (await canonicalBlockResponse.text()).trim().toLowerCase();
    if (
      !/^[a-f0-9]{64}$/.test(canonicalBlockHash) ||
      canonicalBlockHash !== blockHash
    ) {
      return null;
    }

    return { txid: spendingTxid, blockHash, blockHeight };
  };

  const proofs: Array<Record<string, string>> = [];
  for (let offset = 0; offset < inputs.length; offset += 4) {
    const batch = inputs.slice(offset, offset + 4);
    const batchProofs = await Promise.all(batch.map(async (input: any) => {
      const inputTxid = String(input?.txid || '').toLowerCase();
      const voutText = String(input?.vout ?? '');
      const inputVout = Number(voutText);
      if (
        !/^[a-f0-9]{64}$/.test(inputTxid) ||
        !/^[0-9]{1,10}$/.test(voutText) ||
        !Number.isSafeInteger(inputVout) ||
        inputVout < 0 ||
        inputVout > 0x7fffffff
      ) {
        throw new Error('Signed UTXO intent contains an invalid outpoint');
      }

      const [primarySpend, secondarySpend] = await Promise.all([
        readConfirmedSpend(primaryBase, inputTxid, inputVout),
        readConfirmedSpend(secondaryBase, inputTxid, inputVout),
      ]);
      if (
        !primarySpend ||
        !secondarySpend ||
        primarySpend.txid !== secondarySpend.txid ||
        primarySpend.blockHash !== secondarySpend.blockHash ||
        primarySpend.blockHeight !== secondarySpend.blockHeight
      ) {
        return null;
      }

      const primaryDepth = primaryTip - primarySpend.blockHeight + 1;
      const secondaryDepth = secondaryTip - secondarySpend.blockHeight + 1;
      if (Math.min(primaryDepth, secondaryDepth) < requiredConfirmations) return null;

      return {
        input_txid: inputTxid,
        input_vout: String(inputVout),
        conflicting_txid: primarySpend.txid,
        conflicting_block_hash: primarySpend.blockHash,
        conflicting_block_height: String(primarySpend.blockHeight),
        primary_tip_height: String(primaryTip),
        secondary_tip_height: String(secondaryTip),
        primary_source: new URL(primaryBase).hostname,
        secondary_source: new URL(secondaryBase).hostname,
      };
    }));
    if (batchProofs.some((proof) => proof === null)) return null;
    proofs.push(...batchProofs as Array<Record<string, string>>);
  }

  return proofs.length === inputs.length ? proofs : null;
}

/**
 * Requires independent Esplora-compatible views to agree on the transaction,
 * containing block and canonical block hash, plus network-specific depth.
 * A single explorer's "confirmed" flag is never sufficient for UTXO finality.
 */
async function isUtxoSweepCanonicallyConfirmed(
  network: 'BTC' | 'LTC',
  transactionId: string
): Promise<{
  txid: string;
  blockHash: string;
  blockHeight: number;
  primaryTipHeight: number;
  secondaryTipHeight: number;
  primarySource: string;
  secondarySource: string;
} | null> {
  const primaryBase = (
    network === 'BTC'
      ? process.env.BTC_MEMPOOL_API || 'https://mempool.space/api'
      : process.env.LTC_MEMPOOL_API || 'https://litecoinspace.org/api'
  ).replace(/\/+$/, '');
  const secondaryRaw = network === 'BTC'
    ? process.env.BTC_FINALITY_API || 'https://blockstream.info/api'
    : process.env.LTC_FINALITY_API || process.env.LTC_CONFLICT_PROOF_API;
  if (!secondaryRaw) return null;

  let secondaryBase: string;
  try {
    const primaryUrl = new URL(primaryBase);
    secondaryBase = secondaryRaw.replace(/\/+$/, '');
    const secondaryUrl = new URL(secondaryBase);
    if (
      !['https:', 'http:'].includes(primaryUrl.protocol) ||
      !['https:', 'http:'].includes(secondaryUrl.protocol) ||
      primaryUrl.origin === secondaryUrl.origin
    ) return null;
  } catch {
    return null;
  }

  const txid = String(transactionId || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txid)) return null;

  const readSource = async (base: string) => {
    const [tipResponse, detailResponse, rawResponse] = await Promise.all([
      fetch(`${base}/blocks/tip/height`),
      fetch(`${base}/tx/${txid}`),
      fetch(`${base}/tx/${txid}/hex`),
    ]);
    if (!tipResponse.ok || !detailResponse.ok || !rawResponse.ok) return null;

    const tipHeight = Number((await tipResponse.text()).trim());
    const details: any = await detailResponse.json();
    const rawHex = (await rawResponse.text()).trim();
    if (
      !Number.isSafeInteger(tipHeight) ||
      tipHeight <= 0 ||
      !/^(?:[0-9a-fA-F]{2})+$/.test(rawHex)
    ) return null;

    const parsed = bitcoin.Transaction.fromHex(rawHex);
    const reportedTxid = String(details?.txid || txid).toLowerCase();
    const blockHeight = Number(details?.status?.block_height);
    const blockHash = String(details?.status?.block_hash || '').toLowerCase();
    if (
      parsed.getId().toLowerCase() !== txid ||
      reportedTxid !== txid ||
      details?.status?.confirmed !== true ||
      !Number.isSafeInteger(blockHeight) ||
      blockHeight <= 0 ||
      blockHeight > tipHeight ||
      !/^[a-f0-9]{64}$/.test(blockHash)
    ) return null;

    const canonicalResponse = await fetch(`${base}/block-height/${blockHeight}`);
    if (!canonicalResponse.ok) return null;
    const canonicalBlockHash = (await canonicalResponse.text()).trim().toLowerCase();
    if (
      !/^[a-f0-9]{64}$/.test(canonicalBlockHash) ||
      canonicalBlockHash !== blockHash
    ) return null;

    return { tipHeight, blockHeight, blockHash, txid: parsed.getId().toLowerCase() };
  };

  try {
    const [primary, secondary] = await Promise.all([
      readSource(primaryBase),
      readSource(secondaryBase),
    ]);
    if (!primary || !secondary) return null;

    const minConfirmations = network === 'BTC' ? 6 : 12;
    const primaryDepth = primary.tipHeight - primary.blockHeight + 1;
    const secondaryDepth = secondary.tipHeight - secondary.blockHeight + 1;

    if (
      primary.txid !== secondary.txid ||
      primary.blockHash !== secondary.blockHash ||
      primary.blockHeight !== secondary.blockHeight ||
      primaryDepth < minConfirmations ||
      secondaryDepth < minConfirmations
    ) return null;

    return {
      txid: primary.txid,
      blockHash: primary.blockHash,
      blockHeight: primary.blockHeight,
      primaryTipHeight: primary.tipHeight,
      secondaryTipHeight: secondary.tipHeight,
      primarySource: new URL(primaryBase).hostname,
      secondarySource: new URL(secondaryBase).hostname,
    };
  } catch (error) {
    console.error(`[${network} Sweep Finality] Independent canonicality check failed:`, error);
    return null;
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
  let recoveryStatus = status;
  await assertPreBroadcastOwnership(sweepId, workerId, status);

  const net = (network || '').toUpperCase().trim();
  const isEvmNetwork = ['ERC20', 'BEP20', 'ETH', 'BSC', 'ETHEREUM', 'BINANCE'].includes(net);
  const canonicalEvmNetwork = ['BEP20', 'BSC', 'BINANCE'].includes(net) ? 'BEP20' : 'ERC20';

  // Pre-broadcast TRON cleanup can legitimately have no sweep transaction hash.
  // Reconcile only when a persisted delegation record proves that Energy may
  // still be attached to this receiver; never invent a transfer hash.
  if (
    status === 'RECOVERY_REQUIRED' &&
    !sweep_tx_hash &&
    (net === 'TRC20' || net === 'TRON')
  ) {
    const { data: delegation, error: delegationError } = await supabaseAdmin
      .from('resource_delegation_operations')
      .select('status, verified_onchain_undelegated')
      .eq('sweep_id', sweepId)
      .maybeSingle();

    if (delegationError) {
      throw new Error(`Unable to inspect TRON resource delegation during pre-broadcast recovery: ${delegationError.message}`);
    }

    if (
      delegation &&
      ['DELEGATED', 'UNDELEGATING'].includes(String(delegation.status || '').toUpperCase()) &&
      delegation.verified_onchain_undelegated !== true
    ) {
      const resourcesReclaimed = await undelegateEnergyToPool(sweepId, workerId);
      if (!resourcesReclaimed) return false;

      await transitionSweepStatus(
        sweepId,
        workerId,
        'RECOVERY_REQUIRED',
        'FAILED',
        { errorMessage: 'Pre-broadcast sweep was stopped after verified TRON Energy reclamation.' }
      );
      return true;
    }
  }

  if (status === 'GAS_FUNDING' || status === 'GAS_FUNDED') {
    if (!isEvmNetwork) return false;

    const { data: gasOp, error: gasOpError } = await supabaseAdmin
      .from('gas_funding_operations')
      .select('status, tx_hash, signed_tx_hex, nonce, amount_allocated, funding_wallet_address, funding_receipt_status')
      .eq('sweep_id', sweepId)
      .maybeSingle();

    if (gasOpError) {
      throw new Error(`Unable to inspect gas-funding operation during parent recovery: ${gasOpError.message}`);
    }

    const childStatus = String(gasOp?.status || '').toUpperCase();
    const childHash = String(gasOp?.tx_hash || '').trim();
    const childSignedTx = String(gasOp?.signed_tx_hex || '').trim();

    if (
      status === 'GAS_FUNDED' &&
      (
        !gasOp ||
        !childHash ||
        !childSignedTx ||
        !['CONFIRMED', 'RECOVERY_REQUIRED'].includes(childStatus)
      )
    ) {
      await transitionSweepStatus(
        sweepId,
        workerId,
        'GAS_FUNDED',
        'RECOVERY_REQUIRED',
        {
          errorMessage: 'GAS_FUNDED parent does not have a durable, receipt-backed gas-funding transaction identity. Automatic continuation blocked.',
        }
      );
      return false;
    }

    if (childStatus === 'FAILED') {
      if (
        gasOp?.nonce === null &&
        !childHash &&
        !childSignedTx &&
        gasOp?.funding_receipt_status == null
      ) {
        // Policy rejection before nonce reservation/signing: no transaction
        // could have reached the network, so the parent may safely terminate.
        await transitionSweepStatus(
          sweepId,
          workerId,
          status,
          'FAILED',
          { errorMessage: 'EVM gas funding failed before nonce allocation or signing; no transaction was broadcast.' }
        );
        return true;
      }

      await transitionSweepStatus(
        sweepId,
        workerId,
        status,
        'RECOVERY_REQUIRED',
        { errorMessage: 'Gas-funding operation is FAILED after nonce/transaction activity; operator reconciliation is required.' }
      );
      return false;
    }

    if (Boolean(childHash) !== Boolean(childSignedTx)) {
      await transitionSweepStatus(
        sweepId,
        workerId,
        status,
        'RECOVERY_REQUIRED',
        { errorMessage: 'Gas-funding record contains only one of transaction hash or signed bytes; manual reconciliation required.' }
      );
      return false;
    }

    let fundingConfirmed = false;
    if (childHash && childSignedTx) {
      if (!gasOp?.amount_allocated || Number(gasOp.amount_allocated) <= 0) {
        await transitionSweepStatus(
          sweepId,
          workerId,
          status,
          'RECOVERY_REQUIRED',
          { errorMessage: 'Persisted gas-funding transaction has no valid allocated amount; manual reconciliation required.' }
        );
        return false;
      }

      // Adopt the persisted child operation under this newly claimed parent
      // lease before any receipt/status RPC that is worker-bound.
      const { data: adoptedGasOp, error: adoptGasError } = await supabaseAdmin.rpc(
        'claim_gas_funding_operation',
        {
          p_sweep_id: sweepId,
          p_deposit_address: String(sweep.deposit_address || ''),
          p_network: net,
          p_amount_allocated: String(gasOp.amount_allocated),
          p_worker_id: workerId,
        }
      );
      if (adoptGasError || adoptedGasOp?.success !== true) {
        throw new Error(
          `Could not adopt persisted EVM gas-funding operation for recovery: ${adoptGasError?.message || adoptedGasOp?.message || adoptedGasOp?.code || 'unknown response'}`
        );
      }

      const rpcUrl = getRpcUrlForNetwork(net);
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const fundingFinality = await getEvmSweepReceiptFinality(provider, childHash, net);

      if (fundingFinality !== 'CONFIRMED' && childStatus === 'CONFIRMED') {
        // A receipt previously treated as final is no longer visible as
        // canonical. Re-lock this nonce before any other hot-wallet funding
        // operation can allocate a later nonce.
        const { data: reorgLock, error: reorgLockError } = await supabaseAdmin.rpc(
          'mark_evm_gas_funding_receipt_recovery_required',
          {
            p_sweep_id: sweepId,
            p_worker_id: workerId,
            p_tx_hash: childHash,
            p_error_message: 'Previously confirmed EVM gas-funding receipt is no longer canonical at the configured RPC; preserving its nonce until revalidated.',
          }
        );
        if (reorgLockError || reorgLock?.success !== true) {
          throw new Error(
            `Could not re-lock previously confirmed EVM gas-funding nonce after receipt canonicality loss: ${reorgLockError?.message || reorgLock?.code || 'unknown response'}`
          );
        }
      }

      if (fundingFinality === 'PENDING') {
        // A missing transaction plus an advanced shared hot-wallet nonce is an
        // incident, not proof of payout or failure. Record it without settling,
        // replacing, refunding, or releasing the reserved nonce.
        if (Number.isSafeInteger(Number(gasOp.nonce)) && Number(gasOp.nonce) >= 0) {
          try {
            const [expectedTransaction, expectedReceipt] = await Promise.all([
              provider.getTransaction(childHash),
              provider.getTransactionReceipt(childHash),
            ]);
            if (!expectedTransaction && !expectedReceipt) {
              const walletAddress = ethers.getAddress(
                String(gasOp.funding_wallet_address || requireEvmHotWalletAddress()).trim()
              );
              const [latestNonce, pendingNonce] = await Promise.all([
                provider.getTransactionCount(walletAddress, 'latest'),
                provider.getTransactionCount(walletAddress, 'pending'),
              ]);
              const expectedNonce = Number(gasOp.nonce);
              if (
                Number.isSafeInteger(latestNonce) &&
                Number.isSafeInteger(pendingNonce) &&
                (latestNonce > expectedNonce || pendingNonce > expectedNonce)
              ) {
                await recordEvmGasFundingNonceIncident({
                  sweepId,
                  network: canonicalEvmNetwork,
                  walletAddress,
                  expectedNonce,
                  expectedTxHash: childHash,
                  observedLatestNonce: latestNonce,
                  observedPendingNonce: pendingNonce,
                  reason: 'Persisted gas-funding transaction and receipt are unavailable while the shared hot-wallet nonce has advanced.',
                });
                console.error(
                  `[Sweeper Recovery] EVM gas-funding nonce incident recorded for ${sweepId}; reservations remain locked for manual reconciliation.`
                );
              }
            }
          } catch (incidentError) {
            console.error(
              `[Sweeper Recovery] Could not record EVM gas-funding nonce incident for ${sweepId}; reservations remain locked:`,
              incidentError
            );
          }
        }

        // Missing, shallow, or reorged receipt remains locked. Do not create
        // another funding operation or proceed to the child sweep.
        return false;
      }

      const fundingReceipt = await provider.getTransactionReceipt(childHash);
      if (!fundingReceipt || !fundingReceipt.blockHash || !fundingReceipt.blockNumber) {
        return false;
      }

      // Persist actual gas used, effective price, execution status and block
      // identity before the parent can leave GAS_FUNDING. The receipt RPC
      // restores CONFIRMED only from RECOVERY_REQUIRED after fresh finality.
      await recordEvmGasFundingReceipt(sweepId, workerId, childHash, fundingReceipt);

      if (fundingFinality === 'REVERTED') {
        await transitionSweepStatus(
          sweepId,
          workerId,
          status,
          'RECOVERY_REQUIRED',
          {
            errorMessage: `Gas-funding transaction ${childHash} was mined and reverted after required finality. Actual fee and consumed nonce were recorded; operator action is required before another funding attempt.`,
          }
        );
        return false;
      }

      fundingConfirmed = true;
    }

    // Resume the normal sweep pipeline for GAS_FUNDING/GAS_FUNDED rows. This handles:
    // - a crash before creating a funding operation;
    // - PENDING operations with a reserved nonce but no signed bytes;
    // - pre-signing RECOVERY_REQUIRED operations with no broadcast identity;
    // - confirmed funding whose parent transition was interrupted.
    // The normal pipeline reuses the same allocated nonce/amount and always
    // persists a signed transaction before any broadcast.
    let derivationIndex: number | null =
      Number.isSafeInteger(sweep.derivation_index) && sweep.derivation_index > 0
        ? sweep.derivation_index
        : null;

    if (derivationIndex === null) {
      const { data: addressRecord, error: addressError } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('derivation_index')
        .ilike('address', String(sweep.deposit_address || ''))
        .maybeSingle();

      if (addressError) {
        throw new Error(`Could not resolve EVM recovery derivation index: ${addressError.message}`);
      }
      if (typeof addressRecord?.derivation_index === 'number') {
        derivationIndex = addressRecord.derivation_index;
      }
    }

    if (derivationIndex === null && sweep.deposit_id) {
      const { data: depositRecord, error: depositError } = await supabaseAdmin
        .from('onchain_deposits')
        .select('user_id')
        .eq('id', sweep.deposit_id)
        .maybeSingle();

      if (depositError) {
        throw new Error(`Could not resolve EVM recovery deposit owner: ${depositError.message}`);
      }

      if (depositRecord?.user_id) {
        const { data: profileRecord, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('wallet_index')
          .eq('id', depositRecord.user_id)
          .maybeSingle();

        if (profileError) {
          throw new Error(`Could not resolve EVM recovery wallet index: ${profileError.message}`);
        }
        if (typeof profileRecord?.wallet_index === 'number') {
          derivationIndex = profileRecord.wallet_index;
        }
      }
    }

    if (derivationIndex === null) {
      throw new Error('EVM GAS_FUNDING sweep has no resolvable derivation index; manual reconciliation required.');
    }

    const resumed = await sweepUserDepositAddress(
      String(sweep.deposit_address || ''),
      net as 'ERC20' | 'BEP20' | 'ETH',
      derivationIndex,
      String(sweep.asset_symbol || 'USDT'),
      sweepId,
      workerId
    );

    if (resumed.status === 'SUCCESS') return true;
    if (resumed.status === 'FAILED') {
      console.warn(`[Sweeper Recovery] EVM GAS_FUNDING retry for ${sweepId} remains unresolved: ${resumed.error || 'unknown worker failure'}`);
    }

    if (fundingConfirmed) {
      // A gas-funding transfer was already final, but the child sweep could
      // not safely proceed (for example, the funded address still lacks the
      // fee reserve). Stop automatic retries and require an operator decision.
      const { data: latestSweep, error: latestSweepError } = await supabaseAdmin
        .from('sweep_operations')
        .select('status')
        .eq('id', sweepId)
        .maybeSingle();

      if (latestSweepError) {
        throw new Error(`Could not inspect parent after confirmed gas funding: ${latestSweepError.message}`);
      }

      const latestStatus = String(latestSweep?.status || '');
      if (latestStatus === 'GAS_FUNDING' || latestStatus === 'GAS_FUNDED') {
        await transitionSweepStatus(
          sweepId,
          workerId,
          latestStatus,
          'RECOVERY_REQUIRED',
          {
            errorMessage: 'Gas funding is final but the child sweep did not safely complete. Operator review is required; the funding nonce and receipt remain recorded.',
          }
        );
      }
    }
    return false;
  }

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

    const expectedChainId = Number(sweep.signed_chain_id);
    const expectedSender = String(sweep.deposit_address || '').toLowerCase();
    const expectedRecipient = String(sweep.signed_recipient || '').toLowerCase();
    const expectedAsset = String(sweep.signed_asset_code || '').toUpperCase();
    const expectedTokenContract = sweep.signed_token_contract
      ? String(sweep.signed_token_contract).toLowerCase()
      : null;
    const expectedAmountRaw = sweep.signed_amount_raw === null || sweep.signed_amount_raw === undefined
      ? null
      : BigInt(String(sweep.signed_amount_raw));
    const actualSender = String(parsedTx.from || '').toLowerCase();
    const actualTo = String(parsedTx.to || '').toLowerCase();
    let transactionIdentityValid = false;

    try {
      // Old signed rows without the immutable intent fields fail closed. Do not
      // infer the asset or intended amount from the transaction being checked.
      if (
        (expectedChainId === 1 || expectedChainId === 56) &&
        expectedAmountRaw !== null && expectedAmountRaw > 0n &&
        ethers.isAddress(expectedSender) &&
        ethers.isAddress(expectedRecipient) &&
        parsedTx.chainId === BigInt(expectedChainId) &&
        actualSender === expectedSender &&
        actualTo.length > 0
      ) {
        if (expectedAsset === 'ETH') {
          transactionIdentityValid =
            expectedChainId === 1 &&
            expectedTokenContract === null &&
            actualTo === expectedRecipient &&
            parsedTx.data === '0x' &&
            parsedTx.value === expectedAmountRaw;
        } else if (expectedAsset === 'USDT' && expectedTokenContract) {
          const tokenConfig = getUsdtConfig(net);
          const canonicalContract = ethers.getAddress(tokenConfig.contractAddress);
          const storedContract = ethers.getAddress(expectedTokenContract);
          const transferInterface = new ethers.Interface([
            'function transfer(address to, uint256 amount) returns (bool)',
          ]);
          const decoded = transferInterface.decodeFunctionData('transfer', parsedTx.data);
          const decodedRecipient = ethers.getAddress(String(decoded[0]));
          const decodedAmount = BigInt(decoded[1]);

          transactionIdentityValid =
            BigInt(expectedChainId) === (net === 'BEP20' || net === 'BSC' ? 56n : 1n) &&
            storedContract === canonicalContract &&
            ethers.getAddress(actualTo) === storedContract &&
            parsedTx.value === 0n &&
            decodedRecipient === ethers.getAddress(expectedRecipient) &&
            decodedAmount === expectedAmountRaw;
        }
      }
    } catch {
      transactionIdentityValid = false;
    }

if (!transactionIdentityValid) {
    await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: 'Signed EVM recovery transaction identity mismatch (chain, sender, recipient, asset call or value). Manual reconciliation required.',
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
      await assertPreBroadcastOwnership(sweepId, workerId, 'READY_TO_BROADCAST');
      const txResponse = await provider.broadcastTransaction(signed_tx_hex);
      if (String(txResponse.hash || '').toLowerCase() !== String(sweep_tx_hash || '').toLowerCase()) {
        throw new Error('Recovery broadcast hash differs from the persisted signed transaction hash.');
      }
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

    // Verify the signed transaction against its separately persisted intent.
    // Legacy signed rows without this intent are never automatically rebroadcast.
    const utxoIntent = sweep.signed_utxo_intent;
    let utxoIntentValid = false;
    try {
      const txObj = bitcoin.Transaction.fromHex(signed_tx_hex);
      const intentInputs = Array.isArray(utxoIntent?.inputs) ? utxoIntent.inputs : [];
      const intentOutput = BigInt(String(utxoIntent?.output_amount_sat ?? '0'));
      const intentFee = BigInt(String(utxoIntent?.fee_amount_sat ?? '-1'));
      const expectedScript = String(utxoIntent?.destination_script_hex || '').toLowerCase();
      const expectedHotWalletAddress = net === 'BTC'
        ? requireBitcoinHotWalletAddress()
        : requireLitecoinHotWalletAddress();
      const expectedHotWalletScript = bitcoin.address.toOutputScript(
        expectedHotWalletAddress,
        net === 'BTC' ? bitcoin.networks.bitcoin : LTC_NETWORK as any
      ).toString('hex').toLowerCase();
      const actualInputs = txObj.ins.map((input) => ({
        txid: Buffer.from(input.hash).reverse().toString('hex').toLowerCase(),
        vout: input.index,
      }));
      const expectedInputs = intentInputs.map((input: any) => ({
        txid: String(input.txid || '').toLowerCase(),
        vout: Number(input.vout),
      }));
      const inputRecordsValid = intentInputs.every((input: any) => {
        const txid = String(input.txid || '');
        const voutText = String(input.vout ?? '');
        const valueText = String(input.value_sat ?? '');
        const vout = Number(voutText);
        return /^[0-9a-f]{64}$/i.test(txid) &&
          /^[0-9]{1,10}$/.test(voutText) &&
          Number.isSafeInteger(vout) && vout >= 0 && vout <= 0x7fffffff &&
          /^[1-9][0-9]{0,15}$/.test(valueText) &&
          BigInt(valueText) <= 8400000000000000n;
      });
      const uniqueExpectedOutpoints = new Set(
        expectedInputs.map((input: any) => `${input.txid}:${input.vout}`)
      ).size === intentInputs.length;
      const inputValues = intentInputs.map((input: any) => BigInt(String(input.value_sat)));
      const inputTotal = inputValues.reduce((sum: bigint, value: bigint) => sum + value, 0n);
      const actualOutput = txObj.outs.length === 1 ? txObj.outs[0] : null;
      const outpointsMatch = actualInputs.length === expectedInputs.length &&
        actualInputs.every((input, index) =>
          input.txid === expectedInputs[index].txid && input.vout === expectedInputs[index].vout
        );
      utxoIntentValid =
        intentInputs.length > 0 &&
        intentInputs.length <= 100 &&
        inputRecordsValid &&
        uniqueExpectedOutpoints &&
        inputValues.every((value: bigint) => value > 0n) &&
        outpointsMatch &&
        actualOutput !== null &&
        Buffer.from(actualOutput.script).toString('hex').toLowerCase() === expectedScript &&
        expectedScript === expectedHotWalletScript &&
        BigInt(actualOutput.value) === intentOutput &&
        intentOutput > 0n &&
        intentFee >= 0n &&
        inputTotal === intentOutput + intentFee;
    } catch {
      utxoIntentValid = false;
    }

    if (!utxoIntentValid) {
      await supabaseAdmin.rpc('update_sweep_operation_status', {
        p_sweep_id: sweepId,
        p_worker_id: workerId,
        p_expected_status: 'READY_TO_BROADCAST',
        p_new_status: 'RECOVERY_REQUIRED',
        p_error_message: 'Signed BTC/LTC transaction does not match its immutable UTXO intent. Automatic rebroadcast blocked.',
      });
      return false;
    }

    // Broadcast stored bytes only after revalidating the current lease.
    try {
      await assertPreBroadcastOwnership(sweepId, workerId, 'READY_TO_BROADCAST');
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
      let utxoFinalityProof: Awaited<ReturnType<typeof isUtxoSweepCanonicallyConfirmed>> = null;

      if (net === 'ERC20' || net === 'BEP20' || net === 'ETH' || net === 'BSC' || net === 'ETHEREUM' || net === 'BINANCE') {
        const rpcUrl = getRpcUrlForNetwork(net);
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const finality = await getEvmSweepReceiptFinality(provider, sweep_tx_hash, net);
        if (finality === 'CONFIRMED') {
          isConfirmed = true;
        } else if (finality === 'REVERTED') {
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
      } else if (net === 'BTC' || net === 'LTC') {
        utxoFinalityProof = await isUtxoSweepCanonicallyConfirmed(net, sweep_tx_hash);
        isConfirmed = utxoFinalityProof !== null;
      }

      const isTronSweep = net === 'TRC20' || net === 'TRON';

      if (isConfirmed) {
        if ((net === 'BTC' || net === 'LTC') && utxoFinalityProof) {
          const { data: finalityProofResult, error: finalityProofError } = await supabaseAdmin.rpc(
            'record_utxo_sweep_finality_proof',
            {
              p_sweep_id: sweepId,
              p_worker_id: workerId,
              p_tx_hash: utxoFinalityProof.txid,
              p_block_hash: utxoFinalityProof.blockHash,
              p_block_height: utxoFinalityProof.blockHeight,
              p_primary_tip_height: utxoFinalityProof.primaryTipHeight,
              p_secondary_tip_height: utxoFinalityProof.secondaryTipHeight,
              p_primary_source: utxoFinalityProof.primarySource,
              p_secondary_source: utxoFinalityProof.secondarySource,
            }
          );

          if (finalityProofError || finalityProofResult?.success !== true) {
            throw new Error(
              `Could not persist BTC/LTC finality proof: ${finalityProofError?.message || finalityProofResult?.code || 'unknown database response'}`
            );
          }
        }

        // READY_TO_BROADCAST can be confirmed on-chain even if the worker died
        // before recording BROADCASTED. Reconcile the state machine first.
        if (recoveryStatus === 'READY_TO_BROADCAST') {
          await transitionSweepStatus(sweepId, workerId, 'READY_TO_BROADCAST', 'BROADCASTED', sweep_tx_hash);
          recoveryStatus = 'BROADCASTED';
        }

        // Resource reclamation must finish while the parent sweep is still in a
        // post-broadcast state accepted by the TRON undelegation RPCs.
        if (isTronSweep) {
          let resourcesReclaimed = false;
          try {
            resourcesReclaimed = await undelegateEnergyToPool(sweepId, workerId);
          } catch (unErr) {
            console.error('[Tron Resource Pool] Failed to reclaim resources on confirmed reconciliation:', unErr);
          }

          if (!resourcesReclaimed) {
            if (recoveryStatus !== 'RECOVERY_REQUIRED') {
              await transitionSweepStatus(
                sweepId,
                workerId,
                recoveryStatus,
                'RECOVERY_REQUIRED',
                {
                  txHash: sweep_tx_hash,
                  errorMessage: 'Sweep transfer is confirmed but TRON Energy reclamation is not yet verified',
                }
              );
              recoveryStatus = 'RECOVERY_REQUIRED';
            }
            return false;
          }
        }

        await transitionSweepStatus(
          sweepId,
          workerId,
          recoveryStatus,
          'CONFIRMED',
          { txHash: sweep_tx_hash, amountSwept: Number(amount_swept || 0) }
        );
        return true;
      }

      if (isFailed) {
        // Do not finalize a TRON sweep as FAILED while delegated Energy remains
        // attached to the child address. Recovery needs the live post-broadcast
        // parent state to persist/confirm an undelegation transaction.
        if (isTronSweep) {
          let resourcesReclaimed = false;
          try {
            resourcesReclaimed = await undelegateEnergyToPool(sweepId, workerId);
          } catch (unErr) {
            console.error('[Tron Resource Pool] Failed to reclaim resources on failed reconciliation:', unErr);
          }

          if (!resourcesReclaimed) {
            if (recoveryStatus !== 'RECOVERY_REQUIRED') {
              await transitionSweepStatus(
                sweepId,
                workerId,
                recoveryStatus,
                'RECOVERY_REQUIRED',
                {
                  txHash: sweep_tx_hash,
                  errorMessage: 'Sweep transfer failed and TRON Energy reclamation is not yet verified',
                }
              );
              recoveryStatus = 'RECOVERY_REQUIRED';
            }
            return false;
          }
        }

        await transitionSweepStatus(
          sweepId,
          workerId,
          recoveryStatus,
          'FAILED',
          { txHash: sweep_tx_hash, errorMessage: 'On-chain transaction execution failed' }
        );
        return false;
      }

      // A signed UTXO transaction may be abandoned only when every input is
      // demonstrably spent by a different confirmed transaction in two independent
      // explorer views. A missing transaction or one "unspent" response never releases it.
      if (
        !isConfirmed &&
        !isFailed &&
        (net === 'BTC' || net === 'LTC') &&
        sweep_tx_hash &&
        sweep.signed_utxo_intent
      ) {
        // Keep the current recovery claim lease while the proof is gathered and
        // persisted. Moving into RECOVERY_REQUIRED first clears the legacy status
        // RPC lease and would make the proof RPC reject this worker.
        const conflictProofs = await collectConfirmedUtxoConflictProofs(
          net,
          sweep_tx_hash,
          sweep.signed_utxo_intent
        );

        if (conflictProofs) {
          const { data: proofResult, error: proofError } = await supabaseAdmin.rpc(
            'record_utxo_sweep_conflict_proofs',
            {
              p_sweep_id: sweepId,
              p_worker_id: workerId,
              p_proofs: conflictProofs,
            }
          );

          if (proofError || proofResult?.success !== true) {
            throw new Error(
              `Could not persist complete UTXO conflict proof: ${proofError?.message || proofResult?.message || proofResult?.code || 'unknown database response'}`
            );
          }

          await transitionSweepStatus(
            sweepId,
            workerId,
            recoveryStatus,
            'FAILED',
            {
              txHash: sweep_tx_hash,
              errorMessage: `Every signed ${net} input was independently verified spent by a different transaction with the required confirmation depth. Signed transaction can no longer be mined; reservations released.`,
            }
          );
          return true;
        }

        if (recoveryStatus !== 'RECOVERY_REQUIRED') {
          await transitionSweepStatus(
            sweepId,
            workerId,
            recoveryStatus,
            'RECOVERY_REQUIRED',
            {
              txHash: sweep_tx_hash,
              errorMessage: `Unconfirmed transaction ${sweep_tx_hash} has no independently confirmed full-input conflict proof; UTXO reservations remain locked.`,
            }
          );
          recoveryStatus = 'RECOVERY_REQUIRED';
        }
      }

      // If unconfirmed / pending, ensure record remains safely locked in RECOVERY_REQUIRED.
      if (recoveryStatus !== 'RECOVERY_REQUIRED') {
        await transitionSweepStatus(
          sweepId,
          workerId,
          recoveryStatus,
          'RECOVERY_REQUIRED',
          {
            txHash: sweep_tx_hash,
            errorMessage: `Unconfirmed transaction ${sweep_tx_hash} moved to RECOVERY_REQUIRED`,
          }
        );
        recoveryStatus = 'RECOVERY_REQUIRED';
      }
    } catch (err: any) {
      console.error(`[Reconcile Sweep Exception] ${sweepId}:`, err);
      if (recoveryStatus !== 'RECOVERY_REQUIRED') {
        try {
          await transitionSweepStatus(
            sweepId,
            workerId,
            recoveryStatus,
            'RECOVERY_REQUIRED',
            {
              txHash: sweep_tx_hash,
              errorMessage: err?.message || 'Reconciliation query exception',
            }
          );
          recoveryStatus = 'RECOVERY_REQUIRED';
        } catch (transitionErr) {
          console.error(`[Reconcile Sweep Exception] Failed to persist RECOVERY_REQUIRED for ${sweepId}:`, transitionErr);
        }
      }
    }
  }

  return false;
}

/**
 * Scans DB for confirmed deposits and sweeps using atomic worker claims.
 */
export async function runAutomatedSweeperJob(): Promise<SweepResult[]> {
  const workerId = randomUUID();
  const results: SweepResult[] = [];

  // Reconcile persisted/ambiguous transactions before starting any new sweep.
  // If the reconciliation RPC is unavailable, stop this job rather than
  // initiating fresh transfers while older broadcasts remain unresolved.
  let reconciliationCount = 0;
  while (reconciliationCount < 20) {
    const { data: recoveryClaims, error: recoveryClaimErr } = await supabaseAdmin.rpc(
      'claim_next_sweep_reconciliation',
      {
        p_worker_id: workerId,
        p_lease_duration_seconds: 300,
      }
    );

    if (recoveryClaimErr) {
      console.error('[Sweeper Job] Recovery claim failed; refusing to start new sweeps:', recoveryClaimErr);
      return results;
    }

    if (!recoveryClaims || recoveryClaims.length === 0) break;

    const recoverySweepId = String(recoveryClaims[0]?.id || recoveryClaims[0]?.sweep_id || '');
    if (!recoverySweepId) {
      console.error('[Sweeper Job] Recovery claim returned no sweep ID; refusing to start new sweeps.');
      return results;
    }

    const stopRecoveryHeartbeat = startSweeperHeartbeat(recoverySweepId, workerId);
    try {
      const reconciled = await reconcileAmbiguousSweep(recoverySweepId, workerId);
      console.info(
        `[Sweeper Job] Recovery reconciliation for ${recoverySweepId}: ${reconciled ? 'resolved or rebroadcast' : 'still requires reconciliation'}.`
      );
    } catch (recoveryErr) {
      console.error(`[Sweeper Job] Failed to reconcile sweep ${recoverySweepId}:`, recoveryErr);
    } finally {
      stopRecoveryHeartbeat();
    }

    reconciliationCount++;
  }

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
      if (['TRC20', 'TRON', 'BTC', 'LTC', 'ERC20', 'BEP20', 'ETH', 'BSC', 'ETHEREUM', 'BINANCE'].includes(netCode)) {
        console.log(
          `[Sweeper Job] ${netCode} sweep ${sweepId} broadcasted (tx: ${result.txHash}). Leaving in BROADCASTED state until chain confirmation is independently reconciled.`
        );
      } else {
        await transitionSweepStatus(sweepId, workerId, 'BROADCASTED', 'CONFIRMED', {
          txHash: result.txHash,
          amountSwept: parseFloat(result.amountSwept || '0'),
        });
      }
    } else if (result.status === 'FAILED') {
      // BTC/LTC failures are terminal only before signed transaction identity is
      // persisted. Once bytes or a deterministic hash exist, preserve recovery.
      const netCode = String(network || '').toUpperCase().trim();
      let preserveUtxoRecovery = false;

      if (netCode === 'BTC' || netCode === 'LTC') {
        const { data: currentSweep, error: currentSweepError } = await supabaseAdmin
          .from('sweep_operations')
          .select('status, signed_tx_hex, sweep_tx_hash')
          .eq('id', sweepId)
          .maybeSingle();

        if (currentSweepError || !currentSweep) {
          // A read failure must never authorize a terminal transition.
          preserveUtxoRecovery = true;
          console.error(
            `[Sweeper Worker ${workerId}] Could not verify BTC/LTC signed state for ${sweepId}; leaving it non-terminal: ${currentSweepError?.message || 'sweep row unavailable'}`
          );
        } else if (currentSweep.signed_tx_hex || currentSweep.sweep_tx_hash) {
          preserveUtxoRecovery = true;
          if (currentSweep.status !== 'RECOVERY_REQUIRED') {
            try {
              await transitionSweepStatus(
                sweepId,
                workerId,
                currentSweep.status,
                'RECOVERY_REQUIRED',
                {
                  txHash: currentSweep.sweep_tx_hash || undefined,
                  errorMessage: result.error || 'BTC/LTC worker failed after signed transaction identity was persisted; reconciliation required',
                }
              );
            } catch (recoveryTransitionError: any) {
              console.error(
                `[Sweeper Worker ${workerId}] Could not move signed BTC/LTC sweep ${sweepId} into recovery: ${recoveryTransitionError?.message || recoveryTransitionError}`
              );
            }
          }
        }
      }

      // EVM nonce allocation must not be abandoned; signed UTXO transactions
      // must never be treated as unsent. Both cases remain recoverable.
      if (!preserveUtxoRecovery && !result.nonceAllocated) {
        try {
          const { data: failResult, error: failError } = await supabaseAdmin.rpc('update_sweep_operation_status', {
            p_sweep_id: sweepId,
            p_worker_id: workerId,
            p_expected_status: 'CLAIMED',
            p_new_status: 'FAILED',
            p_error_message: result.error || 'Sweep failed',
          });
          if (failError || !failResult?.success) {
            console.warn(
              `[Sweeper Worker ${workerId}] FAILED transition rejected for ${sweepId}: ${failError?.message || failResult?.code || 'unknown response'}`
            );
          }
        } catch (failureTransitionError: any) {
          console.warn(
            `[Sweeper Worker ${workerId}] FAILED transition errored for ${sweepId}: ${failureTransitionError?.message || failureTransitionError}`
          );
        }
      } else {
        console.warn(
          `[Sweeper Worker ${workerId}] Preserving sweep ${sweepId} for recovery; persisted signed UTXO identity or allocated nonce prevents automatic failure.`
        );
      }
    }

    results.push(result);
  }

  return results;
}

export const runDepositSweeper = runAutomatedSweeperJob;
