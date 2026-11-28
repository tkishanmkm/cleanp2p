import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { bech32 } from 'bech32';
import bs58 from 'bs58';
import crypto from 'crypto';
import { ethers } from 'ethers';
import {
  deriveAllDepositAddressesFromXpubs,
  parseDepositAccountXpub,
  type DepositAccountXpubs,
} from '../src/lib/crypto/hd-derivation';
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const BIP_PATHS = {
  BTC: "m/84'/0'/0'/0",
  ETH: "m/44'/60'/0'/0",
  LTC: "m/84'/2'/0'/0",
  TRON: "m/44'/195'/0'/0",
};

function directEvmAddress(root: HDKey, index: number): string {
  const child = root.derive("m/44'/60'/0'/0/" + index);
  const uncompressed = ethers.SigningKey.computePublicKey(child.publicKey!, false);
  const hash = ethers.keccak256(Buffer.from(uncompressed.slice(4), 'hex'));
  return ethers.getAddress('0x' + hash.slice(-40));
}

function directSegwitAddress(root: HDKey, path: string, hrp: string): string {
  const child = root.derive(path);
  const sha256 = crypto.createHash('sha256').update(child.publicKey!).digest();
  const hash160 = crypto.createHash('ripemd160').update(sha256).digest();
  return bech32.encode(hrp, [0, ...bech32.toWords(hash160)]);
}

function directTronAddress(root: HDKey, index: number): string {
  const child = root.derive("m/44'/195'/0'/0/" + index);
  const uncompressed = ethers.SigningKey.computePublicKey(child.publicKey!, false);
  const hash = ethers.keccak256(Buffer.from(uncompressed.slice(4), 'hex'));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(hash.slice(-40), 'hex')]);
  const first = crypto.createHash('sha256').update(payload).digest();
  const second = crypto.createHash('sha256').update(first).digest();
  return bs58.encode(Buffer.concat([payload, second.subarray(0, 4)]));
}

function accountXpub(root: HDKey, path: string): string {
  const account = root.derive(path);
  const result = account.publicExtendedKey;
  account.wipePrivateData();
  return result;
}

describe('Public-only xpub deposit address derivation', () => {
  it('matches independently derived BIP-84/BIP-44 known-index fixtures for all six supported assets', async () => {
    const previousMnemonic = process.env.DEPOSIT_HD_MNEMONIC;
    const previousXpubMode = process.env.PUBLIC_XPUB_DERIVATION_ENABLED;
    delete process.env.PUBLIC_XPUB_DERIVATION_ENABLED;
    process.env.DEPOSIT_HD_MNEMONIC = TEST_MNEMONIC;

    try {
      const seed = await mnemonicToSeed(TEST_MNEMONIC, '');
      const root = HDKey.fromMasterSeed(seed);
      seed.fill(0);

      try {
        for (const index of [1, 7, 316]) {
          const expected = {
            BTC: directSegwitAddress(root, `${BIP_PATHS.BTC}/${index}`, 'bc'),
            ETH: directEvmAddress(root, index),
            LTC: directSegwitAddress(root, `${BIP_PATHS.LTC}/${index}`, 'ltc'),
            USDT_ERC20: directEvmAddress(root, index),
            USDT_BEP20: directEvmAddress(root, index),
            USDT_TRC20: directTronAddress(root, index),
          };
          const xpubs: DepositAccountXpubs = {
            evm: accountXpub(root, "m/44'/60'/0'"),
            btc: accountXpub(root, "m/84'/0'/0'"),
            tron: accountXpub(root, "m/44'/195'/0'"),
            ltc: accountXpub(root, "m/84'/2'/0'"),
          };
          const actual = deriveAllDepositAddressesFromXpubs(xpubs, index);
          assert.deepEqual(actual, expected, `mainnet xpub derivation mismatch at child index ${index}`);
          assert.equal(actual.ETH, actual.USDT_ERC20);
          assert.equal(actual.ETH, actual.USDT_BEP20);
        }
      } finally {
        root.wipePrivateData();
      }
    } finally {
      if (previousMnemonic === undefined) delete process.env.DEPOSIT_HD_MNEMONIC;
      else process.env.DEPOSIT_HD_MNEMONIC = previousMnemonic;
      if (previousXpubMode === undefined) delete process.env.PUBLIC_XPUB_DERIVATION_ENABLED;
      else process.env.PUBLIC_XPUB_DERIVATION_ENABLED = previousXpubMode;
    }
  });

  it('matches the canonical private-root derivation for all supported chains and indices', async () => {
    const mnemonic = generateMnemonic(englishWordlist, 128);
    const seed = await mnemonicToSeed(mnemonic);
    const root = HDKey.fromMasterSeed(seed);
    seed.fill(0);

    try {
      const xpubs: DepositAccountXpubs = {
        evm: accountXpub(root, "m/44'/60'/0'"),
        btc: accountXpub(root, "m/84'/0'/0'"),
        tron: accountXpub(root, "m/44'/195'/0'"),
        ltc: accountXpub(root, "m/84'/2'/0'"),
      };

      for (const index of [1, 316, 317]) {
        const actual = deriveAllDepositAddressesFromXpubs(xpubs, index);

        const evm = directEvmAddress(root, index);
        const btc = directSegwitAddress(root, "m/84'/0'/0'/0/" + index, 'bc');
        const tron = directTronAddress(root, index);
        const ltc = directSegwitAddress(root, "m/84'/2'/0'/0/" + index, 'ltc');

        assert.equal(actual.ETH, evm);
        assert.equal(actual.USDT_ERC20, evm);
        assert.equal(actual.USDT_BEP20, evm);
        assert.equal(actual.BTC, btc);
        assert.equal(actual.USDT_TRC20, tron);
        assert.equal(actual.LTC, ltc);
      }
    } finally {
      root.wipePrivateData();
    }
  });

  it('rejects root keys, private extended keys and non-account-level public keys', async () => {
    const mnemonic = generateMnemonic(englishWordlist, 128);
    const seed = await mnemonicToSeed(mnemonic);
    const root = HDKey.fromMasterSeed(seed);
    seed.fill(0);

    try {
      assert.throws(() => parseDepositAccountXpub(root.publicExtendedKey, 'EVM'));

      const account = root.derive("m/44'/60'/0'");
      assert.throws(() => parseDepositAccountXpub(account.privateExtendedKey, 'EVM'));
      assert.throws(() => parseDepositAccountXpub(account.deriveChild(0).publicExtendedKey, 'EVM'));
      assert.throws(() => parseDepositAccountXpub('not-an-xpub', 'EVM'));
      account.wipePrivateData();
    } finally {
      root.wipePrivateData();
    }
  });

  it('fails closed for missing account xpubs and invalid child indices', async () => {
    const mnemonic = generateMnemonic(englishWordlist, 128);
    const seed = await mnemonicToSeed(mnemonic);
    const root = HDKey.fromMasterSeed(seed);
    seed.fill(0);

    try {
      const xpubs: DepositAccountXpubs = {
        evm: accountXpub(root, "m/44'/60'/0'"),
        btc: accountXpub(root, "m/84'/0'/0'"),
        tron: accountXpub(root, "m/44'/195'/0'"),
        ltc: accountXpub(root, "m/84'/2'/0'"),
      };

      assert.throws(() => deriveAllDepositAddressesFromXpubs({ ...xpubs, ltc: '' }, 1));
      for (const invalidIndex of [-1, 1.5, Number.NaN, 0x80000000, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => deriveAllDepositAddressesFromXpubs(xpubs, invalidIndex));
      }
    } finally {
      root.wipePrivateData();
    }
  });
});
