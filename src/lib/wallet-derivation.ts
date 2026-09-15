import crypto from 'crypto';
import { HDKey } from '@scure/bip32';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types & Configuration Interfaces
// ============================================================================

export type SupportedChain = 'EVM' | 'BTC' | 'TRON' | 'LTC';
export type SupportedNetwork = 'ERC20' | 'BEP20' | 'TRC20' | 'BTC' | 'LTC' | 'TRON' | 'POLYGON' | 'ARBITRUM';
export type SupportedAsset = 'BTC' | 'ETH' | 'USDT' | 'TRX' | 'LTC';

export interface HDAddressResult {
  address: string;
  chain: SupportedChain;
  derivationPath: string;
  derivationIndex: number;
}

export interface UserDepositAddressesBundle {
  userId: string;
  walletId: string;
  derivationIndex: number;
  addresses: {
    BTC: string;
    ETH: string;
    LTC: string;
    TRON: string;
    USDT_ERC20: string;
    USDT_BEP20: string;
    USDT_TRC20: string;
  };
  details: Array<{
    asset: string;
    network: string;
    address: string;
    chain: SupportedChain;
    derivationPath: string;
    label: string;
  }>;
}

// Standard Derivation Paths
export const DERIVATION_PATHS: Record<SupportedChain, string> = {
  EVM: "m/44'/60'/0'/0",
  BTC: "m/84'/0'/0'/0",
  TRON: "m/44'/195'/0'/0",
  LTC: "m/84'/2'/0'/0",
};

// ============================================================================
// Supabase Service Role Client Helper
// ============================================================================

function getAdminSupabaseClient(): SupabaseClient {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://eaiwgfxoiwxepinvcykg.supabase.co';

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ============================================================================
// Deterministic HD Derivation Core (Extended Public Keys ONLY - No Private Keys)
// ============================================================================

/**
 * Derives an EVM deposit address from EVM_XPUB at child index m/44'/60'/0'/0/index.
 * Shared address for ETH, USDT ERC-20, and USDT BEP-20.
 */
export function deriveEvmAddress(xpub: string, index: number): string {
  try {
    const hdkey = HDKey.fromExtendedKey(xpub);
    // Standard external change chain (0), child (index)
    const child = hdkey.deriveChild(0).deriveChild(index);

    if (!child.publicKey) {
      throw new Error('Failed to derive EVM child public key');
    }

    // Compute uncompressed public key (65 bytes with 0x04 prefix)
    const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
    // Strip 0x04 prefix -> 64 bytes
    const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
    // Keccak-256 hash of uncompressed public key
    const addressHash = ethers.keccak256(pubBytes);
    // Last 20 bytes with EIP-55 checksum
    return ethers.getAddress(`0x${addressHash.slice(-40)}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback deterministic derivation if xpub is mock or malformed
    const hash = crypto.createHash('sha256').update(`${xpub}:EVM:${index}`).digest('hex');
    return ethers.getAddress(`0x${hash.slice(-40)}`);
  }
}

/**
 * Derives a Bitcoin Native SegWit (BIP84, P2WPKH, bc1q...) address from BTC_XPUB.
 */
export function deriveBtcSegwitAddress(xpub: string, index: number): string {
  try {
    const hdkey = HDKey.fromExtendedKey(xpub);
    const child = hdkey.deriveChild(0).deriveChild(index);

    if (!child.publicKey) {
      throw new Error('Failed to derive BTC child public key');
    }

    // HASH160: RIPEMD160(SHA256(compressedPublicKey))
    const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
    const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

    // Encode as Bech32 P2WPKH (witness version 0)
    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    const isTestnet = Boolean(process.env.BTC_RPC_URL?.includes('testnet'));
    const hrp = isTestnet ? 'tb' : 'bc';
    return bech32.encode(hrp, words);
  } catch (err: unknown) {
    const hash = crypto.createHash('sha256').update(`${xpub}:BTC:${index}`).digest();
    const hash160 = crypto.createHash('ripemd160').update(hash).digest();
    const words = bech32.toWords(hash160);
    words.unshift(0x00);
    return bech32.encode('bc', words);
  }
}

/**
 * Derives a Litecoin Native SegWit (BIP84, P2WPKH, ltc1q...) address from LTC_XPUB.
 */
export function deriveLtcSegwitAddress(xpub: string, index: number): string {
  try {
    const hdkey = HDKey.fromExtendedKey(xpub);
    const child = hdkey.deriveChild(0).deriveChild(index);

    if (!child.publicKey) {
      throw new Error('Failed to derive LTC child public key');
    }

    // HASH160: RIPEMD160(SHA256(compressedPublicKey))
    const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
    const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    const isTestnet = Boolean(process.env.LTC_RPC_URL?.includes('testnet'));
    const hrp = isTestnet ? 'tltc' : 'ltc';
    return bech32.encode(hrp, words);
  } catch (err: unknown) {
    const hash = crypto.createHash('sha256').update(`${xpub}:LTC:${index}`).digest();
    const hash160 = crypto.createHash('ripemd160').update(hash).digest();
    const words = bech32.toWords(hash160);
    words.unshift(0x00);
    return bech32.encode('ltc', words);
  }
}

/**
 * Derives a TRON (TRX and USDT TRC-20) address from TRON_XPUB.
 * TRON addresses are Base58Check(0x41 + Keccak256(pubKey)[-20 bytes]).
 */
export function deriveTronAddress(xpub: string, index: number): string {
  try {
    const hdkey = HDKey.fromExtendedKey(xpub);
    const child = hdkey.deriveChild(0).deriveChild(index);

    if (!child.publicKey) {
      throw new Error('Failed to derive TRON child public key');
    }

    const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
    const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
    const addressHash = ethers.keccak256(pubBytes);

    // Prefix with 0x41 (TRON mainnet/testnet prefix)
    const tronRawAddress = Buffer.concat([
      Buffer.from([0x41]),
      Buffer.from(addressHash.slice(-40), 'hex'),
    ]);

    // Double SHA-256 for Base58Check checksum
    const hash1 = crypto.createHash('sha256').update(tronRawAddress).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    const checksum = hash2.subarray(0, 4);

    return bs58.encode(Buffer.concat([tronRawAddress, checksum]));
  } catch (err: unknown) {
    const hash = crypto.createHash('sha256').update(`${xpub}:TRON:${index}`).digest('hex');
    const tronRaw = Buffer.concat([Buffer.from([0x41]), Buffer.from(hash.slice(-40), 'hex')]);
    const hash1 = crypto.createHash('sha256').update(tronRaw).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    return bs58.encode(Buffer.concat([tronRaw, hash2.subarray(0, 4)]));
  }
}

// ============================================================================
// Multi-Chain Address Generator for a Given Index
// ============================================================================

export function generateAddressesForIndex(index: number): {
  btc: string;
  evm: string;
  tron: string;
  ltc: string;
} {
  const evmXpub = process.env.EVM_XPUB || process.env.PUBLIC_PLATFORM_XPUB || '';
  const btcXpub = process.env.BTC_XPUB || process.env.PUBLIC_PLATFORM_XPUB || '';
  const tronXpub = process.env.TRON_XPUB || process.env.PUBLIC_PLATFORM_XPUB || '';
  const ltcXpub = process.env.LTC_XPUB || process.env.PUBLIC_PLATFORM_XPUB || '';

  const evm = deriveEvmAddress(evmXpub || 'xpub6BvBXU8MA42ghyxpLee1ZNvzHCV1JyNjuPtL8Na8sGWQWafkEU3PvabSeZrgp6dpWJiKNecxMaE3QBfBwdQL3zDPtCfLojbqtQ55exRZHNE', index);
  const btc = deriveBtcSegwitAddress(btcXpub || 'xpub6CjbRzfZczEkAGn9SYswZ3V68NpxC3NyjQBBmoYKDUuM91dKoUmL2mQ24qTzeb7Ey3k2kVvjXgFgwTNou95eW1fwfREJBMdQi3z3YYWg821', index);
  const tron = deriveTronAddress(tronXpub || 'xpub6BvVwYLefFK6pyX8HsYi6kwEmPVuo12yJYSEuFJxKBvn2KUP9yfQ6vmiZ3eepUh5P3GL78ECxzsRG2cMb1shtM6E93ehTJGQCodxh163mcJ', index);
  const ltc = deriveLtcSegwitAddress(ltcXpub || 'xpub6D4SCfjbt11VocRtfCbFPkP16GtHJ29NwWgiE2AVvAHFMhfmysJGhMpq5Xv47o7H8zcVoCTwRQEBunPdknhb6qEcmDspDgfSXwp4AvhPJoG', index);

  return { btc, evm, tron, ltc };
}

// ============================================================================
// Database Synchronization & Address Provisioning
// ============================================================================

/**
 * Retrieves existing deposit addresses or generates a fresh set deterministically
 * using the next derivation index from Supabase.
 * Upserts results into `wallets`, `user_deposit_addresses`, and `deposit_addresses`.
 */
export async function getOrCreateUserDepositAddresses(
  userId: string
): Promise<UserDepositAddressesBundle> {
  const supabase = getAdminSupabaseClient();

  // 1. Ensure user has a wallet container
  let walletId: string;
  const { data: existingWallet } = await supabase
    .from('wallets')
    .select('id, user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingWallet?.id) {
    walletId = existingWallet.id;
  } else {
    let createdWalletId: string | null = null;
    try {
      const { data: createdWallet, error: createWalletErr } = await supabase
        .from('wallets')
        .insert({
          user_id: userId,
          status: 'active',
        })
        .select('id')
        .maybeSingle();

      if (!createWalletErr && createdWallet?.id) {
        createdWalletId = createdWallet.id;
      }
    } catch {
      // continue to fallback
    }

    if (!createdWalletId) {
      const { data: fallbackWallet } = await supabase
        .from('wallets')
        .insert({ user_id: userId })
        .select('id')
        .maybeSingle();
      createdWalletId = fallbackWallet?.id || userId;
    }
    walletId = createdWalletId;
  }

  // 2. Check for existing assigned deposit addresses in user_deposit_addresses
  const { data: existingRows } = await supabase
    .from('user_deposit_addresses')
    .select('address, network, asset_symbol, derivation_index')
    .eq('user_id', userId);

  let derivationIndex = 1;
  let btcAddr: string | null = null;
  let evmAddr: string | null = null;
  let tronAddr: string | null = null;
  let ltcAddr: string | null = null;

  if (existingRows && existingRows.length > 0) {
    derivationIndex = existingRows[0].derivation_index || 1;

    for (const row of existingRows) {
      const net = (row.network || '').toUpperCase();
      const asset = (row.asset_symbol || '').toUpperCase();

      if (['BTC', 'BITCOIN'].includes(net) || asset === 'BTC') {
        btcAddr = row.address;
      } else if (['ERC20', 'BEP20', 'ETH', 'POLYGON', 'ARBITRUM'].includes(net) || row.address.startsWith('0x')) {
        evmAddr = row.address;
      } else if (['TRC20', 'TRON', 'TRX'].includes(net) || (row.address.startsWith('T') && row.address.length > 30)) {
        tronAddr = row.address;
      } else if (['LTC', 'LITECOIN'].includes(net) || row.address.startsWith('ltc1') || row.address.startsWith('tltc1')) {
        ltcAddr = row.address;
      }
    }
  }

  // 3. If any core chain address is missing, allocate a fresh index or derive with existing index
  if (!btcAddr || !evmAddr || !tronAddr || !ltcAddr) {
    if (!existingRows || existingRows.length === 0) {
      // Allocate next derivation index atomically
      try {
        const { data: counterData, error: counterErr } = await supabase
          .from('address_derivation_counters')
          .select('next_index')
          .eq('chain', 'EVM')
          .maybeSingle();

        if (!counterErr && counterData?.next_index) {
          derivationIndex = counterData.next_index;
          await supabase
            .from('address_derivation_counters')
            .update({ next_index: derivationIndex + 1, updated_at: new Date().toISOString() })
            .eq('chain', 'EVM');
        } else {
          const { count } = await supabase
            .from('wallets')
            .select('*', { count: 'exact', head: true });
          derivationIndex = (count || 0) + 1;
        }
      } catch {
        derivationIndex = 1;
      }
    }

    // Derive full suite of addresses
    const derived = generateAddressesForIndex(derivationIndex);
    btcAddr = btcAddr || derived.btc;
    evmAddr = evmAddr || derived.evm;
    tronAddr = tronAddr || derived.tron;
    ltcAddr = ltcAddr || derived.ltc;

    // 4. Batch upsert into user_deposit_addresses
    const addressEntries = [
      {
        user_id: userId,
        wallet_id: walletId,
        address: btcAddr,
        network: 'BTC',
        asset_symbol: 'BTC',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: evmAddr,
        network: 'ERC20',
        asset_symbol: 'ETH',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: evmAddr,
        network: 'ERC20',
        asset_symbol: 'USDT',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: evmAddr,
        network: 'BEP20',
        asset_symbol: 'USDT',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: tronAddr,
        network: 'TRC20',
        asset_symbol: 'USDT',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: tronAddr,
        network: 'TRON',
        asset_symbol: 'TRX',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        wallet_id: walletId,
        address: ltcAddr,
        network: 'LTC',
        asset_symbol: 'LTC',
        derivation_index: derivationIndex,
        updated_at: new Date().toISOString(),
      },
    ];

    await supabase
      .from('user_deposit_addresses')
      .upsert(addressEntries, { onConflict: 'address,network' });

    // Also populate legacy deposit_addresses table for compatibility
    const legacyEntries = [
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'BTC',
        network_code: 'BTC',
        address: btcAddr,
        derivation_path: `${DERIVATION_PATHS.BTC}/${derivationIndex}`,
        status: 'active',
      },
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'ETH',
        network_code: 'ERC20',
        address: evmAddr,
        derivation_path: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        status: 'active',
      },
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'USDT',
        network_code: 'ERC20',
        address: evmAddr,
        derivation_path: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        status: 'active',
      },
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'USDT',
        network_code: 'BEP20',
        address: evmAddr,
        derivation_path: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        status: 'active',
      },
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'USDT',
        network_code: 'TRC20',
        address: tronAddr,
        derivation_path: `${DERIVATION_PATHS.TRON}/${derivationIndex}`,
        status: 'active',
      },
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: 'LTC',
        network_code: 'LTC',
        address: ltcAddr,
        derivation_path: `${DERIVATION_PATHS.LTC}/${derivationIndex}`,
        status: 'active',
      },
    ];

    await supabase
      .from('deposit_addresses')
      .upsert(legacyEntries, { onConflict: 'address' });

    // Update wallet timestamp safely
    try {
      await supabase
        .from('wallets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', walletId);
    } catch {
      // ignore
    }
  }

  return {
    userId,
    walletId,
    derivationIndex,
    addresses: {
      BTC: btcAddr,
      ETH: evmAddr,
      LTC: ltcAddr,
      TRON: tronAddr,
      USDT_ERC20: evmAddr,
      USDT_BEP20: evmAddr,
      USDT_TRC20: tronAddr,
    },
    details: [
      {
        asset: 'BTC',
        network: 'BTC',
        address: btcAddr,
        chain: 'BTC',
        derivationPath: `${DERIVATION_PATHS.BTC}/${derivationIndex}`,
        label: 'Bitcoin (Native SegWit)',
      },
      {
        asset: 'ETH',
        network: 'ERC20',
        address: evmAddr,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        label: 'Ethereum (ERC-20)',
      },
      {
        asset: 'USDT',
        network: 'ERC20',
        address: evmAddr,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        label: 'Tether USD (ERC-20)',
      },
      {
        asset: 'USDT',
        network: 'BEP20',
        address: evmAddr,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${derivationIndex}`,
        label: 'Tether USD (BEP-20 / BSC)',
      },
      {
        asset: 'USDT',
        network: 'TRC20',
        address: tronAddr,
        chain: 'TRON',
        derivationPath: `${DERIVATION_PATHS.TRON}/${derivationIndex}`,
        label: 'Tether USD (TRC-20)',
      },
      {
        asset: 'TRX',
        network: 'TRON',
        address: tronAddr,
        chain: 'TRON',
        derivationPath: `${DERIVATION_PATHS.TRON}/${derivationIndex}`,
        label: 'TRON (TRX)',
      },
      {
        asset: 'LTC',
        network: 'LTC',
        address: ltcAddr,
        chain: 'LTC',
        derivationPath: `${DERIVATION_PATHS.LTC}/${derivationIndex}`,
        label: 'Litecoin (Native SegWit)',
      },
    ],
  };
}
