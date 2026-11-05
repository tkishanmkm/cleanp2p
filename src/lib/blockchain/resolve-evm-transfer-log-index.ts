import { ethers } from 'ethers';

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)').toLowerCase();

export interface TransferLogIndexInput {
  receipt: {
    hash?: unknown;
    status?: unknown;
    logs?: unknown;
  } | null;
  txHash: string;
  tokenContract: string;
  destinationAddress: string;
  amount: string | number;
  decimals: number;
}

export interface VerifiedEvmTransferLog {
  index: number;
  amount: string;
  rawAmount: bigint;
}

/**
 * Resolve the block-global receipt log index and exact decimal transfer amount.
 * Returns null unless exactly one canonical Transfer log matches contract,
 * recipient, and caller-provided exact amount. Never substitutes index zero.
 */
export function resolveEvmTransferEvidence(input: TransferLogIndexInput): VerifiedEvmTransferLog | null {
  const { receipt, txHash, tokenContract, destinationAddress, amount, decimals } = input;
  if (!receipt || typeof receipt.hash !== 'string' ||
      receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
      receipt.status !== 1 || !Array.isArray(receipt.logs) ||
      !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
      !ethers.isAddress(tokenContract) || !ethers.isAddress(destinationAddress) ||
      !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;

  const amountText = String(amount).trim();
  if (!/^\d+(?:\.\d+)?$/.test(amountText) ||
      (amountText.split('.')[1] ?? '').length > decimals) return null;

  let expectedUnits: bigint;
  try {
    expectedUnits = ethers.parseUnits(amountText, decimals);
  } catch {
    return null;
  }
  if (expectedUnits <= 0n) return null;

  const matches = receipt.logs.filter((log: any) => {
    if (!log || typeof log.address !== 'string' ||
        log.address.toLowerCase() !== tokenContract.toLowerCase() ||
        !Array.isArray(log.topics) || log.topics.length !== 3 ||
        String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC ||
        !Number.isSafeInteger(log.index) || log.index < 0 ||
        typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) return false;

    const recipientTopic = String(log.topics[2]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(recipientTopic) ||
        ('0x' + recipientTopic.slice(-40)).toLowerCase() !== destinationAddress.toLowerCase()) return false;

    try {
      return BigInt(log.data) === expectedUnits;
    } catch {
      return false;
    }
  });

  if (matches.length !== 1) return null;
  const rawAmount = BigInt(matches[0].data);
  return {
    index: matches[0].index,
    rawAmount,
    amount: ethers.formatUnits(rawAmount, decimals),
  };
}

export interface UniqueEvmTransferInput {
  receipt: {
    hash?: unknown;
    status?: unknown;
    logs?: unknown;
  } | null;
  txHash: string;
  tokenContract: string;
  destinationAddress: string;
  decimals: number;
}

/**
 * Resolve a single inbound token transfer without trusting an amount supplied
 * by an indexer or client. Multiple matching logs are ambiguous and fail closed.
 */
export function resolveUniqueEvmTransferEvidence(input: UniqueEvmTransferInput): VerifiedEvmTransferLog | null {
  const { receipt, txHash, tokenContract, destinationAddress, decimals } = input;
  if (!receipt || typeof receipt.hash !== 'string' ||
      receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
      receipt.status !== 1 || !Array.isArray(receipt.logs) ||
      !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
      !ethers.isAddress(tokenContract) || !ethers.isAddress(destinationAddress) ||
      !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;

  const matches = receipt.logs.filter((log: any) => {
    if (!log || typeof log.address !== 'string' ||
        log.address.toLowerCase() !== tokenContract.toLowerCase() ||
        !Array.isArray(log.topics) || log.topics.length !== 3 ||
        String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC ||
        !Number.isSafeInteger(log.index) || log.index < 0 ||
        typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) return false;
    const recipientTopic = String(log.topics[2]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(recipientTopic) ||
        ('0x' + recipientTopic.slice(-40)).toLowerCase() !== destinationAddress.toLowerCase()) return false;
    try {
      return BigInt(log.data) > 0n;
    } catch {
      return false;
    }
  });

  if (matches.length !== 1) return null;
  const rawAmount = BigInt(matches[0].data);
  return { index: matches[0].index, rawAmount, amount: ethers.formatUnits(rawAmount, decimals) };
}

export function resolveEvmTransferLogIndex(input: TransferLogIndexInput): number | null {
  return resolveEvmTransferEvidence(input)?.index ?? null;
}
