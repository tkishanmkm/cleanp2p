import { ethers } from 'ethers';

export type EvmDepositNetwork = 'ETH' | 'ERC20' | 'BEP20';

export interface EvmDepositEvidence {
  network: EvmDepositNetwork;
  /** Chain ID reported by the RPC provider; prevents cross-chain RPC misconfiguration. */
  chainId: bigint | number;
  txHash: string;
  destinationAddress: string;
  expectedAmount: string | number;
  outputIndex: number;
  tokenContract?: string | null;
  transaction: any;
  receipt: any;
  currentBlock: number;
  /** Hash fetched independently from the canonical RPC block at receipt.blockNumber. */
  canonicalBlockHash: string | null;
}

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)').toLowerCase();

function decimalUnits(value: string | number, decimals: number): bigint | null {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > decimals) return null;
  try {
    return ethers.parseUnits(text, decimals);
  } catch {
    return null;
  }
}

/**
 * Verifies the exact credit-bearing EVM transfer, not just transaction success.
 * Token transfers must match canonical contract, destination, log index and amount.
 */
export function verifyEvmDepositEvidence(input: EvmDepositEvidence): {
  confirmations: number;
  blockNumber: number;
  fromAddress?: string;
} | null {
  const { network, chainId, txHash, destinationAddress, expectedAmount, outputIndex, tokenContract, transaction, receipt, currentBlock, canonicalBlockHash } = input;
  const expectedChainId = network === 'BEP20' ? 56n : 1n;
  let reportedChainId: bigint;
  try {
    reportedChainId = BigInt(chainId);
  } catch {
    return null;
  }
  let transactionChainMatches = true;
  if (transaction?.chainId != null) {
    try {
      transactionChainMatches = BigInt(transaction.chainId) === expectedChainId;
    } catch {
      transactionChainMatches = false;
    }
  }
  if (reportedChainId !== expectedChainId || !transactionChainMatches ||
      !/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0 ||
      !Number.isSafeInteger(currentBlock) || currentBlock < 0 ||
      !transaction || !receipt ||
      typeof transaction.hash !== 'string' || transaction.hash.toLowerCase() !== txHash.toLowerCase() ||
      typeof receipt.hash !== 'string' || receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
      receipt.status !== 1 ||
      !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 ||
      currentBlock < receipt.blockNumber ||
      typeof receipt.blockHash !== 'string' ||
      !/^0x[a-fA-F0-9]{64}$/.test(receipt.blockHash) ||
      typeof canonicalBlockHash !== 'string' ||
      !/^0x[a-fA-F0-9]{64}$/.test(canonicalBlockHash) ||
      receipt.blockHash.toLowerCase() !== canonicalBlockHash.toLowerCase() ||
      transaction.blockNumber !== receipt.blockNumber ||
      typeof transaction.blockHash !== 'string' ||
      transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
      typeof transaction.from !== 'string') return null;

  let expectedUnits: bigint | null;
  if (network === 'ETH') {
    expectedUnits = decimalUnits(expectedAmount, 18);
    if (expectedUnits === null || typeof transaction.to !== 'string' ||
        transaction.to.toLowerCase() !== destinationAddress.toLowerCase() ||
        typeof transaction.value !== 'bigint' || transaction.value !== expectedUnits) return null;
  } else {
    const decimals = network === 'ERC20' ? 6 : 18;
    expectedUnits = decimalUnits(expectedAmount, decimals);
    if (expectedUnits === null || !tokenContract ||
        typeof transaction.to !== 'string' ||
        transaction.to.toLowerCase() !== tokenContract.toLowerCase() ||
        !Array.isArray(receipt.logs)) return null;

    const matching = receipt.logs.filter((log: any) => {
      if (!log || typeof log.address !== 'string' ||
          log.address.toLowerCase() !== tokenContract.toLowerCase() ||
          !Array.isArray(log.topics) || log.topics.length < 3 ||
          String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC ||
          !Number.isSafeInteger(log.index) || log.index !== outputIndex ||
          typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) return false;
      const recipientTopic = String(log.topics[2]);
      if (!/^0x[0-9a-fA-F]{64}$/.test(recipientTopic)) return false;
      return ('0x' + recipientTopic.slice(-40)).toLowerCase() === destinationAddress.toLowerCase();
    });

    if (matching.length !== 1) return null;
    try {
      if (BigInt(matching[0].data) !== expectedUnits) return null;
    } catch {
      return null;
    }
  }

  return {
    confirmations: currentBlock - receipt.blockNumber + 1,
    blockNumber: receipt.blockNumber,
    fromAddress: transaction.from.toLowerCase(),
  };
}
