import { createClient } from '@supabase/supabase-js';
import { SUPPORTED_EVM_CHAINS } from '@/lib/blockchain/providers';

// Never silently fall back to an anon key or a hard-coded project URL for a
// privileged worker. Missing configuration intentionally points to a placeholder
// endpoint and cannot perform privileged database operations.
const configuredSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = configuredSupabaseUrl || 'https://placeholder.supabase.co';
const supabaseKey = configuredServiceRoleKey || 'missing-service-role-key';

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CANONICAL_USDT_CONTRACTS: Record<string, string> = {
  ERC20: process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  BEP20: process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955',
  TRC20: process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
};

export function getBtcMempoolApi(): string {
  return process.env.BTC_MEMPOOL_API?.trim() || 'https://mempool.space/api';
}

export interface IngestionResult {
  network: string;
  scannedBlocks?: number;
  depositsDetected: number;
  depositsCredited: number;
  errors: string[];
}

/**
 * SAFETY CONTAINMENT (Step 26):
 *
 * The previous ingestion implementation sent provider-derived or stored values
 * directly to the SECURITY DEFINER process_deposit_atomic RPC. It did not
 * consistently verify the exact chain event/output, successful execution,
 * recipient, amount, asset/contract, canonical inclusion and reorg status.
 *
 * Do not resume automated deposit crediting until a shared verifier returns a
 * typed, independently checked proof for each chain and the database credit
 * boundary accepts only that proof/reference. The old scanner implementation
 * has intentionally been removed from the active path; no scanner calls or
 * credit RPC calls are made by this module while this guard is in place.
 */
const DEPOSIT_CREDITING_DISABLED_REASON =
  'Deposit crediting is paused until exact-event independent chain verification is implemented and tested.';

export async function getMonitoredAddresses(): Promise<{
  evmAddresses: Set<string>;
  tronAddresses: Set<string>;
  btcAddresses: Set<string>;
  ltcAddresses: Set<string>;
}> {
  return {
    evmAddresses: new Set<string>(),
    tronAddresses: new Set<string>(),
    btcAddresses: new Set<string>(),
    ltcAddresses: new Set<string>(),
  };
}

export async function refreshPendingDepositConfirmations(): Promise<{
  checked: number;
  newlyCredited: number;
}> {
  console.warn(`[Deposit Ingestion] ${DEPOSIT_CREDITING_DISABLED_REASON}`);
  return { checked: 0, newlyCredited: 0 };
}

export async function runDepositIngestion(): Promise<{
  results: IngestionResult[];
  pendingRecheck: { checked: number; newlyCredited: number };
}> {
  const networks = [
    ...Object.keys(SUPPORTED_EVM_CHAINS),
    'TRC20',
    'BTC',
    'LTC',
  ];
  console.warn(`[Deposit Ingestion] ${DEPOSIT_CREDITING_DISABLED_REASON}`);

  return {
    results: networks.map((network) => ({
      network,
      depositsDetected: 0,
      depositsCredited: 0,
      errors: [DEPOSIT_CREDITING_DISABLED_REASON],
    })),
    pendingRecheck: { checked: 0, newlyCredited: 0 },
  };
}

let ingestionInterval: NodeJS.Timeout | null = null;

export function startDepositIngestionWorker(intervalMs: number = 30000): void {
  if (ingestionInterval) return;
  console.warn(`[Deposit Ingestion] Worker start requested, but ${DEPOSIT_CREDITING_DISABLED_REASON}`);
  // Keep the interval unset: repeatedly running a disabled worker is misleading
  // and could conceal an operational outage.
}

export function stopDepositIngestionWorker(): void {
  if (ingestionInterval) {
    clearInterval(ingestionInterval);
    ingestionInterval = null;
  }
}
