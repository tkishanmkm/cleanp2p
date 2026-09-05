import { ethers } from 'ethers';

export interface ChainConfig {
  chainId: number;
  name: string;
  networkCode: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrls: string[];
  blockExplorer: string;
  isTestnet: boolean;
  requiredConfirmations: number;
  usdtContractAddress?: string;
  usdtDecimals?: number;
}

export const SUPPORTED_EVM_CHAINS: Record<string, ChainConfig> = {
  ERC20: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    networkCode: 'ERC20',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrls: [
      process.env.ETH_RPC_URL || '',
      process.env.EVM_RPC_URL || '',
      'https://cloudflare-eth.com',
      'https://eth.llamarpc.com',
    ].filter(Boolean),
    blockExplorer: 'https://etherscan.io',
    isTestnet: false,
    requiredConfirmations: 12,
    usdtContractAddress: process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    usdtDecimals: 6,
  },
  SEPOLIA: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    networkCode: 'SEPOLIA',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcUrls: [
      process.env.SEPOLIA_RPC_URL || '',
      'https://rpc.sepolia.org',
      'https://ethereum-sepolia-rpc.publicnode.com',
    ].filter(Boolean),
    blockExplorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    requiredConfirmations: 3,
    usdtContractAddress: process.env.USDT_CONTRACT_SEPOLIA || '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
    usdtDecimals: 6,
  },
  BEP20: {
    chainId: 56,
    name: 'BNB Smart Chain',
    networkCode: 'BEP20',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    rpcUrls: [
      process.env.BSC_RPC_URL || '',
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://binance.llamarpc.com',
    ].filter(Boolean),
    blockExplorer: 'https://bscscan.com',
    isTestnet: false,
    requiredConfirmations: 15,
    usdtContractAddress: process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955',
    usdtDecimals: 18, // BSC USDT uses 18 decimals
  },
  POLYGON: {
    chainId: 137,
    name: 'Polygon PoS',
    networkCode: 'POLYGON',
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    rpcUrls: [
      process.env.POLYGON_RPC_URL || '',
      'https://polygon-rpc.com',
      'https://polygon.llamarpc.com',
    ].filter(Boolean),
    blockExplorer: 'https://polygonscan.com',
    isTestnet: false,
    requiredConfirmations: 128,
    usdtContractAddress: process.env.USDT_CONTRACT_POLYGON || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    usdtDecimals: 6,
  },
};

// Map shorthand aliases to standard network keys
export function normalizeNetworkCode(network: string): string {
  const norm = network.toUpperCase().trim();
  const aliasMap: Record<string, string> = {
    ETH: 'ERC20',
    ETHEREUM: 'ERC20',
    MAINNET: 'ERC20',
    BSC: 'BEP20',
    BINANCE: 'BEP20',
    BNB: 'BEP20',
    MATIC: 'POLYGON',
    POL: 'POLYGON',
    TRON: 'TRC20',
    TRX: 'TRC20',
  };
  return aliasMap[norm] || norm;
}

/**
 * Cache providers per network to avoid repeated TCP connection creation
 */
const providerCache = new Map<string, ethers.JsonRpcProvider>();

/**
 * Retrieves an ethers.v6 JsonRpcProvider for a given network
 */
export function getEvmProvider(network: string): ethers.JsonRpcProvider {
  const normalized = normalizeNetworkCode(network);
  const cached = providerCache.get(normalized);
  if (cached) {
    return cached;
  }

  const config = SUPPORTED_EVM_CHAINS[normalized];
  if (!config) {
    // Fallback to default EVM RPC
    const defaultUrl = process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    const provider = new ethers.JsonRpcProvider(defaultUrl);
    providerCache.set(normalized, provider);
    return provider;
  }

  const primaryRpc = config.rpcUrls[0];
  const provider = new ethers.JsonRpcProvider(primaryRpc, {
    chainId: config.chainId,
    name: config.name,
  });

  providerCache.set(normalized, provider);
  return provider;
}

/**
 * Retrieves the hot wallet EVM signer with private key isolation.
 * Keys are read securely from process.env and never logged or exposed.
 */
export function getEvmHotWalletSigner(network: string = 'ERC20'): {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet | null;
  address: string | null;
} {
  const provider = getEvmProvider(network);

  const rawKey =
    process.env.HOT_WALLET_PRIVATE_KEY ||
    process.env.EVM_HOT_WALLET_PRIVATE_KEY ||
    (normalizeNetworkCode(network) === 'SEPOLIA' ? process.env.SEPOLIA_PRIVATE_KEY : undefined);

  if (!rawKey || rawKey.trim().length === 0) {
    return { provider, signer: null, address: null };
  }

  try {
    const cleanKey = rawKey.trim().startsWith('0x') ? rawKey.trim() : `0x${rawKey.trim()}`;
    const signer = new ethers.Wallet(cleanKey, provider);
    return { provider, signer, address: signer.address };
  } catch (err) {
    console.error(`[Security Alert] Invalid hot wallet key format for network ${network}`);
    return { provider, signer: null, address: null };
  }
}

/**
 * Standard ERC-20 Minimal ABI
 */
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

/**
 * Dynamically resolves token decimals for accurate unit calculations
 */
export function getTokenDecimals(network: string, assetSymbol: string): number {
  const normAsset = assetSymbol.toUpperCase().trim();
  const normNetwork = normalizeNetworkCode(network);

  if (normAsset === 'USDT') {
    const chain = SUPPORTED_EVM_CHAINS[normNetwork];
    return chain?.usdtDecimals ?? 6;
  }
  if (normAsset === 'USDC') return 6;
  if (normAsset === 'WBTC' || normAsset === 'BTC') return 8;
  return 18; // Default native and standard ERC-20
}

/**
 * Dynamically resolves token contract address
 */
export function getTokenContractAddress(network: string, assetSymbol: string): string | null {
  const normAsset = assetSymbol.toUpperCase().trim();
  const normNetwork = normalizeNetworkCode(network);

  if (normAsset === 'USDT') {
    const chain = SUPPORTED_EVM_CHAINS[normNetwork];
    return chain?.usdtContractAddress || null;
  }

  return null;
}

/**
 * Computes EIP-1559 gas fee parameters with priority fee buffer to prevent stuck mempool transactions
 */
export async function getEip1559FeeOverrides(
  provider: ethers.JsonRpcProvider,
  multiplier: number = 1.25
): Promise<{
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}> {
  try {
    const feeData = await provider.getFeeData();

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      const priorityBuffer = (feeData.maxPriorityFeePerGas * BigInt(Math.round(multiplier * 100))) / 100n;
      const baseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
      const bufferedBaseFee = (baseFee * BigInt(Math.round(multiplier * 100))) / 100n;
      const maxFee = bufferedBaseFee + priorityBuffer;

      return {
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priorityBuffer,
      };
    }

    if (feeData.gasPrice) {
      const bufferedGasPrice = (feeData.gasPrice * BigInt(Math.round(multiplier * 100))) / 100n;
      return { gasPrice: bufferedGasPrice };
    }
  } catch (err) {
    console.warn('[Fee Estimation] Failed to fetch live fee data, falling back to network standard:', err);
  }

  return {};
}

/**
 * Calculates confirmations for an on-chain transaction
 */
export async function getTransactionConfirmations(
  provider: ethers.JsonRpcProvider,
  txHash: string
): Promise<{ confirmations: number; blockNumber?: number; status?: number }> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || !receipt.blockNumber) {
      return { confirmations: 0 };
    }

    const currentBlock = await provider.getBlockNumber();
    const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);

    return {
      confirmations,
      blockNumber: receipt.blockNumber,
      status: receipt.status ?? undefined,
    };
  } catch (err) {
    return { confirmations: 0 };
  }
}
