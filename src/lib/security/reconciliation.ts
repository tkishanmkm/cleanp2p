import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import {
  SUPPORTED_EVM_CHAINS,
  getEvmProvider,
  normalizeNetworkCode,
  getEvmHotWalletSigner,
  ERC20_ABI,
} from '@/lib/blockchain/providers';
import { getTronWeb, TRON_CONFIG, isValidTronAddress } from '@/lib/blockchain/tron';

// Initialize Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface DiscrepancyAlert {
  walletId: string;
  userId: string;
  assetSymbol: string;
  walletBalance: number;
  ledgerSum: number;
  discrepancy: number;
  anomalyType: 'BALANCE_DRIFT' | 'NEGATIVE_BALANCE' | 'UNAUTHORIZED_CREDIT' | 'UNDER_COLLATERALIZED';
  details: string;
}

export interface HotWalletReserveStatus {
  network: string;
  assetSymbol: string;
  hotWalletAddress: string;
  onchainBalance: number;
  status: 'ONLINE' | 'OFFLINE' | 'UNCONFIGURED';
  error?: string;
}

export interface ReconciliationReport {
  timestamp: string;
  totalUsersAudited: number;
  balancedWallets: number;
  anomalousWallets: number;
  totalLiability: number;
  hotWalletReserves: HotWalletReserveStatus[];
  discrepancies: DiscrepancyAlert[];
  isBalanced: boolean;
}

/**
 * Queries the on-chain hot wallet balance for a given chain and asset
 * Gracefully falls back or disables networks if RPC is not configured
 */
export async function getHotWalletOnchainBalance(
  network: string,
  assetSymbol: string = 'USDT'
): Promise<HotWalletReserveStatus> {
  const normNet = normalizeNetworkCode(network);

  // 1. TRON
  if (normNet === 'TRC20') {
    const tronAddress = process.env.TRON_HOT_WALLET_ADDRESS;
    if (!tronAddress || !isValidTronAddress(tronAddress)) {
      return {
        network: 'TRC20',
        assetSymbol,
        hotWalletAddress: tronAddress || '',
        onchainBalance: 0,
        status: 'UNCONFIGURED',
      };
    }

    try {
      const tronWeb = getTronWeb(false);
      const contract = await tronWeb.contract().at(TRON_CONFIG.usdtContract);
      const rawBalance = await contract.methods.balanceOf(tronAddress).call();
      const balance = Number(rawBalance) / 1e6;

      return {
        network: 'TRC20',
        assetSymbol,
        hotWalletAddress: tronAddress,
        onchainBalance: balance,
        status: 'ONLINE',
      };
    } catch (err: any) {
      return {
        network: 'TRC20',
        assetSymbol,
        hotWalletAddress: tronAddress,
        onchainBalance: 0,
        status: 'OFFLINE',
        error: err.message,
      };
    }
  }

  // 2. EVM Chains (BSC, ERC20, POLYGON, SEPOLIA)
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];
  if (!chainConfig) {
    return {
      network: normNet,
      assetSymbol,
      hotWalletAddress: '',
      onchainBalance: 0,
      status: 'UNCONFIGURED',
    };
  }

  const { signer, address } = getEvmHotWalletSigner(normNet);
  const hotAddress = address || process.env.EVM_HOT_WALLET_ADDRESS || process.env.HOT_WALLET_ADDRESS;

  if (!hotAddress) {
    return {
      network: normNet,
      assetSymbol,
      hotWalletAddress: '',
      onchainBalance: 0,
      status: 'UNCONFIGURED',
    };
  }

  try {
    const provider = getEvmProvider(normNet);

    if (assetSymbol === 'USDT' && chainConfig.usdtContractAddress) {
      const contract = new ethers.Contract(chainConfig.usdtContractAddress, ERC20_ABI, provider);
      const rawBalance = await contract.balanceOf(hotAddress);
      const decimals = chainConfig.usdtDecimals ?? 6;
      const formatted = ethers.formatUnits(rawBalance, decimals);

      return {
        network: normNet,
        assetSymbol,
        hotWalletAddress: hotAddress,
        onchainBalance: parseFloat(formatted),
        status: 'ONLINE',
      };
    } else {
      // Native balance
      const rawBalance = await provider.getBalance(hotAddress);
      const formatted = ethers.formatEther(rawBalance);

      return {
        network: normNet,
        assetSymbol: chainConfig.nativeSymbol,
        hotWalletAddress: hotAddress,
        onchainBalance: parseFloat(formatted),
        status: 'ONLINE',
      };
    }
  } catch (err: any) {
    return {
      network: normNet,
      assetSymbol,
      hotWalletAddress: hotAddress,
      onchainBalance: 0,
      status: 'OFFLINE',
      error: err.message,
    };
  }
}

/**
 * Audits all user wallets by comparing wallet_assets (available + locked)
 * against the aggregated sum of ledger_entries.
 */
export async function runFinancialReconciliation(): Promise<ReconciliationReport> {
  const discrepancies: DiscrepancyAlert[] = [];
  let totalLiability = 0;
  let totalWalletsAudited = 0;
  let balancedWallets = 0;

  // 1. Fetch all wallet_assets with associated user wallets
  const { data: walletAssets, error: waError } = await supabaseAdmin
    .from('wallet_assets')
    .select(`
      wallet_id,
      asset_code,
      available,
      locked_escrow,
      locked_withdrawal,
      wallets (
        user_id
      )
    `);

  if (waError) {
    console.error('[Financial Reconciliation] Error querying wallet_assets:', waError);
    throw new Error(`Failed to query wallet_assets: ${waError.message}`);
  }

  // 2. Fetch aggregate ledger sums grouped by wallet_id and asset_code
  // We can query ledger_entries directly
  const { data: ledgerEntries, error: leError } = await supabaseAdmin
    .from('ledger_entries')
    .select('wallet_id, asset_code, delta_available, delta_locked');

  if (leError) {
    console.error('[Financial Reconciliation] Error querying ledger_entries:', leError);
    throw new Error(`Failed to query ledger_entries: ${leError.message}`);
  }

  // Build aggregate map: key = `${wallet_id}:${asset_code}` => sum of deltas
  const ledgerSumMap = new Map<string, { sum: number; count: number }>();
  for (const entry of ledgerEntries || []) {
    const key = `${entry.wallet_id}:${entry.asset_code}`;
    const delta = Number(entry.delta_available || 0) + Number(entry.delta_locked || 0);
    const existing = ledgerSumMap.get(key) || { sum: 0, count: 0 };
    existing.sum += delta;
    existing.count += 1;
    ledgerSumMap.set(key, existing);
  }

  // 3. Compare each wallet_asset against ledger totals
  for (const asset of walletAssets || []) {
    totalWalletsAudited++;
    const available = Number(asset.available || 0);
    const lockedEscrow = Number(asset.locked_escrow || 0);
    const lockedWithdrawal = Number(asset.locked_withdrawal || 0);
    const totalWalletBalance = available + lockedEscrow + lockedWithdrawal;

    const rawWalletObj = asset.wallets as any;
    const userId = rawWalletObj?.user_id || 'unknown';
    const key = `${asset.wallet_id}:${asset.asset_code}`;
    const ledgerData = ledgerSumMap.get(key) || { sum: 0, count: 0 };
    const ledgerSum = ledgerData.sum;

    if (asset.asset_code === 'USDT') {
      totalLiability += totalWalletBalance;
    }

    // CHECK A: Negative balance anomaly
    if (available < -0.000001 || lockedEscrow < -0.000001 || lockedWithdrawal < -0.000001) {
      const alert: DiscrepancyAlert = {
        walletId: asset.wallet_id,
        userId,
        assetSymbol: asset.asset_code,
        walletBalance: totalWalletBalance,
        ledgerSum,
        discrepancy: Math.abs(totalWalletBalance - ledgerSum),
        anomalyType: 'NEGATIVE_BALANCE',
        details: `Negative balance detected: available=${available}, escrow=${lockedEscrow}, withdrawal=${lockedWithdrawal}`,
      };
      discrepancies.push(alert);
      continue;
    }

    // CHECK B: Unauthorized credit (balance > 0 with 0 ledger entries)
    if (totalWalletBalance > 0.000001 && ledgerData.count === 0) {
      const alert: DiscrepancyAlert = {
        walletId: asset.wallet_id,
        userId,
        assetSymbol: asset.asset_code,
        walletBalance: totalWalletBalance,
        ledgerSum: 0,
        discrepancy: totalWalletBalance,
        anomalyType: 'UNAUTHORIZED_CREDIT',
        details: `Wallet holds ${totalWalletBalance} ${asset.asset_code} without corresponding ledger entries`,
      };
      discrepancies.push(alert);
      continue;
    }

    // CHECK C: Balance drift against ledger sum
    const diff = Math.abs(totalWalletBalance - ledgerSum);
    if (diff > 0.0001) {
      const alert: DiscrepancyAlert = {
        walletId: asset.wallet_id,
        userId,
        assetSymbol: asset.asset_code,
        walletBalance: totalWalletBalance,
        ledgerSum,
        discrepancy: diff,
        anomalyType: 'BALANCE_DRIFT',
        details: `Wallet balance (${totalWalletBalance.toFixed(6)}) diverges from ledger sum (${ledgerSum.toFixed(6)}) by ${diff.toFixed(6)}`,
      };
      discrepancies.push(alert);
      continue;
    }

    balancedWallets++;
  }

  // 4. Hot Wallet Solvency Check (Check BSC primary and optionally others)
  const activeNetworks = ['BEP20'];
  if (process.env.ETH_RPC_URL || process.env.EVM_RPC_URL) activeNetworks.push('ERC20');
  if (process.env.POLYGON_RPC_URL) activeNetworks.push('POLYGON');
  if (process.env.SEPOLIA_RPC_URL) activeNetworks.push('SEPOLIA');
  if (process.env.TRON_HOT_WALLET_ADDRESS) activeNetworks.push('TRC20');

  const hotWalletReserves: HotWalletReserveStatus[] = [];
  let totalHotWalletUsdt = 0;

  for (const net of activeNetworks) {
    try {
      const reserve = await getHotWalletOnchainBalance(net, 'USDT');
      hotWalletReserves.push(reserve);
      if (reserve.status === 'ONLINE') {
        totalHotWalletUsdt += reserve.onchainBalance;
      }
    } catch (err: any) {
      hotWalletReserves.push({
        network: net,
        assetSymbol: 'USDT',
        hotWalletAddress: '',
        onchainBalance: 0,
        status: 'OFFLINE',
        error: err.message,
      });
    }
  }

  // Check under-collateralization
  if (totalHotWalletUsdt < totalLiability && totalLiability > 0) {
    discrepancies.push({
      walletId: 'SYSTEM_HOT_WALLET',
      userId: 'SYSTEM',
      assetSymbol: 'USDT',
      walletBalance: totalLiability,
      ledgerSum: totalHotWalletUsdt,
      discrepancy: totalLiability - totalHotWalletUsdt,
      anomalyType: 'UNDER_COLLATERALIZED',
      details: `Hot wallet USDT reserve (${totalHotWalletUsdt.toFixed(2)}) is lower than aggregate user liabilities (${totalLiability.toFixed(2)})`,
    });
  }

  // 5. Persist Critical Alerts in security_alerts
  for (const anomaly of discrepancies) {
    try {
      await supabaseAdmin.from('security_alerts').insert({
        alert_type: anomaly.anomalyType,
        severity: 'CRITICAL',
        title: `Financial Anomaly: ${anomaly.anomalyType}`,
        message: anomaly.details,
        details: {
          wallet_id: anomaly.walletId,
          user_id: anomaly.userId,
          asset: anomaly.assetSymbol,
          wallet_balance: anomaly.walletBalance,
          ledger_sum: anomaly.ledgerSum,
          discrepancy: anomaly.discrepancy,
        },
      });
    } catch (alertErr) {
      console.error('[Financial Reconciliation] Error persisting security alert:', alertErr);
    }
  }

  // 6. Record System Reconciliation Snapshot
  try {
    await supabaseAdmin.from('system_reconciliations').insert({
      asset_symbol: 'USDT',
      db_liability: totalLiability,
      onchain_balance: totalHotWalletUsdt,
      discrepancy: Math.abs(totalLiability - totalHotWalletUsdt),
      is_balanced: discrepancies.length === 0,
      gas_snapshot: hotWalletReserves,
    });
  } catch (snapErr) {
    console.warn('[Financial Reconciliation] Could not save system_reconciliations snapshot:', snapErr);
  }

  return {
    timestamp: new Date().toISOString(),
    totalUsersAudited: totalWalletsAudited,
    balancedWallets,
    anomalousWallets: discrepancies.length,
    totalLiability,
    hotWalletReserves,
    discrepancies,
    isBalanced: discrepancies.length === 0,
  };
}
