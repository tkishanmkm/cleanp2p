import { createHash } from 'node:crypto';
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

export function verifyTronSignedWithdrawalPayload(input: {
  txHash: string;
  signedTransaction: unknown;
  expectedSenderHex: string;
  expectedDestinationHex: string;
  expectedTokenContractHex: string;
  expectedAmountUnits: bigint | string;
  observedTransaction?: unknown;
}): { verified: true } | { verified: false; reason: string } {
  const {
    txHash,
    signedTransaction,
    expectedSenderHex,
    expectedDestinationHex,
    expectedTokenContractHex,
    expectedAmountUnits,
    observedTransaction,
  } = input;

  if (!/^[a-fA-F0-9]{64}$/.test(txHash)) {
    return { verified: false, reason: 'INVALID_TX_HASH' };
  }
  if (!signedTransaction || typeof signedTransaction !== 'object' || Array.isArray(signedTransaction)) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_MISSING' };
  }

  const signed = signedTransaction as Record<string, any>;
  const signedHash = String(signed.txID || '').toLowerCase();
  const rawDataHex = String(signed.raw_data_hex || '').replace(/^0x/i, '').toLowerCase();
  if (signedHash !== txHash.toLowerCase() || !/^[a-f0-9]+$/.test(rawDataHex) || rawDataHex.length % 2 !== 0) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_IDENTITY_MISMATCH' };
  }

  const computedHash = createHash('sha256').update(Buffer.from(rawDataHex, 'hex')).digest('hex');
  if (computedHash !== txHash.toLowerCase()) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_RAW_DATA_HASH_MISMATCH' };
  }

  if (!Array.isArray(signed.signature) || signed.signature.length === 0) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_SIGNATURE_MISSING' };
  }

  const contracts = signed.raw_data?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_CONTRACT_COUNT_INVALID' };
  }

  const contract = contracts[0];
  const value = contract?.parameter?.value;
  if (contract?.type !== 'TriggerSmartContract' || !value || typeof value !== 'object') {
    return { verified: false, reason: 'SIGNED_TRANSACTION_CONTRACT_TYPE_INVALID' };
  }

  const normalizeHexAddress = (address: unknown) => String(address || '').replace(/^0x/i, '').toLowerCase();
  const senderHex = normalizeHexAddress(expectedSenderHex);
  const destinationHex = normalizeHexAddress(expectedDestinationHex).replace(/^41/, '');
  const tokenHex = normalizeHexAddress(expectedTokenContractHex);

  if (
    normalizeHexAddress(value.owner_address) !== senderHex ||
    normalizeHexAddress(value.contract_address) !== tokenHex
  ) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_SENDER_OR_TOKEN_MISMATCH' };
  }

  const callData = String(value.data || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[a-f0-9]{136}$/.test(callData) || callData.slice(0, 8) !== 'a9059cbb') {
    return { verified: false, reason: 'SIGNED_TRANSACTION_CALL_DATA_INVALID' };
  }

  const expectedDestinationWord = destinationHex.padStart(64, '0');
  if (callData.slice(8, 72) !== expectedDestinationWord) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_DESTINATION_MISMATCH' };
  }

  let expectedUnits: bigint;
  let signedUnits: bigint;
  try {
    expectedUnits = BigInt(expectedAmountUnits);
    signedUnits = BigInt('0x' + callData.slice(72, 136));
  } catch {
    return { verified: false, reason: 'SIGNED_TRANSACTION_AMOUNT_INVALID' };
  }
  if (expectedUnits <= 0n || signedUnits !== expectedUnits) {
    return { verified: false, reason: 'SIGNED_TRANSACTION_AMOUNT_MISMATCH' };
  }

  if (observedTransaction !== undefined) {
    if (!observedTransaction || typeof observedTransaction !== 'object' || Array.isArray(observedTransaction)) {
      return { verified: false, reason: 'ONCHAIN_TRANSACTION_UNAVAILABLE' };
    }
    const observed = observedTransaction as Record<string, any>;
    const observedRawDataHex = String(observed.raw_data_hex || '').replace(/^0x/i, '').toLowerCase();
    const observedContracts = observed.raw_data?.contract;
    const observedValue = Array.isArray(observedContracts) && observedContracts.length === 1
      ? observedContracts[0]?.parameter?.value
      : null;
    if (
      String(observed.txID || '').toLowerCase() !== txHash.toLowerCase() ||
      observedRawDataHex !== rawDataHex ||
      !observedValue ||
      observedContracts[0]?.type !== contract.type ||
      normalizeHexAddress(observedValue.owner_address) !== normalizeHexAddress(value.owner_address) ||
      normalizeHexAddress(observedValue.contract_address) !== normalizeHexAddress(value.contract_address) ||
      String(observedValue.data || '').replace(/^0x/i, '').toLowerCase() !== callData
    ) {
      return { verified: false, reason: 'ONCHAIN_TRANSACTION_DOES_NOT_MATCH_DURABLE_PAYLOAD' };
    }
  }

  return { verified: true };
}
