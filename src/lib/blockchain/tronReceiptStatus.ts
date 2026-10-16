/**
 * Classify a TRON transaction receipt conservatively for withdrawal settlement.
 * Unknown/missing values must remain pending; they are not proof of success or failure.
 */
const TRON_TERMINAL_FAILURE_RESULTS = new Set([
  'REVERT',
  'OUT_OF_ENERGY',
  'OUT_OF_TIME',
  'JVM_STACK_OVER_FLOW',
  'UNKNOWN',
  'TRANSFER_FAILED',
  'UNRECOGNIZED_TOKEN',
  'BAD_JUMP_DESTINATION',
  'OUT_OF_MEMORY',
  'PRECOMPILED_CONTRACT',
  'STACK_TOO_SMALL',
  'STACK_TOO_LARGE',
  'ILLEGAL_OPERATION',
  'STACK_OVERFLOW',
]);

export type TronReceiptOutcome = 'success' | 'failure' | 'pending';

export function classifyTronReceiptResult(value: unknown): TronReceiptOutcome {
  if (typeof value !== 'string') return 'pending';
  const result = value.trim().toUpperCase();
  if (result === 'SUCCESS') return 'success';
  if (TRON_TERMINAL_FAILURE_RESULTS.has(result)) return 'failure';
  return 'pending';
}
