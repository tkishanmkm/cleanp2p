import { hasSupabaseServiceConfig, supabaseService as supabaseAdmin } from '@/lib/supabase/service-role';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getUsdtConfig } from '../lib/constants';
import { getTronWeb, isValidTronAddress, TRON_CONFIG } from '../lib/blockchain/tron';


function hasServerSupabaseCredentials(): boolean {
  return hasSupabaseServiceConfig();
}

function resolveHotWalletAddress(): string {
  // Reconciliation is a read-only process. It must never load or instantiate
  // a signer/private key merely to derive a public address.
  return (
    process.env.HOT_WALLET_PUBLIC_ADDRESS?.trim() ||
    process.env.EVM_HOT_WALLET_ADDRESS?.trim() ||
    process.env.HOT_WALLET_ADDRESS?.trim() ||
    ''
  );
}

const HOT_WALLET_ADDRESS = resolveHotWalletAddress();

// Operational alert thresholds for native gas tokens
const MIN_GAS_THRESHOLDS: Record<string, bigint> = {
  ERC20: ethers.parseEther('0.05'),   // Min 0.05 ETH
  BEP20: ethers.parseEther('0.10'),   // Min 0.10 BNB
};

/**
 * Creates an in-app system alert in Supabase.
 */
export async function createSystemAlert(
  type: 'LOW_GAS' | 'UNDER_COLLATERALIZED' | 'HIGH_VALUE_WITHDRAWAL' | 'WORKER_ERROR',
  severity: 'INFO' | 'WARNING' | 'CRITICAL',
  title: string,
  message: string,
  metadata: Record<string, any> = {}
) {
  if (!hasServerSupabaseCredentials()) {
    console.error('[Alert Engine Error] Server Supabase service-role configuration unavailable.');
    return;
  }

  try {
    // Older unresolved alerts may not have a dedupe_key yet. Check the
    // human-readable identity first so the first post-migration run does not
    // create a second active copy of each historical alert.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('system_alerts')
      .select('id')
      .eq('alert_type', type)
      .eq('title', title)
      .eq('is_resolved', false)
      .limit(1);

    if (lookupError) {
      console.error('[Alert Engine Error] Could not check for an existing active alert:', lookupError.message);
      return;
    }
    if (existing && existing.length > 0) return;

    // The partial unique index is the final concurrency guard. Once resolved,
    // the same alert may be raised again with the same deterministic key.
    const dedupeKey = createHash('sha256')
      .update(`${type}:${title.trim().toLocaleLowerCase('en-US')}`)
      .digest('hex');
    const { error } = await supabaseAdmin.from('system_alerts').insert({
      alert_type: type,
      severity,
      title,
      message,
      metadata,
      dedupe_key: dedupeKey,
    });
    if (error?.code === '23505') {
      // A matching unresolved alert already exists; avoid emitting duplicates on every worker run.
      return;
    }
    if (error) {
      console.error('[Alert Engine Error] Failed to log system alert:', error.message);
    }
  } catch (err: any) {
    console.error('[Alert Engine Error] Failed to log system alert:', err instanceof Error ? err.message : 'Unknown alert insert error');
  }
}

export function createSafeProvider(rpcUrl: string, chainId: number): ethers.JsonRpcProvider {
  const req = new ethers.FetchRequest(rpcUrl);
  req.timeout = 6000;
  return new ethers.JsonRpcProvider(req, ethers.Network.from(chainId), { staticNetwork: true });
}

export interface GasStatus {
  network: string;
  nativeBalance: string;
  isSufficient: boolean;
  symbol: string;
}

const RECONCILIATION_DECIMAL_PLACES = 8;
const RECONCILIATION_SCALE = 10n ** BigInt(RECONCILIATION_DECIMAL_PLACES);

function isDecimalDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function parseReconciliationDecimal(value: unknown, label: string): bigint {
  if (typeof value !== 'string') {
    throw new Error(`Reconciliation aborted: ${label} must be returned as exact decimal text.`);
  }

  const normalized = value.trim();
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const decimalPoint = unsigned.indexOf('.');
  if (decimalPoint !== unsigned.lastIndexOf('.')) {
    throw new Error(`Reconciliation aborted: ${label} is not a valid decimal value.`);
  }

  const wholePart = decimalPoint === -1 ? unsigned : unsigned.slice(0, decimalPoint);
  const fraction = decimalPoint === -1 ? '' : unsigned.slice(decimalPoint + 1);
  if (!isDecimalDigits(wholePart) || (decimalPoint !== -1 && !isDecimalDigits(fraction))) {
    throw new Error(`Reconciliation aborted: ${label} is not a valid decimal value.`);
  }

  if (fraction.length > RECONCILIATION_DECIMAL_PLACES
      && fraction.slice(RECONCILIATION_DECIMAL_PLACES).split('').some((digit) => digit !== '0')) {
    throw new Error(`Reconciliation aborted: ${label} exceeds supported ${RECONCILIATION_DECIMAL_PLACES}-decimal precision.`);
  }

  const scaledFraction = fraction
    .slice(0, RECONCILIATION_DECIMAL_PLACES)
    .padEnd(RECONCILIATION_DECIMAL_PLACES, '0');
  const absoluteUnits = BigInt(wholePart) * RECONCILIATION_SCALE + BigInt(scaledFraction || '0');
  return negative ? -absoluteUnits : absoluteUnits;
}

function formatReconciliationDecimal(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / RECONCILIATION_SCALE;
  const fraction = (absolute % RECONCILIATION_SCALE)
    .toString()
    .padStart(RECONCILIATION_DECIMAL_PLACES, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function reconciliationNumber(units: bigint, label: string): number {
  const value = Number(formatReconciliationDecimal(units));
  if (!Number.isFinite(value)) {
    throw new Error(`Reconciliation aborted: ${label} exceeds the supported report range.`);
  }
  return value;
}

function scaleTokenBalance(rawBalance: bigint, tokenDecimals: number): bigint {
  if (!Number.isSafeInteger(tokenDecimals)
      || tokenDecimals < 0
      || tokenDecimals > RECONCILIATION_DECIMAL_PLACES
      || rawBalance < 0n) {
    throw new Error('Reconciliation aborted: unsupported token precision or negative on-chain balance.');
  }
  return rawBalance * (10n ** BigInt(RECONCILIATION_DECIMAL_PLACES - tokenDecimals));
}

export interface ReconciliationReport {
  assetSymbol: string;
  totalDbUserBalance: number;
  totalPendingWithdrawals: number;
  totalDbLiability: number;
  onChainHotWalletBalance: number;
  discrepancy: number; // Chain Balance - DB Liability (Negative means under-collateralized!)
  isBalanced: boolean;
  gasStatuses: GasStatus[];
}

/**
 * Checks native gas balances for the primary Hot Wallet.
 */
export async function checkHotWalletGasLevels(): Promise<GasStatus[]> {
  const networks = [
    { code: 'ERC20', chainId: 1, rpc: process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com', symbol: 'ETH' },
    { code: 'BEP20', chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', symbol: 'BNB' },
  ];

  const gasStatuses: GasStatus[] = [];

  for (const net of networks) {
    if (!net.rpc) continue;
    try {
      const provider = createSafeProvider(net.rpc, net.chainId);
      const actualChainId = BigInt(await provider.send('eth_chainId', []));
      if (actualChainId !== BigInt(net.chainId)) {
        throw new Error(`RPC chain ID mismatch for ${net.code}.`);
      }
      const balance = await provider.getBalance(HOT_WALLET_ADDRESS);
      const minThreshold = MIN_GAS_THRESHOLDS[net.code] || ethers.parseEther('0.01');

      const isSufficient = balance >= minThreshold;
      const formatted = ethers.formatEther(balance);

      if (!isSufficient) {
        console.warn(`[GAS ALERT] Low native gas balance on ${net.code}! Current: ${formatted} ${net.symbol}`);
      }

      gasStatuses.push({
        network: net.code,
        nativeBalance: formatted,
        isSufficient,
        symbol: net.symbol,
      });
    } catch (err: any) {
      console.error(`[Gas Monitor Error] Failed checking gas on ${net.code}:`, err.message);
      gasStatuses.push({
        network: net.code,
        nativeBalance: '0.0',
        isSufficient: false,
        symbol: net.symbol,
      });
    }
  }

  return gasStatuses;
}

/**
 * Reconciles total database user liabilities against live on-chain hot wallet balances.
 */
export async function reconcileLedgerVsChain(assetSymbol = 'USDT'): Promise<ReconciliationReport> {
  if (!hasServerSupabaseCredentials()) throw new Error('Reconciliation aborted: server Supabase service-role configuration unavailable.');

  if (!HOT_WALLET_ADDRESS || !ethers.isAddress(HOT_WALLET_ADDRESS)) {
    throw new Error('Reconciliation aborted: a valid hot-wallet public address is not configured.');
  }

  const normalizedAssetSymbol = assetSymbol.trim().toUpperCase();
  if (normalizedAssetSymbol !== 'USDT') {
    throw new Error('Reconciliation aborted: on-chain reserve reconciliation currently supports USDT only.');
  }

  // Stale PROCESSING rows without a tx hash are ambiguous: the worker may have
  // crashed before broadcast, or after a broadcast whose hash was not persisted.
  // Alert for operator investigation only; never refund or re-queue automatically.
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: staleDispatches, error: staleDispatchError } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('id, network, amount, updated_at')
    .eq('status', 'PROCESSING')
    .is('tx_hash', null)
    .lt('updated_at', staleBefore)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (staleDispatchError || staleDispatches === null) {
    throw new Error(`Reconciliation cannot inspect stale un-hashed withdrawals: ${staleDispatchError?.message || 'no data returned'}`);
  }

  if (staleDispatches.length > 0) {
    await createSystemAlert(
      'WORKER_ERROR',
      'CRITICAL',
      'Stale withdrawals require broadcast reconciliation',
      `${staleDispatches.length} withdrawal(s) remain PROCESSING without a transaction hash for at least 15 minutes. Do not refund or re-queue until chain broadcast status is independently verified.`,
      { withdrawal_ids: staleDispatches.map((row: any) => row.id), threshold_minutes: 15, count: staleDispatches.length }
    );
  }

  // Read canonical wallet liability and all active withdrawal totals in one
  // service-only database aggregate. Decimal values cross PostgREST as text,
  // preserving exact NUMERIC values and avoiding row limits or JS float math.
  const { data: totalsData, error: totalsError } = await supabaseAdmin.rpc(
    'get_withdrawal_reconciliation_totals',
    { p_asset_symbol: normalizedAssetSymbol }
  );
  if (totalsError || !totalsData) {
    throw new Error(`Reconciliation cannot calculate canonical wallet totals: ${totalsError?.message || 'no data returned'}`);
  }

  const totalsRows = Array.isArray(totalsData) ? totalsData : [totalsData];
  if (totalsRows.length !== 1) {
    throw new Error(`Reconciliation expected one canonical totals row, received ${totalsRows.length}.`);
  }

  const totals = totalsRows[0] as {
    total_user_liability?: unknown;
    total_pending_withdrawals?: unknown;
  };
  const totalDbLiabilityUnits = parseReconciliationDecimal(
    totals.total_user_liability,
    'canonical wallet liability'
  );
  const totalPendingWithdrawalsUnits = parseReconciliationDecimal(
    totals.total_pending_withdrawals,
    'active withdrawal total'
  );
  if (totalDbLiabilityUnits < 0n || totalPendingWithdrawalsUnits < 0n) {
    throw new Error('Reconciliation aborted: canonical database totals cannot be negative.');
  }

  const totalDbUserBalance = reconciliationNumber(totalDbLiabilityUnits, 'database liability');
  const totalPendingWithdrawals = reconciliationNumber(totalPendingWithdrawalsUnits, 'pending withdrawals');
  const totalDbLiability = totalDbUserBalance;

  // 3. Query total multi-chain USDT on-chain reserves held in Hot Wallet
  let totalOnChainUnits = 0n;
  const networkConfigs = [
    { net: 'ERC20', chainId: 1, rpc: process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com' },
    { net: 'BEP20', chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org' },
  ];

  for (const item of networkConfigs) {
    try {
      const config = getUsdtConfig(item.net);
      if (!item.rpc) {
        throw new Error(`No read-only RPC is configured for ${item.net}.`);
      }

      const provider = createSafeProvider(item.rpc, item.chainId);
      const actualChainId = BigInt(await provider.send('eth_chainId', []));
      if (actualChainId !== BigInt(item.chainId)) {
        throw new Error(`RPC chain ID mismatch for ${item.net}.`);
      }

      const tokenContract = new ethers.Contract(
        config.contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );

      const balanceRaw: bigint = await tokenContract.balanceOf(HOT_WALLET_ADDRESS);
      totalOnChainUnits += scaleTokenBalance(balanceRaw, config.decimals);
    } catch (err: any) {
      console.error(`[Reconciliation Error] Failed fetching ${item.net} on-chain balance:`, err.message);
      throw new Error(`Reconciliation incomplete: failed fetching ${item.net} reserve balance; refusing to calculate a potentially false balance result.`);
    }
  }

  // TRON/TRC20 holds a separate hot-wallet address and must be included in
  // the same USDT reserve sum. Never use signer mode/private keys for a read.
  const tronHotWalletAddress = process.env.TRON_HOT_WALLET_ADDRESS?.trim() || '';
  if (!tronHotWalletAddress || !isValidTronAddress(tronHotWalletAddress)) {
    throw new Error('Reconciliation incomplete: a valid TRON hot-wallet address is not configured.');
  }

  try {
    const tronWeb = getTronWeb(false);
    const tronUsdt = await tronWeb.contract().at(TRON_CONFIG.usdtContract);
    const tronRawBalance = await tronUsdt.balanceOf(tronHotWalletAddress).call();
    const tronBalance = BigInt(tronRawBalance.toString());
    totalOnChainUnits += scaleTokenBalance(tronBalance, TRON_CONFIG.usdtDecimals);
  } catch (err: any) {
    console.error('[Reconciliation Error] Failed fetching TRC20 on-chain balance:', err.message);
    throw new Error('Reconciliation incomplete: failed fetching TRC20 reserve balance; refusing to calculate a potentially false balance result.');
  }

  // 4. Compare exact fixed-point values. JavaScript numbers are created only
  // for the existing report/alert contract; the balance decision stays exact.
  const totalOnChainExact = formatReconciliationDecimal(totalOnChainUnits);
  const totalDbLiabilityExact = formatReconciliationDecimal(totalDbLiabilityUnits);
  const discrepancyUnits = totalOnChainUnits - totalDbLiabilityUnits;
  const discrepancyExact = formatReconciliationDecimal(discrepancyUnits);
  const totalOnChainBalance = reconciliationNumber(totalOnChainUnits, 'on-chain reserves');
  const discrepancy = reconciliationNumber(discrepancyUnits, 'reserve discrepancy');
  const isBalanced = discrepancyUnits >= 0n;

  const gasStatuses = await checkHotWalletGasLevels();

  // 5. Store exact decimal text values; Postgres casts them into NUMERIC(28,8).
  try {
    const { error: snapshotError } = await supabaseAdmin.from('system_reconciliations').insert({
      asset_symbol: normalizedAssetSymbol,
      db_liability: totalDbLiabilityExact,
      onchain_balance: totalOnChainExact,
      discrepancy: discrepancyExact,
      is_balanced: isBalanced,
      gas_snapshot: gasStatuses,
    });
    if (snapshotError) {
      console.error('[Reconciliation Error] Failed saving snapshot to system_reconciliations:', snapshotError.message);
    }
  } catch (insertErr: any) {
    console.error('[Reconciliation Error] Failed saving snapshot to system_reconciliations:', insertErr.message);
  }

  // 6. Alert Logging
  // 1. Log Under-Collateralization Alert if DB liabilities exceed on-chain assets
  if (!isBalanced) {
    await createSystemAlert(
      'UNDER_COLLATERALIZED',
      'CRITICAL',
      'System Under-Collateralization Detected',
      `Database liabilities (${totalDbLiability.toFixed(2)} USDT) exceed on-chain hot wallet reserves (${totalOnChainBalance.toFixed(2)} USDT) by ${Math.abs(discrepancy).toFixed(2)} USDT.`,
      { totalDbLiability, totalOnChainBalance, discrepancy }
    );
  }

  // 3. Log Low Gas Token Alerts
  for (const gas of gasStatuses) {
    if (!gas.isSufficient) {
      await createSystemAlert(
        'LOW_GAS',
        'WARNING',
        `Low Native Gas Token on ${gas.network}`,
        `Hot Wallet native gas balance is ${parseFloat(gas.nativeBalance).toFixed(4)} ${gas.symbol}. Top up gas to prevent withdrawal delays.`,
        { network: gas.network, balance: gas.nativeBalance, symbol: gas.symbol }
      );
    }
  }

  // 4. Detect and Alert on Individual Orphan / Ambiguous Withdrawals (> 15 mins)
  await detectAndAlertOrphanWithdrawals();

  return {
    assetSymbol: normalizedAssetSymbol,
    totalDbUserBalance,
    totalPendingWithdrawals,
    totalDbLiability,
    onChainHotWalletBalance: totalOnChainBalance,
    discrepancy,
    isBalanced,
    gasStatuses,
  };
}

/**
 * Detects individual orphaned or ambiguous processing withdrawals (> 15 minutes old)
 * and logs high-priority alerts without mutating financial state.
 */
export async function detectAndAlertOrphanWithdrawals(): Promise<number> {
  if (!hasServerSupabaseCredentials()) throw new Error('Orphan-withdrawal scan aborted: server Supabase service-role configuration unavailable.');

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: orphans, error } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('id, user_id, amount, asset_symbol, network, status, tx_hash, created_at, updated_at')
      .in('status', ['PROCESSING', 'AMBIGUOUS_BROADCAST'])
      .lt('updated_at', fifteenMinutesAgo)
      .limit(50);

    if (error) {
      console.error('[Orphan Detector Error] Failed querying orphan withdrawals:', error.message);
      return 0;
    }

    if (!orphans || orphans.length === 0) {
      return 0;
    }

    for (const item of orphans) {
      const ageMinutes = Math.round((Date.now() - new Date(item.updated_at || item.created_at).getTime()) / 60000);
      const isAmbiguous = item.status === 'AMBIGUOUS_BROADCAST' || !item.tx_hash;

      await createSystemAlert(
        'WORKER_ERROR',
        'CRITICAL',
        `Orphan Withdrawal Detected: ${item.id}`,
        `Withdrawal ${item.id} (${item.amount} ${item.asset_symbol} on ${item.network}) has been in ${item.status} for ${ageMinutes}m with ${item.tx_hash ? `tx_hash ${item.tx_hash}` : 'NULL tx_hash'}. Manual explorer verification required.`,
        {
          withdrawal_id: item.id,
          user_id: item.user_id,
          amount: item.amount,
          asset: item.asset_symbol,
          network: item.network,
          status: item.status,
          tx_hash: item.tx_hash,
          age_minutes: ageMinutes,
          is_ambiguous: isAmbiguous,
          action_required: 'Check blockchain explorer before manual completion or refund.',
        }
      );
    }

    return orphans.length;
  } catch (err: any) {
    console.error('[Orphan Detector Error]:', err.message);
    return 0;
  }
}

