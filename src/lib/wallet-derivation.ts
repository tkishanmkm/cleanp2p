import crypto from 'crypto';
import { HDKey } from '@scure/bip32';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from '@/lib/supabase/service-role';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

// ============================================================================
// Types & Configuration Interfaces
// ============================================================================

export type SupportedChain = 'EVM' | 'BTC' | 'TRON' | 'LTC';
export type SupportedNetwork = 'ERC20' | 'BEP20' | 'TRC20' | 'BTC' | 'LTC' | 'TRON';
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
  return getSupabaseServiceClient();
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
  } catch {
    throw new Error('EVM public-key derivation failed. Check EVM_XPUB and the derivation index.');
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

    // Encode as Bech32 P2WPKH (witness version 0) - Mainnet 'bc'
    const words = bech32.toWords(hash160);
    words.unshift(0x00);

    return bech32.encode('bc', words);
  } catch {
    throw new Error('Bitcoin public-key derivation failed. Check BTC_XPUB and the derivation index.');
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

    return bech32.encode('ltc', words);
  } catch {
    throw new Error('Litecoin public-key derivation failed. Check LTC_XPUB and the derivation index.');
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
  } catch {
    throw new Error('TRON public-key derivation failed. Check TRON_XPUB and the derivation index.');
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
  if (!Number.isSafeInteger(index) || index < 0 || index > 2_147_483_647) {
    throw new Error('A valid non-negative wallet derivation index is required.');
  }

  const evmXpub = process.env.EVM_XPUB?.trim();
  const btcXpub = process.env.BTC_XPUB?.trim();
  const tronXpub = process.env.TRON_XPUB?.trim();
  const ltcXpub = process.env.LTC_XPUB?.trim();

  if (!evmXpub || !btcXpub || !tronXpub || !ltcXpub) {
    throw new Error('EVM_XPUB, BTC_XPUB, TRON_XPUB, and LTC_XPUB must all be configured. No fallback wallet keys are permitted.');
  }

  const evm = deriveEvmAddress(evmXpub, index);
  const btc = deriveBtcSegwitAddress(btcXpub, index);
  const tron = deriveTronAddress(tronXpub, index);
  const ltc = deriveLtcSegwitAddress(ltcXpub, index);

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
  const result = await getOrDeriveUserDepositAddresses(userId);

  return {
    userId,
    walletId: result.userId,
    derivationIndex: result.walletIndex,
    addresses: {
      BTC: result.addresses.BTC,
      ETH: result.addresses.ETH,
      LTC: result.addresses.LTC,
      TRON: result.addresses.USDT_TRC20,
      USDT_ERC20: result.addresses.USDT_ERC20,
      USDT_BEP20: result.addresses.USDT_BEP20,
      USDT_TRC20: result.addresses.USDT_TRC20,
    },
    details: [
      {
        asset: 'BTC',
        network: 'BTC',
        address: result.addresses.BTC,
        chain: 'BTC',
        derivationPath: `${DERIVATION_PATHS.BTC}/${result.walletIndex}`,
        label: 'Bitcoin (Native SegWit)',
      },
      {
        asset: 'ETH',
        network: 'ERC20',
        address: result.addresses.ETH,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${result.walletIndex}`,
        label: 'Ethereum (ERC-20)',
      },
      {
        asset: 'USDT',
        network: 'ERC20',
        address: result.addresses.USDT_ERC20,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${result.walletIndex}`,
        label: 'Tether USD (ERC-20)',
      },
      {
        asset: 'USDT',
        network: 'BEP20',
        address: result.addresses.USDT_BEP20,
        chain: 'EVM',
        derivationPath: `${DERIVATION_PATHS.EVM}/${result.walletIndex}`,
        label: 'Tether USD (BEP-20 / BSC)',
      },
      {
        asset: 'USDT',
        network: 'TRC20',
        address: result.addresses.USDT_TRC20,
        chain: 'TRON',
        derivationPath: `${DERIVATION_PATHS.TRON}/${result.walletIndex}`,
        label: 'Tether USD (TRC-20)',
      },
      {
        asset: 'LTC',
        network: 'LTC',
        address: result.addresses.LTC,
        chain: 'LTC',
        derivationPath: `${DERIVATION_PATHS.LTC}/${result.walletIndex}`,
        label: 'Litecoin (Native SegWit)',
      },
    ],
  };
}
