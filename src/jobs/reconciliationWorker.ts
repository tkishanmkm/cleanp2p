import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getUsdtConfig } from '../lib/constants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

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
  return '0xB5e9502336A2968467555bBaC369210cAA974e95';
}

const HOT_WALLET_ADDRESS = resolveHotWalletAddress();

// Operational alert thresholds for native gas tokens
const MIN_GAS_THRESHOLDS: Record<string, bigint> = {
  ERC20: ethers.parseEther('0.05'),   // Min 0.05 ETH
  BEP20: ethers.parseEther('0.10'),   // Min 0.10 BNB
  POLYGON: ethers.parseEther('10.0'), // Min 10.0 POL
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
  gasStatuses: GasStatus[];
}

/**
 * Checks native gas balances for the primary Hot Wallet.
 */
export async function checkHotWalletGasLevels(): Promise<GasStatus[]> {
  const networks = [
    { code: 'ERC20', chainId: 1, rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com', symbol: 'ETH' },
    { code: 'BEP20', chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', symbol: 'BNB' },
    { code: 'POLYGON', chainId: 137, rpc: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com', symbol: 'POL' },
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
  // 1. Calculate sum of user spot wallet balances from DB
  let totalDbUserBalance = 0;
  const { data: userBalData, error: userBalErr } = await supabaseAdmin
    .from('user_wallets')
    .select('main_balance, locked_balance')
    .eq('asset_symbol', assetSymbol);

  if (!userBalErr && userBalData) {
    totalDbUserBalance = (userBalData || []).reduce(
      (acc, row) => acc + (parseFloat(row.main_balance) || 0) + (parseFloat(row.locked_balance) || 0),
      0
    );
  } else {
    // Fallback directly to wallet_assets if user_wallets view is pending migration
    const { data: walletAssetsData } = await supabaseAdmin
      .from('wallet_assets')
      .select('available, locked_escrow, locked_withdrawal')
      .eq('asset_code', assetSymbol);

    if (walletAssetsData) {
      totalDbUserBalance = (walletAssetsData || []).reduce(
        (acc, row) =>
          acc +
          (parseFloat(row.available) || 0) +
          (parseFloat(row.locked_escrow) || 0) +
          (parseFloat(row.locked_withdrawal) || 0),
        0
      );
    }
  }

  // 2. Calculate pending / processing withdrawals held in queue
  let totalPendingWithdrawals = 0;
  const { data: pendingData, error: pendingErr } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('amount, fee, metadata')
    .in('status', ['PENDING', 'PROCESSING', 'NEEDS_APPROVAL']);

  if (!pendingErr && pendingData) {
    totalPendingWithdrawals = pendingData.reduce(
      (acc, row: any) => {
        const amt = parseFloat(row.amount) || 0;
        const fee = parseFloat(row.fee) || parseFloat(row.metadata?.fee) || 0;
        return acc + amt + fee;
      },
      0
    );
  } else {
    const { data: fallbackPending } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('amount, metadata')
      .in('status', ['PENDING', 'PROCESSING', 'NEEDS_APPROVAL']);

    totalPendingWithdrawals = (fallbackPending || []).reduce(
      (acc, row: any) => {
        const amt = parseFloat(row.amount) || 0;
        const fee = parseFloat(row.metadata?.fee) || 0;
        return acc + amt + fee;
      },
      0
    );
  }

  const totalDbLiability = totalDbUserBalance + totalPendingWithdrawals;

  // 3. Query total multi-chain USDT on-chain reserves held in Hot Wallet
  let totalOnChainBalance = 0;
  const networkConfigs = [
    { net: 'ERC20', chainId: 1, rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com' },
    { net: 'BEP20', chainId: 56, rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org' },
    { net: 'POLYGON', chainId: 137, rpc: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com' },
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
    }
  }

  // 4. Calculate discrepancy
  const discrepancy = totalOnChainBalance - totalDbLiability;
  // A slight positive variance can exist due to accumulated fee revenue; negative variance indicates potential issue
  const isBalanced = discrepancy >= 0;

  const gasStatuses = await checkHotWalletGasLevels();

  // 5. Store reconciliation snapshot in DB
  try {
    await supabaseAdmin.from('system_reconciliations').insert({
      asset_symbol: assetSymbol,
      db_liability: totalDbLiability,
      onchain_balance: totalOnChainBalance,
      discrepancy,
      is_balanced: isBalanced,
      gas_snapshot: gasStatuses,
    });
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

  // 2. Log Low Gas Token Alerts
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
