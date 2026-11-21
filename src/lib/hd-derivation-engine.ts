import crypto from 'crypto';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { requireDepositMnemonic, validateWalletDerivationIndex } from '@/lib/crypto/mnemonic-validation';
import {
  deriveAllDepositAddressesFromXpubs,
  type DepositAccountXpubs,
} from '@/lib/crypto/hd-derivation';
export { isValidDepositMnemonic, validateWalletDerivationIndex } from '@/lib/crypto/mnemonic-validation';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { networks } from 'bitcoinjs-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from '@/lib/supabase/service-role';

// ============================================================================
// Network Definitions (Mainnet)
// ============================================================================

export const BTC_NETWORK = networks.bitcoin; // NOT networks.testnet
export const LTC_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc', // Mainnet prefix: ltc1q (Testnet uses tltc)
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wsdl: 0x80,
};

// ============================================================================
// Types & Derivation Paths
// Database enum chain_network: 'ethereum' | 'arbitrum' | 'base' | 'polygon' | 'bitcoin' | 'ERC20' | 'BEP20' | 'TRC20'
// ============================================================================

export type ChainNetwork =
  | 'ETH'
  | 'BTC'
  | 'LTC'
  | 'ERC20'
  | 'BEP20'
  | 'TRC20'
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'polygon'
  | 'bitcoin';

export type SupportedAssetSymbol = 'BTC' | 'ETH' | 'LTC' | 'USDT';
export type SupportedChain = 'ETH' | 'BTC' | 'LTC' | 'ERC20' | 'BEP20' | 'TRC20' | 'ethereum' | 'bitcoin';
export type SupportedNetwork = 'BTC' | 'LTC' | 'ETH' | 'ERC20' | 'BEP20' | 'TRC20' | 'ethereum' | 'bitcoin';

export function normalizeDepositNetwork(network: string): string {
  const norm = (network || '').toUpperCase().trim();
  switch (norm) {
    case 'BTC':
    case 'BITCOIN':
      return 'BTC';
    case 'LTC':
    case 'LITECOIN':
      return 'LTC';
    case 'ETH':
    case 'ETHEREUM':
    case 'MAINNET':
      return 'ETH';
    case 'ERC20':
    case 'USDT_ERC20':
      return 'ERC20';
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
    case 'USDT_BEP20':
      return 'BEP20';
    case 'TRC20':
    case 'TRON':
    case 'USDT_TRC20':
      return 'TRC20';
    default:
      return norm;
  }
}

export interface CryptoDepositAddresses {
  BTC: string;
  ETH: string;
  LTC: string;
  USDT_ERC20: string;
  USDT_BEP20: string;
  USDT_TRC20: string;
}

export interface UserDepositAddressesRecord {
  user_id: string;
  asset_symbol: SupportedAssetSymbol;
  chain: SupportedChain;
  network: SupportedNetwork;
  asset_code: string;
  network_code: string;
  address: string;
  derivation_path: string;
}

export interface UserProfileRecord {
  id: string;
  username?: string;
  display_name?: string;
  wallet_index?: number;
  evm_deposit_address?: string | null;
  tron_deposit_address?: string | null;
  btc_deposit_address?: string | null;
  ltc_deposit_address?: string | null;
  [key: string]: any;
}

export interface UserDepositAddressesResult {
  userId: string;
  walletIndex: number;
  addresses: CryptoDepositAddresses;
  records: UserDepositAddressesRecord[];
  profile?: UserProfileRecord | null;
  metadata: {
    btcDerivationPath: string;
    ethDerivationPath: string;
    ltcDerivationPath: string;
    tronDerivationPath: string;
    evmAddressReusedFor: string[];
    allowedChainNetworks: string[];
    derivedAt: string;
  };
}

export function getChainEnum(network: string): SupportedChain {
  const norm = normalizeDepositNetwork(network);
  switch (norm) {
    case 'TRC20':
      return 'TRC20';
    case 'BTC':
      return 'BTC';
    case 'LTC':
      return 'LTC';
    case 'BEP20':
      return 'BEP20';
    case 'ERC20':
      return 'ERC20';
    case 'ETH':
    default:
      return 'ETH';
  }
}

export function buildDepositAddressRow(
  userId: string,
  assetSymbol: SupportedAssetSymbol,
  network: SupportedNetwork,
  address: string,
  derivationPath: string
): UserDepositAddressesRecord {
  const normNet = normalizeDepositNetwork(network) as SupportedNetwork;
  return {
    user_id: userId,
    asset_symbol: assetSymbol,
    chain: getChainEnum(normNet),
    network: normNet,
    asset_code: assetSymbol,
    network_code: normNet,
    address: address,
    derivation_path: derivationPath,
  };
}

export const BIP_PATHS = {
  BTC: "m/84'/0'/0'/0",     // Native SegWit Mainnet (BIP84)
  ETH: "m/44'/60'/0'/0",     // EVM (ETH, USDT ERC-20, USDT BEP-20)
  LTC: "m/84'/2'/0'/0",      // Native SegWit Litecoin (BIP84)
  TRON: "m/44'/195'/0'/0",   // TRON / USDT TRC-20 (BIP44)
};

// ============================================================================
// Supabase Admin Client
// ============================================================================

export function getAdminClient(): SupabaseClient {
  return getSupabaseServiceClient();
}

// ============================================================================
// HD Derivation Core (Cached for Non-blocking High Throughput)
// ============================================================================

let cachedMasterHDKey: HDKey | null = null;

/**
 * Public xpub mode is opt-in and remains disabled by default. Enable only after
 * all four account xpubs are verified against existing customer address records
 * at multiple known wallet indices. The xpub mode never reads the master mnemonic.
 */
function isPublicXpubDerivationEnabled(): boolean {
  return process.env.PUBLIC_XPUB_DERIVATION_ENABLED === 'true';
}

function getConfiguredDepositAccountXpubs(): DepositAccountXpubs {
  return {
    evm: process.env.EVM_XPUB?.trim() || '',
    btc: process.env.BTC_XPUB?.trim() || '',
    tron: process.env.TRON_XPUB?.trim() || '',
    ltc: process.env.LTC_XPUB?.trim() || '',
  };
}

/**
 * Derives master HDKey root from a checksum-validated DEPOSIT_HD_MNEMONIC.
 * The mnemonic path is unavailable when public-only derivation mode is enabled.
 */
export async function getMasterHDKey(): Promise<HDKey> {
  if (isPublicXpubDerivationEnabled()) {
    throw new Error('Master mnemonic derivation is disabled while PUBLIC_XPUB_DERIVATION_ENABLED is true');
  }
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = requireDepositMnemonic();
  const seed: Uint8Array = await bip39.mnemonicToSeed(mnemonic);
  try {
    cachedMasterHDKey = HDKey.fromMasterSeed(seed);
    return cachedMasterHDKey;
  } finally {
    // HDKey derives and retains its own key material; clear the temporary BIP-39 seed buffer.
    seed.fill(0);
  }
}

/**
 * Synchronous variant for master HDKey derivation with memory caching.
 */
export function getMasterHDKeySync(): HDKey {
  if (isPublicXpubDerivationEnabled()) {
    throw new Error('Master mnemonic derivation is disabled while PUBLIC_XPUB_DERIVATION_ENABLED is true');
  }
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = requireDepositMnemonic();
  const seed: Uint8Array = bip39.mnemonicToSeedSync(mnemonic);
  try {
    cachedMasterHDKey = HDKey.fromMasterSeed(seed);
    return cachedMasterHDKey;
  } finally {
    seed.fill(0);
  }
}

/**
 * Derives Bitcoin Native SegWit address (BIP84: m/84'/0'/0'/0/i -> bc1q... for Mainnet).
 */
export function deriveBitcoinNativeSegwitAddress(
  masterKey: HDKey,
  index: number
): string {
  validateWalletDerivationIndex(index);
  const child = masterKey.derive(`${BIP_PATHS.BTC}/${index}`);
  if (!child.publicKey) throw new Error('No public key generated for BTC child');

  const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
  const words = bech32.toWords(hash160);
  words.unshift(0x00);
  return bech32.encode(BTC_NETWORK.bech32, words);
}

/**
 * Derives EVM address (BIP44: m/44'/60'/0'/0/i -> 0x...).
 * Reused for ETH, USDT ERC-20, and USDT BEP-20.
 */
export function deriveEvmAddress(masterKey: HDKey, index: number): string {
  validateWalletDerivationIndex(index);
  const child = masterKey.derive(`${BIP_PATHS.ETH}/${index}`);
  if (!child.publicKey) throw new Error('No public key generated for EVM child');

  const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
  const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  const addressHash = ethers.keccak256(pubBytes);
  return ethers.getAddress(`0x${addressHash.slice(-40)}`);
}

/**
 * Derives Litecoin Native SegWit address (BIP84: m/84'/2'/0'/0/i -> ltc1q...).
 */
export function deriveLitecoinNativeSegwitAddress(masterKey: HDKey, index: number): string {
  validateWalletDerivationIndex(index);
  const child = masterKey.derive(`${BIP_PATHS.LTC}/${index}`);
  if (!child.publicKey) throw new Error('No public key generated for LTC child');

  const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
  const words = bech32.toWords(hash160);
  words.unshift(0x00);
  return bech32.encode(LTC_NETWORK.bech32, words);
}

/**
 * Derives TRON address (BIP44: m/44'/195'/0'/0/i -> Base58 T...).
 * Used for TRX and USDT TRC-20.
 */
export function deriveTronAddress(masterKey: HDKey, index: number): string {
  validateWalletDerivationIndex(index);
  const child = masterKey.derive(`${BIP_PATHS.TRON}/${index}`);
  if (!child.publicKey) throw new Error('No public key generated for TRON child');

  const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
  const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  const addressHash = ethers.keccak256(pubBytes);
  const tronRawAddress = Buffer.concat([
    Buffer.from([0x41]),
    Buffer.from(addressHash.slice(-40), 'hex'),
  ]);

  const hash1 = crypto.createHash('sha256').update(tronRawAddress).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return bs58.encode(Buffer.concat([tronRawAddress, hash2.subarray(0, 4)]));
}

/**
 * Derives all 6 crypto deposit addresses for a specific integer index.
 */
export async function deriveAllAddressesAsync(walletIndex: number): Promise<CryptoDepositAddresses> {
  validateWalletDerivationIndex(walletIndex);

  if (isPublicXpubDerivationEnabled()) {
    return deriveAllDepositAddressesFromXpubs(
      getConfiguredDepositAccountXpubs(),
      walletIndex,
    );
  }

  const masterKey = await getMasterHDKey();
  const btc = deriveBitcoinNativeSegwitAddress(masterKey, walletIndex);
  const evm = deriveEvmAddress(masterKey, walletIndex);
  const ltc = deriveLitecoinNativeSegwitAddress(masterKey, walletIndex);
  const tron = deriveTronAddress(masterKey, walletIndex);

  return {
    BTC: btc,
    ETH: evm,
    LTC: ltc,
    USDT_ERC20: evm,
    USDT_BEP20: evm,
    USDT_TRC20: tron,
  };
}

/**
 * Synchronous address derivation helper.
 */
export function deriveAllAddresses(walletIndex: number): CryptoDepositAddresses {
  validateWalletDerivationIndex(walletIndex);

  if (isPublicXpubDerivationEnabled()) {
    return deriveAllDepositAddressesFromXpubs(
      getConfiguredDepositAccountXpubs(),
      walletIndex,
    );
  }

  const masterKey = getMasterHDKeySync();
  const btc = deriveBitcoinNativeSegwitAddress(masterKey, walletIndex);
  const evm = deriveEvmAddress(masterKey, walletIndex);
  const ltc = deriveLitecoinNativeSegwitAddress(masterKey, walletIndex);
  const tron = deriveTronAddress(masterKey, walletIndex);

  return {
    BTC: btc,
    ETH: evm,
    LTC: ltc,
    USDT_ERC20: evm,
    USDT_BEP20: evm,
    USDT_TRC20: tron,
  };
}

// ============================================================================
// Supabase Sync & Persistence Engine
// ============================================================================

/**
 * Derives the six logical deposit asset/network addresses from the profile's
 * already-assigned wallet_index and sends them to the atomic database RPC.
 *
 * The current production registry intentionally stores:
 * - four chain wallet rows (EVM, TRON, BTC, LTC) in public.wallets;
 * - three canonical public-address rows (BTC, EVM/ETH, TRC20) in
 *   public.user_deposit_addresses;
 * - four compatibility rows (BTC, ETH/EVM, LTC, USDT/TRC20) in
 *   public.deposit_addresses.
 *
 * ERC20/BEP20 share the EVM address and are resolved by the deposit-credit
 * RPC through the EVM wallet row. LTC is resolved through the LTC wallet row.
 * The six records returned below describe logical asset/network choices; they
 * are not six physical rows in user_deposit_addresses.
 */
export async function getOrDeriveUserDepositAddresses(
  userId: string
): Promise<UserDepositAddressesResult> {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    throw new Error('A verified UUID user identity is required for wallet provisioning.');
  }

  const normalizedUserId = userId.trim();
  const supabase = getAdminClient();

  // 1. Fetch user profile
  const { data: profileData, error: profileErr } = await supabase
    .from('profiles')
    .select('id, username, display_name, wallet_index')
    .eq('id', normalizedUserId)
    .maybeSingle();

  if (profileErr || !profileData) {
    throw new Error('User profile could not be verified for wallet provisioning.');
  }

  const profile: UserProfileRecord = profileData;

  // 2. Resolve wallet_index (Fail-closed if missing or invalid)
  const walletIndex = profile.wallet_index;
  if (
    typeof walletIndex !== 'number' ||
    !Number.isSafeInteger(walletIndex) ||
    walletIndex <= 0 ||
    walletIndex > 0x7fffffff
  ) {
    throw new Error('Wallet provisioning is blocked because the profile has no valid allocated derivation index.');
  }

  // 3. Derive authoritative addresses for this walletIndex
  const addresses = await deriveAllAddressesAsync(walletIndex);

  // 4. Execute canonical atomic provisioning via database RPC
  const { data: rpcResult, error: rpcError } = await supabase.rpc('provision_user_wallets_atomic', {
    p_user_id: normalizedUserId,
    p_wallet_index: walletIndex,
    p_evm_address: addresses.ETH,
    p_tron_address: addresses.USDT_TRC20,
    p_btc_address: addresses.BTC,
    p_ltc_address: addresses.LTC,
  });

  if (rpcError) {
    console.error('[HD_PROVISIONING] Atomic address provisioning RPC failed:', rpcError.code || 'UNKNOWN');
    throw new Error('Atomic wallet provisioning could not be confirmed.');
  }

  const committed = rpcResult && typeof rpcResult === 'object' && !Array.isArray(rpcResult)
    ? rpcResult as Record<string, unknown>
    : null;
  const committedAddresses = committed?.addresses && typeof committed.addresses === 'object' && !Array.isArray(committed.addresses)
    ? committed.addresses as Record<string, unknown>
    : null;

  if (
    !committed ||
    committed.success !== true ||
    String(committed.user_id || '').toLowerCase() !== normalizedUserId.toLowerCase() ||
    Number(committed.wallet_index) !== walletIndex ||
    committedAddresses?.evm !== addresses.ETH ||
    committedAddresses?.tron !== addresses.USDT_TRC20 ||
    committedAddresses?.btc !== addresses.BTC ||
    committedAddresses?.ltc !== addresses.LTC
  ) {
    console.error('[HD_PROVISIONING] Atomic RPC returned a mismatched commit result.');
    throw new Error('Atomic wallet provisioning returned an unverified result.');
  }

  // 5. Build raw asset records for caller response
  const rawAssets: Array<{
    symbol: SupportedAssetSymbol;
    network: SupportedNetwork;
    address: string;
    path: string;
  }> = [
    {
      symbol: 'BTC',
      network: 'BTC',
      address: addresses.BTC,
      path: `${BIP_PATHS.BTC}/${walletIndex}`,
    },
    {
      symbol: 'ETH',
      network: 'ETH',
      address: addresses.ETH,
      path: `${BIP_PATHS.ETH}/${walletIndex}`,
    },
    {
      symbol: 'LTC',
      network: 'LTC',
      address: addresses.LTC,
      path: `${BIP_PATHS.LTC}/${walletIndex}`,
    },
    {
      symbol: 'USDT',
      network: 'ERC20',
      address: addresses.USDT_ERC20,
      path: `${BIP_PATHS.ETH}/${walletIndex}`,
    },
    {
      symbol: 'USDT',
      network: 'BEP20',
      address: addresses.USDT_BEP20,
      path: `${BIP_PATHS.ETH}/${walletIndex}`,
    },
    {
      symbol: 'USDT',
      network: 'TRC20',
      address: addresses.USDT_TRC20,
      path: `${BIP_PATHS.TRON}/${walletIndex}`,
    },
  ];

  const records: UserDepositAddressesRecord[] = rawAssets.map((asset) => ({
    user_id: normalizedUserId,
    asset_symbol: asset.symbol,
    chain: getChainEnum(asset.network),
    network: asset.network,
    asset_code: asset.symbol,
    network_code: asset.network,
    address: asset.address,
    derivation_path: asset.path,
  }));

  return {
    userId: normalizedUserId,
    walletIndex,
    addresses,
    records,
    profile,
    metadata: {
      btcDerivationPath: `${BIP_PATHS.BTC}/${walletIndex}`,
      ethDerivationPath: `${BIP_PATHS.ETH}/${walletIndex}`,
      ltcDerivationPath: `${BIP_PATHS.LTC}/${walletIndex}`,
      tronDerivationPath: `${BIP_PATHS.TRON}/${walletIndex}`,
      evmAddressReusedFor: ['ETH', 'USDT_ERC20', 'USDT_BEP20'],
      allowedChainNetworks: ['BTC', 'LTC', 'ETH', 'ERC20', 'BEP20', 'TRC20'],
      derivedAt: new Date().toISOString(),
    },
  };
}
