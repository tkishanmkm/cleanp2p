import { ethers } from 'ethers';

interface TronEvent {
  event_name?: string;
  transaction_id?: string;
  event_index?: number | string;
  block_number?: number | string;
  contract_address?: string;
  result?: { from?: string; to?: string; value?: string | number };
}

/** Verify the exact confirmed outbound TRC20 USDT Transfer event before settlement. */
export function verifyTronWithdrawalEvidence(input: {
  txHash: string;
  destinationAddress: string;
  expectedAmount: string | number;
  expectedSender: string;
  blockNumber: number;
  tokenContract: string;
  events: unknown;
}): { verified: true; eventIndex: number } | { verified: false; reason: string } {
  const { txHash, destinationAddress, expectedAmount, expectedSender, blockNumber, tokenContract, events } = input;
  if (!/^[a-fA-F0-9]{64}$/.test(txHash)) return { verified: false, reason: 'INVALID_TX_HASH' };
  if (!destinationAddress || !expectedSender || !tokenContract || !Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    return { verified: false, reason: 'INVALID_EXPECTED_PAYOUT_IDENTITY' };
  }
  let expectedUnits: bigint;
  try {
    const amount = String(expectedAmount).trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) throw new Error('invalid amount');
    expectedUnits = ethers.parseUnits(amount, 6);
    if (expectedUnits <= 0n) throw new Error('non-positive amount');
  } catch {
    return { verified: false, reason: 'INVALID_EXPECTED_AMOUNT' };
  }
  if (!events || typeof events !== 'object' || !Array.isArray((events as any).data)) {
    return { verified: false, reason: 'CONFIRMED_EVENT_DATA_UNAVAILABLE' };
  }
  const matches = ((events as any).data as TronEvent[]).filter((event) => {
    if (!event || event.event_name !== 'Transfer' ||
        String(event.transaction_id || '').toLowerCase() !== txHash.toLowerCase() ||
        Number(event.block_number) !== blockNumber ||
        event.contract_address !== tokenContract ||
        event.result?.from !== expectedSender ||
        event.result?.to !== destinationAddress ||
        event.result?.value == null) return false;
    try { return BigInt(String(event.result.value)) === expectedUnits; } catch { return false; }
  });
  if (matches.length !== 1 || !Number.isSafeInteger(Number(matches[0]?.event_index))) {
    return { verified: false, reason: matches.length === 0 ? 'EXACT_TRANSFER_EVENT_NOT_FOUND' : 'AMBIGUOUS_TRANSFER_EVENTS' };
  }
  return { verified: true, eventIndex: Number(matches[0].event_index) };
}
