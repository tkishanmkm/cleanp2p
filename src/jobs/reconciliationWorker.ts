import { hasSupabaseServiceConfig, supabaseService as supabaseAdmin } from '@/lib/supabase/service-role';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getUsdtConfig } from '../lib/constants';


function hasServerSupabaseCredentials(): boolean {
  return hasSupabaseServiceConfig();
}

function resolveHotWalletAddress(): string {
  if (process.env.HOT_WALLET_PUBLIC_ADDRESS) {
    return process.env.HOT_WALLET_PUBLIC_ADDRESS;
  }
  if (process.env.EVM_HOT_WALLET_ADDRESS) {
    return process.env.EVM_HOT_WALLET_ADDRESS;
  }
  const privKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  if (privKey) {
    try {
      const formattedKey = privKey.startsWith('0x') ? privKey : `0x${privKey}`;
      return new ethers.Wallet(formattedKey).address;
    } catch (_) {}
  }
  return '';
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
    // Deduplicate only active alerts. Once resolved, the same issue can raise a fresh alert.
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

  // 1. Calculate sum of user spot wallet balances from DB
  let totalDbUserBalance = 0;
  const { data: userBalData, error: userBalErr } = await supabaseAdmin
    .from('user_wallets')
    .select('main_balance, locked_balance')
    .eq('asset_symbol', assetSymbol);

  if (!userBalErr && userBalData && userBalData.length > 0) {
    totalDbUserBalance = userBalData.reduce((acc, row) => {
      const amounts = [row.main_balance, row.locked_balance].map(Number);
      if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
        throw new Error('Reconciliation aborted: user_wallets contains an invalid or negative liability amount.');
      }
      return acc + amounts.reduce((sum, amount) => sum + amount, 0);
    }, 0);
  } else {
    // Fallback directly to wallet_assets if user_wallets view is pending migration
    const { data: walletAssetsData, error: walletAssetsErr } = await supabaseAdmin
      .from('wallet_assets')
      .select('available, locked_escrow, locked_withdrawal')
      .eq('asset_code', assetSymbol);

    if (walletAssetsErr || walletAssetsData === null) {
      throw new Error(
        `Reconciliation cannot calculate user liabilities: wallet_assets fallback query failed: ${walletAssetsErr?.message || 'no data returned'}`
      );
    }

    totalDbUserBalance = walletAssetsData.reduce((acc, row) => {
      const amounts = [row.available, row.locked_escrow, row.locked_withdrawal].map(Number);
      if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
        throw new Error('Reconciliation aborted: wallet_assets contains an invalid or negative liability amount.');
      }
      return acc + amounts.reduce((sum, amount) => sum + amount, 0);
    }, 0);
  }

  // 2. Report pending withdrawals separately for monitoring; do not add them to liability
  // because wallet_assets.locked_withdrawal already includes the reserved funds.
  let totalPendingWithdrawals = 0;
  const { data: pendingData, error: pendingErr } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('amount, metadata')
    .eq('asset_symbol', assetSymbol)
    .in('status', ['PENDING', 'PENDING_APPROVAL', 'PROCESSING', 'NEEDS_APPROVAL']);

  if (pendingErr || pendingData === null) {
    throw new Error(`Reconciliation cannot report pending withdrawals: ${pendingErr?.message || 'query returned no data'}`);
  }

  totalPendingWithdrawals = pendingData.reduce((acc, row: any) => {
    const amount = Number(row.amount);
    const fee = Number(row.metadata?.fee ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(fee) || fee < 0) {
      throw new Error('Reconciliation aborted: pending withdrawals contain invalid amount or fee values.');
    }
    return acc + amount + fee;
  }, 0);

  const totalDbLiability = totalDbUserBalance;

  // 3. Query total multi-chain USDT on-chain reserves held in Hot Wallet
  let totalOnChainBalance = 0;
  const networkConfigs = [
    { net: 'ERC20', chainId: 1, rpc: process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com' },
    { net: 'BEP20', chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org' },
  ];

  for (const item of networkConfigs) {
    try {
      const config = getUsdtConfig(item.net);
      if (!item.rpc) continue;

      const provider = createSafeProvider(item.rpc, item.chainId);
      const tokenContract = new ethers.Contract(
        config.contractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );

      const balanceRaw: bigint = await tokenContract.balanceOf(HOT_WALLET_ADDRESS);
      const formatted = parseFloat(ethers.formatUnits(balanceRaw, config.decimals));
      totalOnChainBalance += formatted;
    } catch (err: any) {
      console.error(`[Reconciliation Error] Failed fetching ${item.net} on-chain balance:`, err.message);
      throw new Error(`Reconciliation incomplete: failed fetching ${item.net} reserve balance; refusing to calculate a potentially false balance result.`);
    }
  }

  // 4. Calculate discrepancy
  const discrepancy = totalOnChainBalance - totalDbLiability;
  // A slight positive variance can exist due to accumulated fee revenue; negative variance indicates potential issue
  const isBalanced = discrepancy >= 0;

  const gasStatuses = await checkHotWalletGasLevels();

  // 5. Store reconciliation snapshot in DB
  try {
    const { error: snapshotError } = await supabaseAdmin.from('system_reconciliations').insert({
      asset_symbol: assetSymbol,
      db_liability: totalDbLiability,
      onchain_balance: totalOnChainBalance,
      discrepancy,
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
    assetSymbol,
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

