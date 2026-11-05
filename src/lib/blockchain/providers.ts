import { ethers } from 'ethers';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com'),
});

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
    // Mainnet payout contract is intentionally fixed: environment overrides could route withdrawals into counterfeit tokens.
    usdtContractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
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
    // BSC mainnet USDT contract is fixed to prevent counterfeit-token payouts.
    usdtContractAddress: '0x55d398326f99059fF775485246999027B3197955',
    usdtDecimals: 18, // BSC USDT uses 18 decimals
  },
};

// Map shorthand aliases to standard network keys
export function normalizeNetworkCode(network: string): string {
  const norm = (network || '').toUpperCase().trim();

  const aliasMap: Record<string, string> = {
    ETH: 'ERC20',
    ETHEREUM: 'ERC20',
    MAINNET: 'ERC20',
    ERC20: 'ERC20',
    BSC: 'BEP20',
    BINANCE: 'BEP20',
    BNB: 'BEP20',
    BEP20: 'BEP20',
    TRON: 'TRC20',
    TRX: 'TRC20',
    TRC20: 'TRC20',
    BTC: 'BTC',
    BITCOIN: 'BTC',
    LTC: 'LTC',
    LITECOIN: 'LTC',
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
    process.env.EVM_HOT_WALLET_PRIVATE_KEY;

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
 * Fail-closed evidence check for a completed EVM withdrawal. A successful receipt
 * alone is insufficient: verify chain, transaction target/value and the exact
 * token Transfer event before releasing the reserved withdrawal liability.
 */
export async function verifyEvmWithdrawalEvidence(params: {
  provider: ethers.JsonRpcProvider;
  txHash: string;
  network: string;
  assetSymbol: string;
  destinationAddress: string;
  amount: string | number;
  expectedSender?: string | null;
}): Promise<{ verified: boolean; reason: string }> {
  try {
    const networkCode = normalizeNetworkCode(params.network);
    const chain = SUPPORTED_EVM_CHAINS[networkCode];
    if (!chain) return { verified: false, reason: 'unsupported_evm_network' };
    if (!ethers.isAddress(params.destinationAddress)) return { verified: false, reason: 'invalid_destination' };
    const actualNetwork = await params.provider.getNetwork();
    if (actualNetwork.chainId !== BigInt(chain.chainId)) return { verified: false, reason: 'provider_chain_id_mismatch' };
    const tx = await params.provider.getTransaction(params.txHash);
    const receipt = await params.provider.getTransactionReceipt(params.txHash);
    if (!tx || !receipt || receipt.status !== 1 || tx.hash.toLowerCase() !== params.txHash.toLowerCase()) {
      return { verified: false, reason: 'transaction_or_success_receipt_missing' };
    }
    if (tx.chainId !== BigInt(chain.chainId)) return { verified: false, reason: 'transaction_chain_id_mismatch' };
    if (!params.expectedSender || !ethers.isAddress(params.expectedSender)) {
      return { verified: false, reason: 'expected_hot_wallet_unavailable' };
    }
    if (tx.from.toLowerCase() !== params.expectedSender.toLowerCase()) {
      return { verified: false, reason: 'sender_mismatch' };
    }
    const asset = params.assetSymbol.toUpperCase().trim();
    const isNative = asset === chain.nativeSymbol;
    const expectedAmount = ethers.parseUnits(String(params.amount), isNative ? chain.nativeDecimals : getTokenDecimals(networkCode, asset));
    if (expectedAmount <= 0n) return { verified: false, reason: 'invalid_expected_amount' };
    if (isNative) {
      if (!tx.to || tx.to.toLowerCase() !== params.destinationAddress.toLowerCase() || tx.value !== expectedAmount || tx.data !== '0x') {
        return { verified: false, reason: 'native_transfer_mismatch' };
      }
      return { verified: true, reason: 'verified_native_transfer' };
    }
    const tokenAddress = getTokenContractAddress(networkCode, asset);
    if (!tokenAddress || !tx.to || tx.to.toLowerCase() !== tokenAddress.toLowerCase()) {
      return { verified: false, reason: 'token_contract_mismatch' };
    }
    const iface = new ethers.Interface(ERC20_ABI);
    let exactTransferCount = 0;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name !== 'Transfer') continue;
        const from = String(parsed.args.from);
        const to = String(parsed.args.to);
        const value = BigInt(parsed.args.value);
        if (params.expectedSender && from.toLowerCase() !== params.expectedSender.toLowerCase()) continue;
        if (to.toLowerCase() === params.destinationAddress.toLowerCase() && value === expectedAmount) exactTransferCount++;
      } catch { /* Ignore unrelated logs; exact matching event is required below. */ }
    }
    if (exactTransferCount !== 1) return { verified: false, reason: 'exact_token_transfer_event_missing_or_ambiguous' };
    return { verified: true, reason: 'verified_token_transfer' };
  } catch {
    return { verified: false, reason: 'verification_unavailable' };
  }
}

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

export type FinalizedEvmWithdrawalReceiptProof =
  | {
      verified: true;
      network: string;
      chainId: number;
      txHash: string;
      receiptStatus: 0 | 1;
      blockNumber: number;
      blockHash: string;
      confirmations: number;
      gasUsed: string;
      effectiveGasPrice: string;
      actualGasAmount: string;
      transactionNonce: number;
      signerAddress: string;
    }
  | { verified: false; reason: string };

/**
 * Builds a durable EVM withdrawal receipt proof only after checking transaction
 * identity, configured chain, sender/nonce, canonical block hash and finality.
 * A successful proof still requires the separate exact payout/event check.
 */
export async function getFinalizedEvmWithdrawalReceiptProof(params: {
  provider: ethers.JsonRpcProvider;
  txHash: string;
  network: string;
  expectedSender: string;
  expectedNonce: number;
}): Promise<FinalizedEvmWithdrawalReceiptProof> {
  try {
    const network = normalizeNetworkCode(params.network);
    const chain = SUPPORTED_EVM_CHAINS[network];
    if (!chain) return { verified: false, reason: 'unsupported_evm_network' };
    if (!/^0x[a-fA-F0-9]{64}$/.test(params.txHash)) {
      return { verified: false, reason: 'invalid_transaction_hash' };
    }
    if (!ethers.isAddress(params.expectedSender) || !Number.isSafeInteger(params.expectedNonce) || params.expectedNonce < 0) {
      return { verified: false, reason: 'expected_signer_or_nonce_unavailable' };
    }

    const [actualNetwork, tx, receipt] = await Promise.all([
      params.provider.getNetwork(),
      params.provider.getTransaction(params.txHash),
      params.provider.getTransactionReceipt(params.txHash),
    ]);
    if (actualNetwork.chainId !== BigInt(chain.chainId)) {
      return { verified: false, reason: 'provider_chain_id_mismatch' };
    }
    if (!tx || !receipt || tx.hash.toLowerCase() !== params.txHash.toLowerCase()) {
      return { verified: false, reason: 'transaction_or_receipt_missing' };
    }
    if (tx.chainId !== BigInt(chain.chainId)) {
      return { verified: false, reason: 'transaction_chain_id_mismatch' };
    }
    if (tx.from.toLowerCase() !== params.expectedSender.toLowerCase()) {
      return { verified: false, reason: 'transaction_signer_mismatch' };
    }
    if (tx.nonce !== params.expectedNonce) {
      return { verified: false, reason: 'transaction_nonce_mismatch' };
    }
    if (receipt.status !== 0 && receipt.status !== 1) {
      return { verified: false, reason: 'receipt_status_unknown' };
    }
    if (!receipt.blockHash || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
      return { verified: false, reason: 'receipt_block_identity_missing' };
    }

    const [currentBlock, canonicalBlock] = await Promise.all([
      params.provider.getBlockNumber(),
      params.provider.getBlock(receipt.blockNumber),
    ]);
    if (!canonicalBlock?.hash || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      return { verified: false, reason: 'receipt_block_not_canonical' };
    }

    const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);
    if (confirmations < chain.requiredConfirmations) {
      return { verified: false, reason: 'receipt_finality_threshold_not_met' };
    }

    const effectiveGasPrice = receipt.gasPrice ?? tx.gasPrice;
    if (!effectiveGasPrice || effectiveGasPrice <= 0n || receipt.gasUsed <= 0n) {
      return { verified: false, reason: 'receipt_fee_measurement_unavailable' };
    }
    const actualGasAmount = ethers.formatEther(receipt.gasUsed * effectiveGasPrice);

    return {
      verified: true,
      network,
      chainId: chain.chainId,
      txHash: tx.hash,
      receiptStatus: receipt.status as 0 | 1,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: effectiveGasPrice.toString(),
      actualGasAmount,
      transactionNonce: tx.nonce,
      signerAddress: tx.from,
    };
  } catch {
    return { verified: false, reason: 'receipt_proof_verification_unavailable' };
  }
}

/**
 * Calculates confirmations and actual gas cost for an on-chain transaction
 */
export async function getTransactionConfirmations(
  provider: ethers.JsonRpcProvider,
  txHash: string
): Promise<{ confirmations: number; blockNumber?: number; status?: number; actualGasCost?: string }> {
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || !receipt.blockNumber) {
      return { confirmations: 0 };
    }

    const [currentBlock, canonicalBlock] = await Promise.all([
      provider.getBlockNumber(),
      provider.getBlock(receipt.blockNumber),
    ]);
    // A receipt returned by an RPC may refer to an orphaned block after a reorg.
    // Treat missing/mismatched canonical block data as unconfirmed for both payout and refund.
    if (!canonicalBlock?.hash || !receipt.blockHash || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      return { confirmations: 0 };
    }
    const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);

    // Ethers v6 TransactionReceipt exposes gasPrice; compute actual gas cost.
    let actualGasCost: string | undefined;
    try {
      const gasPrice = receipt.gasPrice ?? 0n;
      const gasCostWei = receipt.gasUsed * gasPrice;
      actualGasCost = ethers.formatEther(gasCostWei);
    } catch {
      actualGasCost = undefined;
    }

    return {
      confirmations,
      blockNumber: receipt.blockNumber,
      status: receipt.status ?? undefined,
      actualGasCost,
    };
  } catch (err) {
    return { confirmations: 0 };
  }
}
