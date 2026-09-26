import crypto from 'crypto';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { networks } from 'bitcoinjs-lib';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
  BTC_TESTNET4: "m/84'/1'/0'/0", // Native SegWit Testnet4 (BIP84)
  ETH: "m/44'/60'/0'/0",     // EVM (ETH, USDT ERC-20, USDT BEP-20)
  LTC: "m/84'/2'/0'/0",      // Native SegWit Litecoin (BIP84)
  TRON: "m/44'/195'/0'/0",   // TRON / USDT TRC-20 (BIP44)
};

// ============================================================================
// Supabase Admin Client
// ============================================================================

export function getAdminClient(): SupabaseClient {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://eaiwgfxoiwxepinvcykg.supabase.co';

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'placeholder-key';

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ============================================================================
// HD Derivation Core (Cached for Non-blocking High Throughput)
// ============================================================================

let cachedMasterHDKey: HDKey | null = null;

/**
 * Derives master HDKey root from DEPOSIT_HD_MNEMONIC using @scure/bip39 and @scure/bip32.
 */
export async function getMasterHDKey(): Promise<HDKey> {
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error('DEPOSIT_HD_MNEMONIC environment variable is not configured');
  }

  const seed: Uint8Array = await bip39.mnemonicToSeed(mnemonic.trim());
  cachedMasterHDKey = HDKey.fromMasterSeed(seed);
  return cachedMasterHDKey;
}

/**
 * Synchronous variant for master HDKey derivation with memory caching.
 */
export function getMasterHDKeySync(): HDKey {
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error('DEPOSIT_HD_MNEMONIC environment variable is not configured');
  }

  const seed: Uint8Array = bip39.mnemonicToSeedSync(mnemonic.trim());
  cachedMasterHDKey = HDKey.fromMasterSeed(seed);
  return cachedMasterHDKey;
}

/**
 * Derives Bitcoin Native SegWit address (BIP84: m/84'/0'/0'/0/i -> bc1q... for Mainnet, m/84'/1'/0'/0/i -> tb1q... for Testnet4).
 */
export function deriveBitcoinNativeSegwitAddress(
  masterKey: HDKey,
  index: number,
  networkType: 'mainnet' | 'testnet4' = 'mainnet'
): string {
  const isTestnet = networkType === 'testnet4';
  const basePath = isTestnet ? BIP_PATHS.BTC_TESTNET4 : BIP_PATHS.BTC;
  const bech32Prefix = isTestnet ? networks.testnet.bech32 : BTC_NETWORK.bech32;

  try {
    const child = masterKey.derive(`${basePath}/${index}`);
    if (!child.publicKey) throw new Error(`No public key generated for BTC child at ${basePath}/${index}`);

    const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
    const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    return bech32.encode(bech32Prefix, words);
  } catch (err) {
    if (!isTestnet) {
      const btcXpub = process.env.BTC_XPUB;
      if (btcXpub) {
        const hdkey = HDKey.fromExtendedKey(btcXpub);
        const child = hdkey.deriveChild(0).deriveChild(index);
        const sha256 = crypto.createHash('sha256').update(child.publicKey!).digest();
        const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
        const words = bech32.toWords(hash160);
        words.unshift(0x00);
        return bech32.encode(BTC_NETWORK.bech32, words);
      }
    }
    throw err;
  }
}

/**
 * Derives EVM address (BIP44: m/44'/60'/0'/0/i -> 0x...).
 * Reused for ETH, USDT ERC-20, and USDT BEP-20.
 */
export function deriveEvmAddress(masterKey: HDKey, index: number): string {
  try {
    const child = masterKey.derive(`${BIP_PATHS.ETH}/${index}`);
    if (!child.publicKey) throw new Error('No public key generated for EVM child');

    const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
    const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
    const addressHash = ethers.keccak256(pubBytes);
    return ethers.getAddress(`0x${addressHash.slice(-40)}`);
  } catch (err) {
    const evmXpub = process.env.EVM_XPUB;
    if (evmXpub) {
      const hdkey = HDKey.fromExtendedKey(evmXpub);
      const child = hdkey.deriveChild(0).deriveChild(index);
      const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey!, false);
      const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
      const addressHash = ethers.keccak256(pubBytes);
      return ethers.getAddress(`0x${addressHash.slice(-40)}`);
    }
    throw err;
  }
}

/**
 * Derives Litecoin Native SegWit address (BIP84: m/84'/2'/0'/0/i -> ltc1q...).
 */
export function deriveLitecoinNativeSegwitAddress(masterKey: HDKey, index: number): string {
  try {
    const child = masterKey.derive(`${BIP_PATHS.LTC}/${index}`);
    if (!child.publicKey) throw new Error('No public key generated for LTC child');

    const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
    const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    return bech32.encode(LTC_NETWORK.bech32, words);
  } catch (err) {
    const ltcXpub = process.env.LTC_XPUB;
    if (ltcXpub) {
      const hdkey = HDKey.fromExtendedKey(ltcXpub);
      const child = hdkey.deriveChild(0).deriveChild(index);
      const sha256 = crypto.createHash('sha256').update(child.publicKey!).digest();
      const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
      const words = bech32.toWords(hash160);
      words.unshift(0x00);
      return bech32.encode(LTC_NETWORK.bech32, words);
    }
    throw err;
  }
}

/**
 * Derives TRON address (BIP44: m/44'/195'/0'/0/i -> Base58 T...).
 * Used for TRX and USDT TRC-20.
 */
export function deriveTronAddress(masterKey: HDKey, index: number): string {
  try {
    const child = masterKey.derive(`${BIP_PATHS.TRON}/${index}`);
    if (!child.publicKey) throw new Error('No public key generated for TRON child');

    const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
    const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
    const addressHash = ethers.keccak256(pubBytes);

    // Prefix 0x41 for TRON Base58Check
    const tronRawAddress = Buffer.concat([
      Buffer.from([0x41]),
      Buffer.from(addressHash.slice(-40), 'hex'),
    ]);

    const hash1 = crypto.createHash('sha256').update(tronRawAddress).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    const checksum = hash2.subarray(0, 4);

    return bs58.encode(Buffer.concat([tronRawAddress, checksum]));
  } catch (err) {
    const tronXpub = process.env.TRON_XPUB;
    if (tronXpub) {
      const hdkey = HDKey.fromExtendedKey(tronXpub);
      const child = hdkey.deriveChild(0).deriveChild(index);
      const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey!, false);
      const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
      const addressHash = ethers.keccak256(pubBytes);
      const tronRaw = Buffer.concat([Buffer.from([0x41]), Buffer.from(addressHash.slice(-40), 'hex')]);
      const hash1 = crypto.createHash('sha256').update(tronRaw).digest();
      const hash2 = crypto.createHash('sha256').update(hash1).digest();
      return bs58.encode(Buffer.concat([tronRaw, hash2.subarray(0, 4)]));
    }
    throw err;
  }
}

/**
 * Derives all 6 crypto deposit addresses for a specific integer index.
 */
export async function deriveAllAddressesAsync(walletIndex: number): Promise<CryptoDepositAddresses> {
  const masterKey = await getMasterHDKey();

  const btc = deriveBitcoinNativeSegwitAddress(masterKey, walletIndex);
  const evm = deriveEvmAddress(masterKey, walletIndex); // Shared by ETH, USDT ERC-20, USDT BEP-20
  const ltc = deriveLitecoinNativeSegwitAddress(masterKey, walletIndex);
  const tron = deriveTronAddress(masterKey, walletIndex); // USDT TRC-20

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
 * Deterministically checks or provisions all 6 crypto deposit addresses for a user:
 * 1. Checks if 6 address rows exist in public.user_deposit_addresses for user_id.
 * 2. If missing:
 *    a. Fetches user's wallet_index from public.profiles (or provisions sequentially).
 *    b. Derives addresses for BTC (BIP-84), ETH/EVM (BIP-44), LTC (BIP-84), TRON (BIP-44).
 *    c. UPSERT all 6 asset rows into public.user_deposit_addresses.
 *    d. UPDATE public.profiles with evm_deposit_address, tron_deposit_address, btc_deposit_address, ltc_deposit_address.
 * 3. Returns the populated profile and address mapping object.
 */
export async function getOrDeriveUserDepositAddresses(
  userId: string
): Promise<UserDepositAddressesResult> {
  const supabase = getAdminClient();

  // 1. Fetch user profile
  const { data: profileData, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr || !profileData) {
    throw new Error(`User profile not found for user ${userId}`);
  }

  const profile: UserProfileRecord = profileData;

  // 2. Resolve wallet_index (Fail-closed if missing or invalid)
  const walletIndex = profile.wallet_index;
  if (walletIndex === null || walletIndex === undefined || typeof walletIndex !== 'number' || walletIndex <= 0) {
    throw new Error(`Fail-closed: User profile ${userId} has no valid allocated wallet_index. Address derivation cannot proceed.`);
  }

  // 3. Derive authoritative addresses for this walletIndex
  const addresses = await deriveAllAddressesAsync(walletIndex);

  // 4. Execute canonical atomic provisioning via database RPC
  const { error: rpcError } = await supabase.rpc('provision_user_wallets_atomic', {
    p_user_id: userId,
    p_wallet_index: walletIndex,
    p_evm_address: addresses.ETH,
    p_tron_address: addresses.USDT_TRC20,
    p_btc_address: addresses.BTC,
    p_ltc_address: addresses.LTC,
  });

  if (rpcError) {
    throw new Error(`Atomic provisioning RPC failed: ${rpcError.message}`);
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
    user_id: userId,
    asset_symbol: asset.symbol,
    chain: getChainEnum(asset.network),
    network: asset.network,
    asset_code: asset.symbol,
    network_code: asset.network,
    address: asset.address,
    derivation_path: asset.path,
  }));

  return {
    userId,
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
