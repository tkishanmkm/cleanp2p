import * as bip39 from '@scure/bip39';
import { wordlist as czechWordlist } from '@scure/bip39/wordlists/czech.js';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { wordlist as frenchWordlist } from '@scure/bip39/wordlists/french.js';
import { wordlist as italianWordlist } from '@scure/bip39/wordlists/italian.js';
import { wordlist as japaneseWordlist } from '@scure/bip39/wordlists/japanese.js';
import { wordlist as koreanWordlist } from '@scure/bip39/wordlists/korean.js';
import { wordlist as portugueseWordlist } from '@scure/bip39/wordlists/portuguese.js';
import { wordlist as simplifiedChineseWordlist } from '@scure/bip39/wordlists/simplified-chinese.js';
import { wordlist as spanishWordlist } from '@scure/bip39/wordlists/spanish.js';
import { wordlist as traditionalChineseWordlist } from '@scure/bip39/wordlists/traditional-chinese.js';

const SUPPORTED_BIP39_WORDLISTS = [
  czechWordlist,
  englishWordlist,
  frenchWordlist,
  italianWordlist,
  japaneseWordlist,
  koreanWordlist,
  portugueseWordlist,
  simplifiedChineseWordlist,
  spanishWordlist,
  traditionalChineseWordlist,
] as const;

/**
 * Normalize and validate a BIP-39 mnemonic against official wordlists and checksum.
 * The function returns only the normalized phrase; callers must not log or persist it.
 */
export function normalizeAndValidateDepositMnemonic(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('A BIP-39 mnemonic is required');
  }

  const normalized = value.normalize('NFKD').trim().split(/\s+/u).join(' ');
  if (!normalized || !SUPPORTED_BIP39_WORDLISTS.some((wordlist) =>
    bip39.validateMnemonic(normalized, wordlist)
  )) {
    throw new Error('Mnemonic is not valid BIP-39 or its checksum is invalid');
  }

  return normalized;
}

/**
 * Validate BIP-39 membership and checksum without returning any key material.
 */
export function isValidDepositMnemonic(value: unknown): boolean {
  try {
    normalizeAndValidateDepositMnemonic(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and validate the configured master wallet mnemonic.
 * No secret content is included in validation errors.
 */
export function requireDepositMnemonic(): string {
  const configured = process.env.DEPOSIT_HD_MNEMONIC;
  if (!configured || !configured.trim()) {
    throw new Error('DEPOSIT_HD_MNEMONIC environment variable is not configured');
  }

  try {
    return normalizeAndValidateDepositMnemonic(configured);
  } catch {
    throw new Error('DEPOSIT_HD_MNEMONIC is not a valid BIP-39 mnemonic or its checksum is invalid; refusing wallet derivation');
  }
}

/**
 * Restrict database-allocated wallet indexes to the positive BIP-32
 * non-hardened child-index range. Index zero is valid in BIP-32 generally,
 * but reserved by this application so every customer wallet index is positive.
 */
export function validateWalletDerivationIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 1 || index > 0x7fffffff) {
    throw new Error('Wallet derivation index must be a positive safe BIP-32 child index');
  }
}
