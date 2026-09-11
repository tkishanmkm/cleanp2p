import { ethers } from 'ethers';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import TronWeb from 'tronweb';

export interface DerivedWallets {
  walletIndex: number;
  evmAddress: string;
  tronAddress: string;
  btcAddress: string;
  ltcAddress: string;
}

/**
 * Derives HD addresses for EVM, TRON, BTC, and LTC from a master mnemonic.
 * MUST ONLY RUN ON SERVER-SIDE. NEVER EXPOSE MNEMONIC TO CLIENT.
 */
export function deriveUserWallets(walletIndex: number): DerivedWallets {
  const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
  if (!mnemonic) {
    throw new Error('DEPOSIT_HD_MNEMONIC environment variable is missing.');
  }

  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // 1. EVM (Ethereum, BSC, Polygon) -> Path: m/44'/60'/0'/0/index
  const evmNode = ethers.HDNodeWallet.fromSeed(seed).derivePath(`m/44'/60'/0'/0/${walletIndex}`);
  const evmAddress = evmNode.address;

  // 2. TRON (TRC-20 USDT / TRX) -> Path: m/44'/195'/0'/0/index
  const tronNode = ethers.HDNodeWallet.fromSeed(seed).derivePath(`m/44'/195'/0'/0/${walletIndex}`);
  const tronAddress = (TronWeb as any).address?.fromPrivateKey
    ? (TronWeb as any).address.fromPrivateKey(tronNode.privateKey.substring(2))
    : TronWeb.address.fromPrivateKey(tronNode.privateKey.substring(2));

  // 3. Bitcoin (Native SegWit BIP-84 Bech32) -> Path: m/84'/0'/0'/0/index
  const btcNode = ethers.HDNodeWallet.fromSeed(seed).derivePath(`m/84'/0'/0'/0/${walletIndex}`);
  const btcPayment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(ethers.getBytes(btcNode.publicKey)),
    network: bitcoin.networks.bitcoin,
  });
  const btcAddress = btcPayment.address!;

  // 4. Litecoin (Native SegWit BIP-84 Bech32) -> Path: m/84'/2'/0'/0/index
  const ltcNetwork = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: { public: 0x019da462, private: 0x019d9fed },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  };
  const ltcNode = ethers.HDNodeWallet.fromSeed(seed).derivePath(`m/84'/2'/0'/0/${walletIndex}`);
  const ltcPayment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(ethers.getBytes(ltcNode.publicKey)),
    network: ltcNetwork,
  });
  const ltcAddress = ltcPayment.address!;

  return {
    walletIndex,
    evmAddress,
    tronAddress,
    btcAddress,
    ltcAddress,
  };
}
