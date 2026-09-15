import * as bip39 from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import TronWeb from 'tronweb';
import crypto from 'crypto';
import bs58 from 'bs58';

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

export async function deriveUserKeys(mnemonic: string, index: number) {
  if (!mnemonic || !mnemonic.trim()) {
    throw new Error('DEPOSIT_HD_MNEMONIC is not configured');
  }

  const seed = await bip39.mnemonicToSeed(mnemonic.trim(), '');
  const masterNode = HDKey.fromMasterSeed(seed);

  // 1. EVM (ETH, BSC, Polygon) -> m/44'/60'/0'/0/index
  const evmNode = masterNode.derive(`m/44'/60'/0'/0/${index}`);
  const evmPrivateKey = ethers.hexlify(evmNode.privateKey!);
  const evmWallet = new ethers.Wallet(evmPrivateKey);

  // 2. BTC Native SegWit -> m/84'/0'/0'/0/index
  const btcNode = masterNode.derive(`m/84'/0'/0'/0/${index}`);
  const { address: btcAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(btcNode.publicKey!),
    network: bitcoin.networks.bitcoin,
  });

  // 3. TRON (TRC20) -> m/44'/195'/0'/0/index
  const tronNode = masterNode.derive(`m/44'/195'/0'/0/${index}`);
  const tronPrivateKey = bytesToHex(tronNode.privateKey!);
  const tronAddress = deriveTronAddressFromPrivateKey(tronPrivateKey);

  // 4. LTC Native SegWit -> m/84'/2'/0'/0/index
  const ltcNode = masterNode.derive(`m/84'/2'/0'/0/${index}`);
  const { address: ltcAddress } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(ltcNode.publicKey!),
    network: LTC_NETWORK as any,
  });

  return {
    index,
    evm: { address: evmWallet.address, privateKey: evmPrivateKey },
    btc: { address: btcAddress!, privateKey: bytesToHex(btcNode.privateKey!) },
    tron: { address: tronAddress, privateKey: tronPrivateKey },
    ltc: { address: ltcAddress!, privateKey: bytesToHex(ltcNode.privateKey!) },
  };
}
