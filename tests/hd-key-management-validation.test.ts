import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMnemonic } from '@scure/bip39';
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
import {
  isValidDepositMnemonic,
  normalizeAndValidateDepositMnemonic,
  validateWalletDerivationIndex,
} from '../src/lib/crypto/mnemonic-validation';

const supportedWordlists = [
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

describe('BIP-39 wallet seed validation', () => {
  it('accepts valid checksum mnemonics from every supported official wordlist', () => {
    for (const wordlist of supportedWordlists) {
      const mnemonic = generateMnemonic(wordlist, 128);
      assert.equal(isValidDepositMnemonic(mnemonic), true);
    }
  });

  it('rejects invalid word counts, unknown words and invalid checksums', () => {
    assert.equal(isValidDepositMnemonic(''), false);
    assert.equal(isValidDepositMnemonic('abandon abandon abandon'), false);
    assert.equal(
      isValidDepositMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'),
      false,
    );
    assert.equal(isValidDepositMnemonic('notaword '.repeat(11) + 'notaword'), false);
  });

  it('normalizes BIP-39 whitespace without changing the phrase', () => {
    const mnemonic = generateMnemonic(englishWordlist, 128);
    const expandedWhitespace = mnemonic.split(' ').join('   ');
    assert.equal(
      normalizeAndValidateDepositMnemonic(expandedWhitespace),
      mnemonic,
    );
  });
});

describe('BIP-32 wallet child-index validation', () => {
  it('accepts the non-hardened child index range', () => {
    // Index zero is reserved by the product's shared wallet allocator policy.
    assert.doesNotThrow(() => validateWalletDerivationIndex(1));
    assert.doesNotThrow(() => validateWalletDerivationIndex(0x7fffffff));
  });

  it('rejects the reserved index zero', () => {
    assert.throws(() => validateWalletDerivationIndex(0), /positive safe BIP-32 child index/);
  });

  it('rejects unsafe, negative, fractional and hardened child indices', () => {
    for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x80000000, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateWalletDerivationIndex(index));
    }
  });
});
