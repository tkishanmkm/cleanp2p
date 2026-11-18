import { HDKey } from '@scure/bip32';
import { bech32 } from 'bech32';
import { ethers } from 'ethers';
import crypto from 'crypto';
import bs58 from 'bs58';
import { validateWalletDerivationIndex } from '@/lib/crypto/mnemonic-validation';

const EXPECTED_ACCOUNT_DEPTH = 3;
const EXPECTED_ACCOUNT_CHILD_INDEX = 0x80000000;

export interface DepositAccountXpubs {
  evm: string;
  btc: string;
  tron: string;
  ltc: string;
}

export interface XpubDepositAddresses {
  BTC: string;
  ETH: string;
  LTC: string;
  USDT_ERC20: string;
  USDT_BEP20: string;
  USDT_TRC20: string;
}

/**
 * Require an account-level public key for the standard BIP-44/BIP-84 account paths.
 * A root xpub, a private extended key, or an external-chain xpub is rejected.
 *
 * NOTE: depth/index metadata cannot prove the complete ancestor path. Before
 * production use, compare this key against known existing addresses and key
 * ceremony records for the correct coin/account path.
 */
export function parseDepositAccountXpub(xpub: string, label: string): HDKey {
  if (typeof xpub !== 'string' || !xpub.trim()) {
    throw new Error(label + ' account xpub is required');
  }

  let key: HDKey;
  try {
    key = HDKey.fromExtendedKey(xpub.trim());
  } catch {
    throw new Error(label + ' account xpub is malformed');
  }

  if (key.privateKey) {
    key.wipePrivateData();
    throw new Error(label + ' must be a public extended key; private extended keys are forbidden');
  }

  if (key.depth !== EXPECTED_ACCOUNT_DEPTH || key.index !== EXPECTED_ACCOUNT_CHILD_INDEX) {
    throw new Error(label + " must be the account-level public key at depth 3 and account child 0'");
  }

  if (!key.publicKey || !key.chainCode) {
    throw new Error(label + ' account xpub is incomplete');
  }

  return key;
}

function deriveAccountChildPublicKey(xpub: string, index: number, label: string): Uint8Array {
  validateWalletDerivationIndex(index);
  const account = parseDepositAccountXpub(xpub, label);

  try {
    const external = account.deriveChild(0);
    const child = external.deriveChild(index);
    if (!child.publicKey) {
      throw new Error(label + ' child public key is unavailable');
    }
    return Uint8Array.from(child.publicKey);
  } finally {
    account.wipePrivateData();
  }
}

/**
 * Derives an EVM deposit address from an account xpub at:
 * m/44'/60'/0'/0/childIndex
 *
 * The same address is used for ETH, USDT ERC-20, and USDT BEP-20.
 */
export function deriveEvmAddressFromXpub(xpub: string, childIndex: number): string {
  const publicKey = deriveAccountChildPublicKey(xpub, childIndex, 'EVM');
  const uncompressedHex = ethers.SigningKey.computePublicKey(publicKey, false);
  const publicKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  const addressHash = ethers.keccak256(publicKeyBytes);
  return ethers.getAddress('0x' + addressHash.slice(-40));
}

/**
 * Derives a Bitcoin Native SegWit address from an account xpub at:
 * m/84'/0'/0'/0/childIndex
 */
export function deriveBtcSegwitAddressFromZpub(xpub: string, childIndex: number): string {
  const publicKey = deriveAccountChildPublicKey(xpub, childIndex, 'BTC');
  const sha256 = crypto.createHash('sha256').update(publicKey).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
  const words = bech32.toWords(hash160);
  words.unshift(0x00);
  return bech32.encode('bc', words);
}

/**
 * Derives a Litecoin Native SegWit address from an account xpub at:
 * m/84'/2'/0'/0/childIndex
 */
export function deriveLtcSegwitAddressFromXpub(xpub: string, childIndex: number): string {
  const publicKey = deriveAccountChildPublicKey(xpub, childIndex, 'LTC');
  const sha256 = crypto.createHash('sha256').update(publicKey).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
  const words = bech32.toWords(hash160);
  words.unshift(0x00);
  return bech32.encode('ltc', words);
}

/**
 * Derives a TRON address from an account xpub at:
 * m/44'/195'/0'/0/childIndex
 */
export function deriveTronAddressFromXpub(xpub: string, childIndex: number): string {
  const publicKey = deriveAccountChildPublicKey(xpub, childIndex, 'TRON');
  const uncompressedHex = ethers.SigningKey.computePublicKey(publicKey, false);
  const publicKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
  const addressHash = ethers.keccak256(publicKeyBytes);

  const tronPayload = Buffer.concat([
    Buffer.from([0x41]),
    Buffer.from(addressHash.slice(-40), 'hex'),
  ]);
  const firstHash = crypto.createHash('sha256').update(tronPayload).digest();
  const secondHash = crypto.createHash('sha256').update(firstHash).digest();
  return bs58.encode(Buffer.concat([tronPayload, secondHash.subarray(0, 4)]));
}

/**
 * Public-only derivation of the complete six-address deposit set.
 * Inputs must be account-level xpubs derived from the same audited wallet ceremony.
 * Missing, malformed, private, or incorrectly scoped extended keys fail closed.
 */
export function deriveAllDepositAddressesFromXpubs(
  xpubs: DepositAccountXpubs,
  childIndex: number,
): XpubDepositAddresses {
  validateWalletDerivationIndex(childIndex);

  if (!xpubs || typeof xpubs !== 'object') {
    throw new Error('All four account-level public extended keys are required');
  }

  const evm = deriveEvmAddressFromXpub(xpubs.evm, childIndex);
  const btc = deriveBtcSegwitAddressFromZpub(xpubs.btc, childIndex);
  const tron = deriveTronAddressFromXpub(xpubs.tron, childIndex);
  const ltc = deriveLtcSegwitAddressFromXpub(xpubs.ltc, childIndex);

  return {
    BTC: btc,
    ETH: evm,
    LTC: ltc,
    USDT_ERC20: evm,
    USDT_BEP20: evm,
    USDT_TRC20: tron,
  };
}
