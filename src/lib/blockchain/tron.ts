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
  // TRON mainnet USDT contract is fixed to prevent counterfeit-token payouts.
  usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
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
 * Converts a strictly positive decimal amount to atomic units without rounding.
 * Rejects signs, exponent notation, zero, invalid decimals, and excess precision.
 */
export function parseUnitsTron(amount: string | number, decimals: number = 6): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Invalid token decimal precision');
  }

  const text = String(amount).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new Error('Amount must be a plain positive decimal number');
  }

  const whole = match[1];
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new Error(`Amount exceeds supported precision of ${decimals} decimal places`);
  }

  const atomic = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt((fraction.padEnd(decimals, '0') || '0'));
  if (atomic <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  return atomic;
}

/**
 * Builds and signs a TRC-20 transfer without broadcasting it.
 * The caller must durably persist signedTransaction and txHash before sending
 * the transaction to a public node.
 */
export async function prepareSignedTrc20Transfer(params: {
  toAddress: string;
  amount: string | number;
  contractAddress?: string;
}): Promise<{
  txHash: string;
  signedTransaction: Record<string, unknown>;
  signerAddress: string;
}> {
  const { toAddress, amount, contractAddress } = params;

  if (contractAddress && contractAddress !== TRON_CONFIG.usdtContract) {
    throw new Error('Unapproved TRC20 token contract; refusing to sign');
  }
  if (!isValidTronAddress(toAddress)) {
    throw new Error(`Invalid TRON destination address: ${toAddress}`);
  }

  const tronWeb = getTronWeb(true);
  if (!tronWeb.defaultPrivateKey) {
    throw new Error('TRON hot wallet private key is not configured');
  }

  const signerAddress = tronWeb.defaultAddress?.base58;
  if (!signerAddress || !isValidTronAddress(signerAddress)) {
    throw new Error('TRON hot wallet address is unavailable');
  }

  const rawAmount = parseUnitsTron(amount, TRON_CONFIG.usdtDecimals).toString();
  const prepared = await tronWeb.transactionBuilder.triggerSmartContract(
    TRON_CONFIG.usdtContract,
    'transfer(address,uint256)',
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: 'address', value: toAddress },
      { type: 'uint256', value: rawAmount },
    ],
    tronWeb.address.toHex(signerAddress)
  );

  if (!prepared?.result?.result || !prepared?.transaction) {
    throw new Error('TRON node did not create a valid TRC-20 transfer transaction');
  }

  const signedTransaction = await tronWeb.trx.sign(
    prepared.transaction,
    tronWeb.defaultPrivateKey
  );
  const txHash = String((signedTransaction as any)?.txID || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txHash)) {
    throw new Error('Signed TRON transaction has an invalid transaction ID');
  }
  if (!Array.isArray((signedTransaction as any)?.signature) || (signedTransaction as any).signature.length === 0) {
    throw new Error('TRON transaction signing did not produce a signature');
  }

  return {
    txHash,
    signedTransaction: signedTransaction as unknown as Record<string, unknown>,
    signerAddress,
  };
}

/**
 * Broadcasts an already-signed TRON transaction. It never signs or changes bytes.
 */
export async function broadcastSignedTrc20Transfer(
  signedTransaction: Record<string, unknown>
): Promise<{ txHash: string; broadcasted: boolean }> {
  const txHash = String((signedTransaction as any)?.txID || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txHash)) {
    throw new Error('Cannot broadcast a TRON transaction without a valid signed txID');
  }
  const tronWeb = getTronWeb(false);
  const result = await tronWeb.trx.sendRawTransaction(signedTransaction as any);
  if (!result?.result) {
    throw new Error(`TRON broadcast was not acknowledged for ${txHash}: ${result?.message || 'unknown node response'}`);
  }
  return { txHash, broadcasted: true };
}

/**
 * Compatibility wrapper for non-custody call sites. Custodial withdrawal workers
 * must use prepare -> persist -> broadcast instead of this convenience method.
 */
export async function sendTrc20Transfer(params: {
  toAddress: string;
  amount: string | number;
  contractAddress?: string;
}): Promise<{ txHash: string; broadcasted: boolean }> {
  const prepared = await prepareSignedTrc20Transfer(params);
  return broadcastSignedTrc20Transfer(prepared.signedTransaction);
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
  success: boolean | undefined;
  blockNumber?: number;
  actualCostTrx?: string;
}> {
  try {
    const tronWeb = getTronWeb(false);

    // Missing/indexing-lag responses are UNKNOWN, not proof of a reverted transaction.
    // An RPC outage must never trigger an automatic refund.
    const txInfo = await tronWeb.trx.getTransactionInfo(txHash);
    if (!txInfo || !txInfo.blockNumber) {
      return { confirmations: 0, isConfirmed: false, success: undefined };
    }

    // Get current block
    const currentBlock = await tronWeb.trx.getCurrentBlock();
    const currentHeight = currentBlock.block_header?.raw_data?.number;

    // Actual burned TRX fee (fee in Sun / 1,000,000) using exact integer arithmetic
    const feeSun = BigInt(txInfo.fee || 0);
    const wholeTrx = feeSun / 1000000n;
    const fractionSun = (feeSun % 1000000n).toString().padStart(6, '0');
    const actualCostTrx = `${wholeTrx}.${fractionSun}`;

    const receiptResult = txInfo.receipt?.result;
    const success = receiptResult === 'SUCCESS'
      ? true
      : typeof receiptResult === 'string' && receiptResult.length > 0
        ? false
        : undefined;

    if (typeof currentHeight !== 'number') {
      return { confirmations: 0, isConfirmed: false, success, blockNumber: txInfo.blockNumber, actualCostTrx };
    }

    const confirmations = Math.max(0, currentHeight - txInfo.blockNumber + 1);

    return {
      confirmations,
      isConfirmed: confirmations >= TRON_CONFIG.requiredConfirmations && success === true,
      success,
      blockNumber: txInfo.blockNumber,
      actualCostTrx,
    };
  } catch (err) {
    // RPC errors are indeterminate, not proof of an on-chain failure.
    return { confirmations: 0, isConfirmed: false, success: undefined };
  }
}
