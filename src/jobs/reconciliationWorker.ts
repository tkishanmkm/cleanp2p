import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getUsdtConfig } from '../lib/constants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('[Reconciliation] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required; refusing to run with placeholder/anon credentials.');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
  try {
    await supabaseAdmin.from('system_alerts').insert({
      alert_type: type,
      severity,
      title,
      message,
      metadata,
    });
  } catch (err: any) {
    console.error('[Alert Engine Error] Failed to log system alert:', err.message);
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
  coverageComplete: boolean;
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
  // 1. Read the live canonical wallet schema. Never substitute a zero balance
  // when a database query fails: that can falsely declare the platform solvent.
  const { data: walletAssets, error: walletAssetsError } = await supabaseAdmin
    .from('wallet_assets')
    .select('balance, locked_balance, reserved_balance, in_escrow, in_withdrawal')
    .eq('asset_symbol', assetSymbol);

  if (walletAssetsError || !walletAssets) {
    throw new Error(`[Reconciliation] Cannot read canonical wallet liabilities: ${walletAssetsError?.message || 'no result'}`);
  }

  const numeric = (value: unknown, field: string): number => {
    const parsed = Number(value ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`[Reconciliation] Invalid ${field} value; refusing to compute solvency`);
    }
    return parsed;
  };

  // Conservative liability sum across known wallet buckets. Pending withdrawals
  // are informational below but are NOT added twice: request_withdrawal moves
  // their principal+fee into wallet_assets.in_withdrawal.
  const totalDbUserBalance = walletAssets.reduce((acc, row) => acc
    + numeric(row.balance, 'balance')
    + numeric(row.locked_balance, 'locked_balance')
    + numeric(row.reserved_balance, 'reserved_balance')
    + numeric(row.in_escrow, 'in_escrow')
    + numeric(row.in_withdrawal, 'in_withdrawal'), 0);

  const { data: pendingData, error: pendingErr } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('amount, fee, metadata')
    .in('status', ['PENDING', 'PENDING_APPROVAL', 'PROCESSING', 'BROADCASTED', 'AMBIGUOUS_BROADCAST']);

  if (pendingErr || !pendingData) {
    throw new Error(`[Reconciliation] Cannot read pending withdrawal queue: ${pendingErr?.message || 'no result'}`);
  }

  const totalPendingWithdrawals = pendingData.reduce((acc, row: any) => {
    const amount = numeric(row.amount, 'pending withdrawal amount');
    const fee = numeric(row.fee ?? row.metadata?.fee ?? 0, 'pending withdrawal fee');
    return acc + amount + fee;
  }, 0);

  // Queue total is a subset of wallet bucket liabilities and is informational.
  const totalDbLiability = totalDbUserBalance;

  // 3. Query total multi-chain USDT on-chain reserves held in Hot Wallet
  let totalOnChainBalance = 0;
  let chainReadFailures = 0;
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
      chainReadFailures++;
      console.error(`[Reconciliation Error] Failed fetching ${item.net} on-chain balance:`, err.message);
    }
  }

  // This worker currently queries only EVM/BSC USDT while liabilities are not
  // network-scoped and may include TRON, BTC, LTC, or ETH. It cannot prove global
  // solvency, so it must never return isBalanced=true until coverage is complete.
  const discrepancy = totalOnChainBalance - totalDbLiability;
  const coverageComplete = false;
  const isBalanced = coverageComplete && chainReadFailures === 0 && discrepancy >= 0;

  const gasStatuses = await checkHotWalletGasLevels();

  // 5. Store reconciliation snapshot in DB
  try {
    await supabaseAdmin.from('system_reconciliations').insert({
      asset_symbol: assetSymbol,
      db_liability: totalDbLiability,
      onchain_balance: totalOnChainBalance,
      discrepancy,
      is_balanced: isBalanced,
      gas_snapshot: { gasStatuses, coverageComplete, chainReadFailures, note: 'Partial EVM/BSC USDT view only; not a global solvency proof.' },
    });
  } catch (insertErr: any) {
    console.error('[Reconciliation Error] Failed saving snapshot to system_reconciliations:', insertErr.message);
  }

  // 6. Alert Logging
  // 1. Log Under-Collateralization Alert if DB liabilities exceed on-chain assets
  if (discrepancy < 0) {
    await createSystemAlert(
      'UNDER_COLLATERALIZED',
      'CRITICAL',
      'System Under-Collateralization Suspected',
      `Observed EVM/BSC reserves (${totalOnChainBalance.toFixed(2)} USDT) are below the aggregate wallet liability view (${totalDbLiability.toFixed(2)} USDT). Network coverage is incomplete; investigate immediately.`,
      { totalDbLiability, totalOnChainBalance, discrepancy, coverageComplete, chainReadFailures }
    );
  }
  if (!coverageComplete || chainReadFailures > 0) {
    await createSystemAlert(
      'WORKER_ERROR',
      'CRITICAL',
      'Reconciliation Coverage Incomplete',
      'Paxones reconciliation cannot certify global solvency because liability rows are not network-scoped and all supported chains are not included. Do not treat this report as a balanced result.',
      { assetSymbol, coverageComplete, chainReadFailures }
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
    coverageComplete,
    gasStatuses,
  };
}

/**
 * Detects individual orphaned or ambiguous processing withdrawals (> 15 minutes old)
 * and logs high-priority alerts without mutating financial state.
 */
export async function detectAndAlertOrphanWithdrawals(): Promise<number> {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: orphans, error } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('id, user_id, amount, asset_symbol, network, status, tx_hash, created_at, updated_at')
      .in('status', ['PROCESSING', 'AMBIGUOUS_BROADCAST'])
      .lt('updated_at', fifteenMinutesAgo)
      .limit(50);

    if (error || !orphans || orphans.length === 0) {
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

