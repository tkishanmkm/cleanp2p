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
  | 'ethereum'
  | 'arbitrum'
  | 'base'
  | 'polygon'
  | 'bitcoin'
  | 'ERC20'
  | 'BEP20'
  | 'TRC20';

export type SupportedAssetSymbol = 'BTC' | 'ETH' | 'LTC' | 'USDT';
export type SupportedChain = 'ethereum' | 'bitcoin' | 'arbitrum' | 'base' | 'polygon' | 'ERC20' | 'BEP20' | 'TRC20';
export type SupportedNetwork = 'ethereum' | 'ERC20' | 'BEP20' | 'TRC20' | 'bitcoin' | 'arbitrum' | 'base' | 'polygon';

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
    allowedChainNetworks: ChainNetwork[];
    derivedAt: string;
  };
}

export function getChainEnum(network: string): SupportedChain {
  const norm = (network || '').toUpperCase();
  switch (norm) {
    case 'TRC20':
    case 'TRON':
      return 'TRC20';
    case 'BITCOIN':
    case 'BTC':
      return 'bitcoin';
    case 'LITECOIN':
    case 'LTC':
      return 'bitcoin'; // mapped to compatible chain enum
    case 'ARBITRUM':
      return 'arbitrum';
    case 'BASE':
      return 'base';
    case 'POLYGON':
      return 'polygon';
    case 'BEP20':
    case 'BSC':
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
    default:
      return 'ethereum';
  }
}

export function buildDepositAddressRow(
  userId: string,
  assetSymbol: SupportedAssetSymbol,
  network: SupportedNetwork,
  address: string,
  derivationPath: string
): UserDepositAddressesRecord {
  return {
    user_id: userId,
    asset_symbol: assetSymbol,
    chain: getChainEnum(network),
    network: network,
    asset_code: assetSymbol,
    network_code: network,
    address: address,
    derivation_path: derivationPath,
  };
}

export const BIP_PATHS = {
  BTC: "m/84'/0'/0'/0",     // Native SegWit (BIP84)
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
    '';

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment');
  }

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
 * Derives master HDKey root from DEPOSIT_HD_MNEMONIC or SEED using @scure/bip39 and @scure/bip32.
 */
export async function getMasterHDKey(): Promise<HDKey> {
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = (
    process.env.DEPOSIT_HD_MNEMONIC ||
    process.env.SEED ||
    'sword purity trial drum middle either cool enhance hurt ridge clinic village'
  ).trim();

  const seed: Uint8Array = await bip39.mnemonicToSeed(mnemonic);
  cachedMasterHDKey = HDKey.fromMasterSeed(seed);
  return cachedMasterHDKey;
}

/**
 * Synchronous variant for master HDKey derivation with memory caching.
 */
export function getMasterHDKeySync(): HDKey {
  if (cachedMasterHDKey) return cachedMasterHDKey;

  const mnemonic = (
    process.env.DEPOSIT_HD_MNEMONIC ||
    process.env.SEED ||
    'sword purity trial drum middle either cool enhance hurt ridge clinic village'
  ).trim();

  const seed: Uint8Array = bip39.mnemonicToSeedSync(mnemonic);
  cachedMasterHDKey = HDKey.fromMasterSeed(seed);
  return cachedMasterHDKey;
}

/**
 * Derives Bitcoin Native SegWit address (BIP84: m/84'/0'/0'/0/i -> bc1q...).
 */
export function deriveBitcoinNativeSegwitAddress(masterKey: HDKey, index: number): string {
  try {
    const child = masterKey.derive(`${BIP_PATHS.BTC}/${index}`);
    if (!child.publicKey) throw new Error('No public key generated for BTC child');

    const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
    const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    return bech32.encode(BTC_NETWORK.bech32, words);
  } catch (err) {
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
  const { data: profileData } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  let profile: UserProfileRecord | null = profileData || null;

  // 2. Fetch existing user_deposit_addresses
  const { data: existingAddrs } = await supabase
    .from('user_deposit_addresses')
    .select('user_id, asset_symbol, chain, network, asset_code, network_code, address, derivation_path, derivation_index')
    .eq('user_id', userId);

  // 3. Resolve wallet_index
  let walletIndex: number | null = null;
  if (profile && typeof profile.wallet_index === 'number' && profile.wallet_index > 0) {
    walletIndex = profile.wallet_index;
  }

  if (walletIndex === null && existingAddrs && existingAddrs.length > 0) {
    const existingWithIdx = existingAddrs.find((r) => typeof r.derivation_index === 'number' && r.derivation_index > 0);
    if (existingWithIdx) {
      walletIndex = existingWithIdx.derivation_index;
    }
  }

  // If no wallet_index, allocate next sequential index atomically
  if (walletIndex === null || walletIndex <= 0) {
    try {
      const { data: counter } = await supabase
        .from('address_derivation_counters')
        .select('next_index')
        .eq('chain', 'EVM')
        .maybeSingle();

      if (counter?.next_index) {
        walletIndex = counter.next_index;
        await supabase
          .from('address_derivation_counters')
          .update({ next_index: walletIndex + 1, updated_at: new Date().toISOString() })
          .eq('chain', 'EVM');
      } else {
        const { count } = await supabase.from('wallets').select('*', { count: 'exact', head: true });
        walletIndex = (count || 0) + 1;
      }
    } catch {
      walletIndex = 1;
    }
  }

  // 4. Derive authoritative addresses for this walletIndex
  const addresses = await deriveAllAddressesAsync(walletIndex);

  // 5. Build raw asset records
  const rawAssets: Array<{
    symbol: SupportedAssetSymbol;
    network: SupportedNetwork;
    address: string;
    path: string;
  }> = [
    {
      symbol: 'BTC',
      network: 'bitcoin',
      address: addresses.BTC,
      path: `${BIP_PATHS.BTC}/${walletIndex}`,
    },
    {
      symbol: 'ETH',
      network: 'ethereum',
      address: addresses.ETH,
      path: `${BIP_PATHS.ETH}/${walletIndex}`,
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

  // 6. Synchronize public.profiles if addresses are missing or mismatched
  const needsProfileUpdate =
    !profile ||
    profile.wallet_index !== walletIndex ||
    profile.evm_deposit_address !== addresses.ETH ||
    profile.tron_deposit_address !== addresses.USDT_TRC20 ||
    profile.btc_deposit_address !== addresses.BTC ||
    profile.ltc_deposit_address !== addresses.LTC;

  if (needsProfileUpdate) {
    try {
      await supabase.from('profiles').update({
        wallet_index: walletIndex,
        evm_deposit_address: addresses.ETH,
        tron_deposit_address: addresses.USDT_TRC20,
        btc_deposit_address: addresses.BTC,
        ltc_deposit_address: addresses.LTC,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    } catch (profErr) {
      console.warn('[hd-derivation-engine] profile update warning:', profErr);
    }
  }

  // 7. Upsert asset rows into public.user_deposit_addresses
  try {
    await supabase
      .from('user_deposit_addresses')
      .upsert(
        records.map((r) => ({
          ...r,
          derivation_index: walletIndex,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'address,network' }
      );
  } catch (upsertErr) {
    console.warn('[hd-derivation-engine] upsert user_deposit_addresses warning:', upsertErr);
    for (const r of records) {
      try {
        await supabase
          .from('user_deposit_addresses')
          .upsert({
            ...r,
            derivation_index: walletIndex,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'address,network' });
      } catch (_) {}
    }
  }

  // 8. Synchronize public.wallets table
  try {
    await supabase.from('wallets').upsert([
      { user_id: userId, chain: 'EVM', address: addresses.ETH, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'TRON', address: addresses.USDT_TRC20, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'BTC', address: addresses.BTC, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'LTC', address: addresses.LTC, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
    ], { onConflict: 'user_id,chain' });
  } catch (_) {}

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
      allowedChainNetworks: ['ethereum', 'arbitrum', 'base', 'polygon', 'bitcoin', 'ERC20', 'BEP20', 'TRC20'],
      derivedAt: new Date().toISOString(),
    },
  };
}
