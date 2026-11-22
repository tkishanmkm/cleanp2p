import { ethers } from 'ethers';

export interface TronTransferEvent {
  event_name?: string;
  transaction_id?: string;
  event_index?: number | string;
  block_number?: number | string;
  contract_address?: string;
  result?: { to?: string; from?: string; value?: string | number };
}

function amountUnits(value: string | number): bigint | null {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
  try { return ethers.parseUnits(text, 6); } catch { return null; }
}

/** Match one exact confirmed TRC20 Transfer event to the pending deposit identity. */
export function verifyTronTransferEvent(input: {
  txHash: string;
  destinationAddress: string;
  expectedAmount: string | number;
  outputIndex: number;
  tokenContract: string;
  blockNumber: number;
  events: unknown;
}): { fromAddress?: string } | null {
  const { txHash, destinationAddress, expectedAmount, outputIndex, tokenContract, blockNumber, events } = input;
  const expected = amountUnits(expectedAmount);
  if (!/^([a-fA-F0-9]{64})$/.test(txHash) ||
      !destinationAddress || !tokenContract ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0 ||
      !Number.isSafeInteger(blockNumber) || blockNumber <= 0 ||
      expected === null || !events || typeof events !== 'object' ||
      !Array.isArray((events as any).data)) return null;

  const matches = ((events as any).data as TronTransferEvent[]).filter((event) => {
    if (!event || event.event_name !== 'Transfer' ||
        typeof event.transaction_id !== 'string' ||
        event.transaction_id.toLowerCase() !== txHash.toLowerCase() ||
        Number(event.event_index) !== outputIndex ||
        Number(event.block_number) !== blockNumber ||
        event.contract_address !== tokenContract ||
        event.result?.to !== destinationAddress ||
        event.result?.value == null) return false;
    try { return BigInt(String(event.result.value)) === expected; } catch { return false; }
  });
  if (matches.length !== 1) return null;
  return { fromAddress: matches[0].result?.from };
}
