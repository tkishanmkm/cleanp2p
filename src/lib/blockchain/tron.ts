import { TronWeb } from 'tronweb';

export interface TronConfig {
  fullHost: string;
  apiKey?: string;
  usdtContract: string;
  usdtDecimals: number;
  requiredConfirmations: number;
}

export const TRON_CONFIG: TronConfig = {
  fullHost: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
  apiKey: process.env.TRON_GRID_API_KEY || process.env.TRONGRID_API_KEY,
  usdtContract: process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  usdtDecimals: 6,
  requiredConfirmations: 19,
};

let cachedTronWeb: TronWeb | null = null;

/**
 * Initializes and returns a singleton TronWeb instance.
 * Securely reads private keys with zero console exposure.
 */
export function getTronWeb(withSigner: boolean = false): TronWeb {
  const privateKey = withSigner
    ? (process.env.TRON_HOT_WALLET_PRIVATE_KEY || process.env.HOT_WALLET_PRIVATE_KEY || '').trim().replace(/^0x/, '')
    : undefined;

  const headers: Record<string, string> = {};
  if (TRON_CONFIG.apiKey) {
    headers['TRON-PRO-API-KEY'] = TRON_CONFIG.apiKey;
  }

  // Create or update instance
  if (!cachedTronWeb || withSigner) {
    const instance = new TronWeb({
      fullHost: TRON_CONFIG.fullHost,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      privateKey: privateKey && privateKey.length === 64 ? privateKey : undefined,
    });

    if (!withSigner) {
      cachedTronWeb = instance;
    }
    return instance;
  }

  return cachedTronWeb;
}

/**
 * Validates a base58 TRON address
 */
export function isValidTronAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  try {
    const tronWeb = getTronWeb(false);
    return tronWeb.isAddress(address.trim());
  } catch {
    return false;
  }
}

/**
 * Converts human readable token amount to base atomic units with specified decimals
 */
export function parseUnitsTron(amount: string | number, decimals: number = 6): bigint {
  const [whole, fraction = ''] = amount.toString().trim().split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole || '0'}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  return BigInt(combined || '0');
}

/**
 * Executes an outbound TRC-20 token transfer from the hot wallet
 */
export async function sendTrc20Transfer(params: {
  toAddress: string;
  amount: string | number;
  contractAddress?: string;
}): Promise<{ txHash: string; broadcasted: boolean }> {
  const { toAddress, amount, contractAddress = TRON_CONFIG.usdtContract } = params;

  if (!isValidTronAddress(toAddress)) {
    throw new Error(`Invalid TRON destination address: ${toAddress}`);
  }

  const tronWeb = getTronWeb(true);
  if (!tronWeb.defaultPrivateKey) {
    throw new Error('TRON hot wallet private key is not configured');
  }

  const rawAmount = parseUnitsTron(amount, TRON_CONFIG.usdtDecimals).toString();

  // Load contract and call transfer method
  const contract = await tronWeb.contract().at(contractAddress);
  const txHash = await contract.methods.transfer(toAddress, rawAmount).send();

  if (!txHash || typeof txHash !== 'string') {
    throw new Error('TRON TRC20 transfer failed to produce transaction hash');
  }

  return { txHash, broadcasted: true };
}

/**
 * Executes a native TRX transfer from the hot wallet
 */
export async function sendTrxTransfer(params: {
  toAddress: string;
  amountInTrx: string | number;
}): Promise<{ txHash: string; broadcasted: boolean }> {
  const { toAddress, amountInTrx } = params;

  if (!isValidTronAddress(toAddress)) {
    throw new Error(`Invalid TRON destination address: ${toAddress}`);
  }

  const tronWeb = getTronWeb(true);
  if (!tronWeb.defaultPrivateKey) {
    throw new Error('TRON hot wallet private key is not configured');
  }

  const sunAmount = parseUnitsTron(amountInTrx, 6).toString();
  const tx = await tronWeb.trx.sendTransaction(toAddress, Number(sunAmount));

  if (!tx.result || !tx.transaction?.txID) {
    throw new Error('TRON native TRX transfer rejected by network');
  }

  return { txHash: tx.transaction.txID, broadcasted: true };
}

/**
 * Checks confirmations and execution status of a TRON transaction
 */
export async function getTronTransactionConfirmations(txHash: string): Promise<{
  confirmations: number;
  isConfirmed: boolean;
  success: boolean;
  blockNumber?: number;
}> {
  try {
    const tronWeb = getTronWeb(false);

    // Get transaction info
    const txInfo = await tronWeb.trx.getTransactionInfo(txHash);
    if (!txInfo || !txInfo.blockNumber) {
      return { confirmations: 0, isConfirmed: false, success: false };
    }

    // Get current block
    const currentBlock = await tronWeb.trx.getCurrentBlock();
    const currentHeight = currentBlock.block_header?.raw_data?.number;

    if (!currentHeight) {
      return { confirmations: 1, isConfirmed: false, success: !txInfo.receipt?.result };
    }

    const confirmations = Math.max(0, currentHeight - txInfo.blockNumber + 1);
    const success = !txInfo.receipt?.result || txInfo.receipt.result === 'SUCCESS';

    return {
      confirmations,
      isConfirmed: confirmations >= TRON_CONFIG.requiredConfirmations && success,
      success,
      blockNumber: txInfo.blockNumber,
    };
  } catch (err) {
    return { confirmations: 0, isConfirmed: false, success: false };
  }
}
