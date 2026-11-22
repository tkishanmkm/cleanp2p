import 'server-only';
import * as bip39 from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import TronWeb from 'tronweb';
import crypto from 'crypto';
import bs58 from 'bs58';
import { normalizeAndValidateDepositMnemonic, validateWalletDerivationIndex } from '@/lib/crypto/mnemonic-validation';

export const LTC_NETWORK = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wsdl: 0x80,
};

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Robust Tron address derivation from private key or uncompressed public key point
 */
export function deriveTronAddressFromPrivateKey(privateKeyHex: string, uncompressedPublicKeyHex?: string): string {
  try {
    const tw = TronWeb as any;
    if (tw?.address?.fromPrivateKey) {
      const addr = tw.address.fromPrivateKey(privateKeyHex);
      if (typeof addr === 'string' && addr.startsWith('T')) return addr;
    }
    if (tw?.default?.address?.fromPrivateKey) {
      const addr = tw.default.address.fromPrivateKey(privateKeyHex);
      if (typeof addr === 'string' && addr.startsWith('T')) return addr;
    }
  } catch {
    // Fall back to standard cryptographic derivation below
  }

  // Cryptographic fallback: 0x41 + Keccak256(pubKeyBytes)[-20] with Base58Check
  let pubBytes: Buffer;
  if (uncompressedPublicKeyHex) {
    const rawHex = uncompressedPublicKeyHex.startsWith('0x04')
      ? uncompressedPublicKeyHex.slice(4)
      : uncompressedPublicKeyHex.startsWith('0x')
      ? uncompressedPublicKeyHex.slice(2)
      : uncompressedPublicKeyHex;
    pubBytes = Buffer.from(rawHex.slice(-128), 'hex');
  } else {
    const signingKey = new ethers.SigningKey(`0x${privateKeyHex}`);
    const uncompressed = signingKey.publicKey;
    pubBytes = Buffer.from(uncompressed.slice(4), 'hex');
  }

  const hash = ethers.keccak256(pubBytes);
  const tronRawAddress = Buffer.concat([
    Buffer.from([0x41]),
    Buffer.from(hash.slice(-40), 'hex'),
  ]);

  const h1 = crypto.createHash('sha256').update(tronRawAddress).digest();
  const h2 = crypto.createHash('sha256').update(h1).digest();
  const checksum = h2.subarray(0, 4);

  return bs58.encode(Buffer.concat([tronRawAddress, checksum]));
}

/**
 * Dynamic EVM derivation matching BIP-44 path m/44'/60'/0'/0/${index}
 */
export function deriveEvmAddress(mnemonic: string, index: number): string {
  validateWalletDerivationIndex(index);
  const normalizedMnemonic = normalizeAndValidateDepositMnemonic(mnemonic);
  const seed = bip39.mnemonicToSeedSync(normalizedMnemonic);
  let masterNode: any;
  let childNode: any;

  try {
    masterNode = HDKey.fromMasterSeed(seed);
    childNode = masterNode.derive(`m/44'/60'/0'/0/${index}`);
    if (!childNode.publicKey) {
      throw new Error('EVM child public key could not be derived.');
    }

    const uncompressedHex = ethers.SigningKey.computePublicKey(childNode.publicKey, false);
    const publicKeyBytes = Buffer.from(uncompressedHex.slice(4), 'hex');
    const addressHash = ethers.keccak256(publicKeyBytes);
    return ethers.getAddress(`0x${addressHash.slice(-40)}`);
  } finally {
    childNode?.wipePrivateData?.();
    masterNode?.wipePrivateData?.();
    seed.fill(0);
  }
}

export async function deriveUserKeys(mnemonic: string, index: number) {
  validateWalletDerivationIndex(index);
  const normalizedMnemonic = normalizeAndValidateDepositMnemonic(mnemonic);
  const seed = await bip39.mnemonicToSeed(normalizedMnemonic, '');
  let masterNode: any;
  const childNodes: any[] = [];

  try {
    masterNode = HDKey.fromMasterSeed(seed);

    // 1. EVM (ETH, BSC, Polygon) -> m/44'/60'/0'/0/index
    const evmNode = masterNode.derive(`m/44'/60'/0'/0/${index}`);
    childNodes.push(evmNode);
    if (!evmNode.privateKey || !evmNode.publicKey) throw new Error('EVM child key derivation failed.');
    const evmPrivateKey = ethers.hexlify(evmNode.privateKey);
    const evmWallet = new ethers.Wallet(evmPrivateKey);

    // 2. BTC Native SegWit -> m/84'/0'/0'/0/index
    const btcNode = masterNode.derive(`m/84'/0'/0'/0/${index}`);
    childNodes.push(btcNode);
    if (!btcNode.privateKey || !btcNode.publicKey) throw new Error('BTC child key derivation failed.');
    const { address: btcAddress } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(btcNode.publicKey),
      network: bitcoin.networks.bitcoin,
    });

    // 3. TRON (TRC20) -> m/44'/195'/0'/0/index
    const tronNode = masterNode.derive(`m/44'/195'/0'/0/${index}`);
    childNodes.push(tronNode);
    if (!tronNode.privateKey || !tronNode.publicKey) throw new Error('TRON child key derivation failed.');
    const tronPrivateKey = bytesToHex(tronNode.privateKey);
    const tronAddress = deriveTronAddressFromPrivateKey(tronPrivateKey);

    // 4. LTC Native SegWit -> m/84'/2'/0'/0/index
    const ltcNode = masterNode.derive(`m/84'/2'/0'/0/${index}`);
    childNodes.push(ltcNode);
    if (!ltcNode.privateKey || !ltcNode.publicKey) throw new Error('LTC child key derivation failed.');
    const { address: ltcAddress } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(ltcNode.publicKey),
      network: LTC_NETWORK as any,
    });

    return {
      index,
      evm: { address: evmWallet.address, privateKey: evmPrivateKey },
      btc: { address: btcAddress!, privateKey: bytesToHex(btcNode.privateKey) },
      tron: { address: tronAddress, privateKey: tronPrivateKey },
      ltc: { address: ltcAddress!, privateKey: bytesToHex(ltcNode.privateKey) },
    };
  } finally {
    for (const child of childNodes) child.wipePrivateData?.();
    masterNode?.wipePrivateData?.();
    seed.fill(0);
  }
}
