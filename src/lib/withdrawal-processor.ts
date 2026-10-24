/**
 * Legacy withdrawal processor types retained for compatibility with existing
 * callers. Broadcasting is intentionally disabled here because this module
 * does not persist the transaction hash into the canonical queue and wait for
 * confirmation before settlement.
 */

export interface WithdrawalTask {
  id: string;
  user_id: string;
  destination_address: string;
  amount: string | number;
  asset_symbol: string;
  network: string;
}

export interface WithdrawalRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  asset_code: string;
  network_code: string;
  destination_address: string;
  amount: number;
  network_fee: number;
  status: string;
  txid?: string | null;
  broadcast_attempts?: number;
  broadcast_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastResult {
  id: string;
  assetCode: string;
  networkCode: string;
  destinationAddress: string;
  amount: number;
  success: boolean;
  txid?: string;
  error?: string;
  attempts: number;
}

export interface ProcessWithdrawalsSummary {
  processedCount: number;
  successful: number;
  failed: number;
  details: BroadcastResult[];
}

function legacyProcessorDisabled(): never {
  throw new Error(
    'Legacy withdrawal processor is disabled: use the confirmation-aware withdrawal worker'
  );
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function processTronWithdrawalOnChain(
  _withdrawal: WithdrawalTask,
  _tronPrivateKeyHex?: string
): Promise<string> {
  return legacyProcessorDisabled();
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function processBtcWithdrawalOnChain(
  _withdrawal: WithdrawalTask,
  _btcPrivateKeyHex?: string
): Promise<string> {
  return legacyProcessorDisabled();
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function processLtcWithdrawalOnChain(
  _withdrawal: WithdrawalTask,
  _ltcPrivateKeyHex?: string
): Promise<string> {
  return legacyProcessorDisabled();
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function processEvmWithdrawalOnChain(
  _withdrawal: WithdrawalTask,
  _privateKeyHex: string,
  _rpcUrl: string
): Promise<string> {
  return legacyProcessorDisabled();
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function signAndBroadcast(
  _withdrawal: WithdrawalRecord
): Promise<string> {
  return legacyProcessorDisabled();
}

/** Disabled: use the canonical queue worker and confirmation monitor instead. */
export async function processPendingWithdrawals(
  _limit: number = 20
): Promise<ProcessWithdrawalsSummary> {
  return legacyProcessorDisabled();
}
