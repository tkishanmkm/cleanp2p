import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const STANDARD_DERIVATION_PATHS: Record<string, string> = {
  BTC: "m/84'/0'/0'/0",
  ETH: "m/44'/60'/0'/0",
  ERC20: "m/44'/60'/0'/0",
  BSC: "m/44'/60'/0'/0",
  BEP20: "m/44'/60'/0'/0",
  TRX: "m/44'/195'/0'/0",
  TRC20: "m/44'/195'/0'/0",
  LTC: "m/84'/2'/0'/0",
};

const EVM_NETWORKS = new Set(['ETH', 'ERC20', 'BSC', 'BEP20']);
const TRON_NETWORKS = new Set(['TRC20', 'TRX']);

/**
 * Canonical deposit-address provisioning wrapper.
 *
 * All addresses are produced by the canonical account wallet index and the
 * single configured derivation mode. No caller-supplied xpub, private key,
 * shared hot-wallet address, synthetic HMAC address, or generic placeholder
 * is accepted by this module.
 */
export async function getOrProvisionHDDepositAddress(
  userId: string,
  cryptoCode: string,
  networkCode: string,
): Promise<{ address: string; path: string; isNew: boolean }> {
  const asset = String(cryptoCode || '').trim().toUpperCase();
  const network = String(networkCode || '').trim().toUpperCase();

  const pathPrefix = STANDARD_DERIVATION_PATHS[network] || STANDARD_DERIVATION_PATHS[asset];
  if (!pathPrefix) {
    throw new Error('Unsupported deposit asset/network; no fallback address is permitted');
  }

  const provisionResult = await getOrDeriveUserDepositAddresses(userId);
  const walletIndex = provisionResult.walletIndex;

  let address: string;
  let path: string;

  if (asset === 'BTC' || network === 'BTC') {
    address = provisionResult.addresses.BTC;
    path = STANDARD_DERIVATION_PATHS.BTC + '/' + walletIndex;
  } else if (asset === 'LTC' || network === 'LTC') {
    address = provisionResult.addresses.LTC;
    path = STANDARD_DERIVATION_PATHS.LTC + '/' + walletIndex;
  } else if (asset === 'TRX' || TRON_NETWORKS.has(network)) {
    address = provisionResult.addresses.USDT_TRC20;
    path = STANDARD_DERIVATION_PATHS.TRC20 + '/' + walletIndex;
  } else if (asset === 'ETH' || EVM_NETWORKS.has(network) || (asset === 'USDT' && EVM_NETWORKS.has(network)) || (asset === 'USDC' && EVM_NETWORKS.has(network)) || (asset === 'BNB' && EVM_NETWORKS.has(network))) {
    address = provisionResult.addresses.ETH;
    path = (STANDARD_DERIVATION_PATHS[network] || STANDARD_DERIVATION_PATHS.ETH) + '/' + walletIndex;
  } else {
    throw new Error('Unsupported deposit asset/network; no fallback address is permitted');
  }

  if (!address || address.startsWith('addr_')) {
    throw new Error('Canonical wallet provisioning did not return a valid chain address');
  }

  return { address, path, isNew: false };
}
