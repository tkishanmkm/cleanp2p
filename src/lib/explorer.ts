/**
 * Blockchain Explorer URL Generators
 * Generates verified external explorer links for tx hashes and wallet addresses across all supported networks.
 */

export function getTxExplorerUrl(txHash: string | undefined | null, networkOrCoin: string | undefined | null): string | null {
  if (!txHash || typeof txHash !== 'string') return null;
  const hash = txHash.trim();
  if (!hash) return null;

  const net = (networkOrCoin || '').toUpperCase().trim();

  // Bitcoin
  if (net === 'BTC' || net === 'BITCOIN') {
    return `https://mempool.space/tx/${hash}`;
  }

  // Litecoin
  if (net === 'LTC' || net === 'LITECOIN') {
    return `https://blockchair.com/litecoin/transaction/${hash}`;
  }

  // TRON (TRC20 / TRX)
  if (net === 'TRC20' || net === 'TRON' || net === 'TRX') {
    return `https://tronscan.org/#/transaction/${hash}`;
  }

  // Binance Smart Chain
  if (net === 'BEP20' || net === 'BSC' || net === 'BINANCE') {
    return `https://bscscan.com/tx/${hash}`;
  }

  // Polygon
  if (net === 'POLYGON' || net === 'MATIC') {
    return `https://polygonscan.com/tx/${hash}`;
  }

  // Ethereum / EVM Default (ERC20 / ETH / Arbitrum etc.)
  if (hash.startsWith('0x') || net === 'ETH' || net === 'ERC20' || net === 'EVM' || net === 'ETHEREUM') {
    return `https://etherscan.io/tx/${hash}`;
  }

  return `https://mempool.space/tx/${hash}`;
}

export function getAddressExplorerUrl(address: string | undefined | null, networkOrCoin: string | undefined | null): string | null {
  if (!address || typeof address !== 'string') return null;
  const addr = address.trim();
  if (!addr) return null;

  const net = (networkOrCoin || '').toUpperCase().trim();

  // Bitcoin
  if (net === 'BTC' || net === 'BITCOIN' || addr.startsWith('bc1') || addr.startsWith('1') || addr.startsWith('3')) {
    return `https://mempool.space/address/${addr}`;
  }

  // Litecoin
  if (net === 'LTC' || net === 'LITECOIN' || addr.startsWith('ltc1') || addr.startsWith('L') || addr.startsWith('M')) {
    return `https://blockchair.com/litecoin/address/${addr}`;
  }

  // TRON
  if (net === 'TRC20' || net === 'TRON' || net === 'TRX' || addr.startsWith('T')) {
    return `https://tronscan.org/#/address/${addr}`;
  }

  // BSC
  if (net === 'BEP20' || net === 'BSC') {
    return `https://bscscan.com/address/${addr}`;
  }

  // Polygon
  if (net === 'POLYGON' || net === 'MATIC') {
    return `https://polygonscan.com/address/${addr}`;
  }

  // Ethereum / EVM
  return `https://etherscan.io/address/${addr}`;
}
