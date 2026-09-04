import { HDKey } from '@scure/bip32';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import crypto from 'crypto';
import bs58 from 'bs58';

/**
 * Derives a standard EVM (ETH, BSC, Polygon) public deposit address from an xpub.
 * Path: m/44'/60'/0'/0/childIndex
 */
export function deriveEvmAddressFromXpub(xpub: string, childIndex: number): string {
  const hdkey = HDKey.fromExtendedKey(xpub);
  const child = hdkey.deriveChild(0).deriveChild(childIndex);

  if (!child.publicKey) {
    throw new Error('Failed to derive public key point from extended public key.');
  }

  // Convert compressed public key to uncompressed EC point (65 bytes)
  const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
  // Strip 0x04 uncompressed prefix (64 bytes remain)
  const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  // Keccak-256 hash of public key bytes
  const addressHash = ethers.keccak256(pubBytes);
  // Take last 20 bytes
  return ethers.getAddress(`0x${addressHash.slice(-40)}`);
}

/**
 * Derives a BTC BIP84 Native SegWit (bech32 / bc1q...) address from a zpub/xpub.
 * Path: m/84'/0'/0'/0/childIndex
 */
export function deriveBtcSegwitAddressFromZpub(zpubOrXpub: string, childIndex: number): string {
  const hdkey = HDKey.fromExtendedKey(zpubOrXpub);
  const child = hdkey.deriveChild(0).deriveChild(childIndex);

  if (!child.publicKey) {
    throw new Error('Failed to derive BTC public key point.');
  }

  // HASH160: RIPEMD160(SHA256(compressedPublicKey))
  const sha256 = crypto.createHash('sha256').update(child.publicKey).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();

  // Encode as Bech32 P2WPKH (witness version 0)
  const words = bech32.toWords(hash160);
  words.unshift(0x00);
  return bech32.encode('bc', words);
}

/**
 * Derives a TRON (TRC-20) address from an xpub.
 * TRON addresses are 0x41 + Keccak256(uncompressedPubKey)[-20 bytes], Base58Check encoded.
 */
export function deriveTronAddressFromXpub(xpub: string, childIndex: number): string {
  const hdkey = HDKey.fromExtendedKey(xpub);
  const child = hdkey.deriveChild(0).deriveChild(childIndex);

  if (!child.publicKey) {
    throw new Error('Failed to derive TRON public key point.');
  }

  const uncompressedHex = ethers.SigningKey.computePublicKey(child.publicKey, false);
  const pubBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  const addressHash = ethers.keccak256(pubBytes);
  
  // Prefix with 0x41 (TRON mainnet prefix)
  const tronRawAddress = Buffer.concat([
    Buffer.from([0x41]),
    Buffer.from(addressHash.slice(-40), 'hex')
  ]);

  // Double SHA-256 for Base58Check checksum
  const hash1 = crypto.createHash('sha256').update(tronRawAddress).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  const checksum = hash2.subarray(0, 4);

  return bs58.encode(Buffer.concat([tronRawAddress, checksum]));
}
