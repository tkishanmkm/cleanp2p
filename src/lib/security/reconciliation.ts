import { ethers } from 'ethers';
import { supabaseService as supabaseAdmin } from '@/lib/supabase/service-role';
import { getEvmProvider, SUPPORTED_EVM_CHAINS } from '@/lib/blockchain/providers';
import { getTronWeb, TRON_CONFIG } from '@/lib/blockchain/tron';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import {
  compareWalletAssetsToLedger,
  formatNumericUnits,
  parseNumericUnits,
  type LedgerBalanceSnapshotRow,
  type WalletAssetBalanceRow,
  type WalletLedgerDiscrepancy,
} from '@/lib/security/wallet-ledger-reconciliation';

const PAGE_SIZE = 1000;
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

export interface HotWalletReserveStatus {
  network: string;
  address: string;
  onchainBalance: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNCONFIGURED';
  error?: string;
}

export type DiscrepancyAlert = WalletLedgerDiscrepancy;

export interface ReconciliationReport {
  totalUsersAudited: number;
  totalWalletAssetsAudited: number;
  balancedWallets: number;
  anomalousWallets: number;
  totalLiability: string;
  totalHotWalletUsdt: string;
  solvencyVerified: boolean;
  solvencyReasons: string[];
  hotWalletReserves: HotWalletReserveStatus[];
  discrepancies: DiscrepancyAlert[];
  isBalanced: boolean;
}

function formatRawUnits(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function getEnabledReserveNetworks(): string[] {
  const networks = ['BEP20'];

  if (process.env.EVM_RPC_URL || process.env.ETH_RPC_URL || process.env.BSC_RPC_URL) {
    networks.push('ERC20');
  }

  if (process.env.TRON_HOT_WALLET_ADDRESS) {
    networks.push('TRC20');
  }

  return networks;
}

/**
 * Read-only on-chain reserve check. It uses public wallet addresses only and
 * deliberately does not initialize/sign with a hot-wallet private key.
 */
export async function getHotWalletOnchainBalance(
  network: string,
  assetSymbol: string = 'USDT'
): Promise<HotWalletReserveStatus> {
  const normNet = network.toUpperCase().trim();
  const asset = assetSymbol.toUpperCase().trim();

  if (asset !== 'USDT') {
    return {
      network: normNet,
      address: '',
      onchainBalance: '0',
      status: 'UNCONFIGURED',
      error: 'The reserve reconciliation currently supports USDT only.',
    };
  }

  if (normNet === 'TRC20') {
    const address = process.env.TRON_HOT_WALLET_ADDRESS?.trim() || '';
    if (!address || !TRON_CONFIG.usdtContract) {
      return {
        network: normNet,
        address,
        onchainBalance: '0',
        status: 'UNCONFIGURED',
        error: 'TRON hot-wallet address or canonical USDT contract is not configured.',
      };
    }

    try {
      const tronWeb = getTronWeb();
      const contract = await tronWeb.contract().at(TRON_CONFIG.usdtContract);
      const rawBalance = await contract.balanceOf(address).call();
      const rawUnits = BigInt(rawBalance.toString());
      return {
        network: normNet,
        address,
        onchainBalance: formatRawUnits(rawUnits, 6),
        status: 'ONLINE',
      };
    } catch (error: unknown) {
      return {
        network: normNet,
        address,
        onchainBalance: '0',
        status: 'OFFLINE',
        error: error instanceof Error ? error.message : 'Unknown TRON reserve lookup error.',
      };
    }
  }

  const address =
    process.env.EVM_HOT_WALLET_ADDRESS?.trim() ||
    process.env.HOT_WALLET_ADDRESS?.trim() ||
    '';
  const tokenAddress = CANONICAL_USDT_CONTRACTS[normNet as keyof typeof CANONICAL_USDT_CONTRACTS];
  const chainConfig = SUPPORTED_EVM_CHAINS[normNet];

  if (!address || !tokenAddress || !chainConfig) {
    return {
      network: normNet,
      address,
      onchainBalance: '0',
      status: 'UNCONFIGURED',
      error: 'EVM hot-wallet address, chain configuration, or canonical USDT contract is missing.',
    };
  }

  try {
    const provider = getEvmProvider(normNet);
    const actualNetwork = await provider.getNetwork();
    if (actualNetwork.chainId !== BigInt(chainConfig.chainId)) {
      throw new Error('Configured RPC chain ID does not match the expected network.');
    }

    const token = new ethers.Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
    const rawBalance = await token.balanceOf(address) as bigint;
    const decimals = chainConfig.usdtDecimals ?? 6;

    return {
      network: normNet,
      address,
      onchainBalance: ethers.formatUnits(rawBalance, decimals),
      status: 'ONLINE',
    };
  } catch (error: unknown) {
    return {
      network: normNet,
      address,
      onchainBalance: '0',
      status: 'OFFLINE',
      error: error instanceof Error ? error.message : 'Unknown EVM reserve lookup error.',
    };
  }
}

async function fetchAllWalletAssets(): Promise<WalletAssetBalanceRow[]> {
  const rows: WalletAssetBalanceRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('wallet_assets')
      .select('id,user_id,asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal')
      .order('user_id', { ascending: true })
      .order('asset_symbol', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Wallet asset reconciliation query failed: ${error.message}`);
    }

    const page = (data || []) as unknown as WalletAssetBalanceRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllLedgerSnapshots(): Promise<LedgerBalanceSnapshotRow[]> {
  const rows: LedgerBalanceSnapshotRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('ledger_entries')
      .select('id,user_id,asset,crypto,balance_after,created_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Ledger reconciliation query failed: ${error.message}`);
    }

    const page = (data || []) as unknown as LedgerBalanceSnapshotRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function upsertReconciliationAlert(alert: DiscrepancyAlert): Promise<void> {
  const metadata = {
    wallet_id: alert.walletId,
    user_id: alert.userId,
    asset: alert.assetSymbol,
    wallet_balance: alert.walletBalance,
    ledger_balance_after: alert.ledgerSum,
    discrepancy: alert.discrepancy,
    anomaly_type: alert.anomalyType,
  };
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('system_alerts')
    .select('id')
    .eq('alert_type', alert.anomalyType)
    .eq('is_resolved', false)
    .contains('metadata', {
      wallet_id: alert.walletId,
      user_id: alert.userId,
      asset: alert.assetSymbol,
    })
    .order('created_at', { ascending: false })
    .limit(1);

  if (lookupError) {
    console.error('[Reconciliation] Could not check for an existing alert:', lookupError.message);
    return;
  }

  const message = `Wallet reconciliation anomaly for ${alert.assetSymbol}: ${alert.details}`;
  const title = `Wallet ${alert.anomalyType.replace(/_/g, ' ')}`;
  const existingId = existing?.[0]?.id;

  if (existingId) {
    const { error } = await supabaseAdmin
      .from('system_alerts')
      .update({ title, message, severity: 'CRITICAL', metadata })
      .eq('id', existingId)
      .eq('is_resolved', false);
    if (error) console.error('[Reconciliation] Could not update an existing alert:', error.message);
    return;
  }

  const { error } = await supabaseAdmin.from('system_alerts').insert({
    alert_type: alert.anomalyType,
    severity: 'CRITICAL',
    title,
    message,
    metadata,
    is_resolved: false,
  });
  if (error) console.error('[Reconciliation] Could not insert an alert:', error.message);
}

/**
 * Reconcile the canonical wallet_assets balance with the latest ledger_entries
 * balance_after snapshot for the same user and asset.
 *
 * Do not sum ledger_entries.amount: deposit, withdrawal, transfer, escrow and
 * fee entries encode transaction direction/status differently. Their
 * balance_after value is the authoritative post-transaction snapshot.
 */
export async function runFinancialReconciliation(): Promise<ReconciliationReport> {
  try {
    const [walletAssets, ledgerEntries] = await Promise.all([
      fetchAllWalletAssets(),
      fetchAllLedgerSnapshots(),
    ]);

    const comparison = compareWalletAssetsToLedger(walletAssets, ledgerEntries);
    const hotWalletReserves = await Promise.all(
      getEnabledReserveNetworks().map((network) => getHotWalletOnchainBalance(network, 'USDT'))
    );

    let totalHotWalletUnits = 0n;
    const solvencyReasons: string[] = [];
    for (const reserve of hotWalletReserves) {
      if (reserve.status !== 'ONLINE') {
        solvencyReasons.push(`${reserve.network}: ${reserve.status}${reserve.error ? ` — ${reserve.error}` : ''}`);
        continue;
      }
      const reserveUnits = parseNumericUnits(reserve.onchainBalance);
      if (reserveUnits === null || reserveUnits < 0n) {
        solvencyReasons.push(`${reserve.network}: invalid reserve balance response`);
        continue;
      }
      totalHotWalletUnits += reserveUnits;
    }

    const accountingBucketsInvalid = comparison.discrepancies.some((item) =>
      item.anomalyType === 'NEGATIVE_BALANCE' ||
      item.anomalyType === 'ACCOUNTING_BUCKET_INVALID'
    );
    const solvencyVerified =
      hotWalletReserves.length > 0 &&
      solvencyReasons.length === 0 &&
      !accountingBucketsInvalid &&
      hotWalletReserves.every((reserve) => reserve.status === 'ONLINE');

    const totalLiabilityUnits = parseNumericUnits(comparison.totalUsdtLiability) ?? 0n;
    const discrepancies = [...comparison.discrepancies];

    // Never interpret an offline/unconfigured reserve as a zero balance. Only
    // emit an under-collateralization finding when every enabled reserve source
    // returned an independently verified on-chain balance.
    if (solvencyVerified && totalHotWalletUnits < totalLiabilityUnits) {
      const shortfall = totalLiabilityUnits - totalHotWalletUnits;
      discrepancies.push({
        walletId: 'SYSTEM_HOT_WALLET',
        userId: 'SYSTEM',
        assetSymbol: 'USDT',
        walletBalance: formatNumericUnits(totalLiabilityUnits),
        ledgerSum: formatNumericUnits(totalHotWalletUnits),
        discrepancy: formatNumericUnits(shortfall),
        anomalyType: 'UNDER_COLLATERALIZED',
        details: `Verified hot wallet reserves (${formatNumericUnits(totalHotWalletUnits)} USDT) are below wallet liabilities (${formatNumericUnits(totalLiabilityUnits)} USDT).`,
      });
    }

    for (const alert of discrepancies) {
      await upsertReconciliationAlert(alert);
    }

    const isBalanced = discrepancies.length === 0 && solvencyVerified;
    const report: ReconciliationReport = {
      totalUsersAudited: new Set(walletAssets.map((wallet) => wallet.user_id)).size,
      totalWalletAssetsAudited: comparison.totalWalletAssetsAudited,
      balancedWallets: comparison.balancedWallets,
      anomalousWallets: discrepancies.length,
      totalLiability: comparison.totalUsdtLiability,
      totalHotWalletUsdt: formatNumericUnits(totalHotWalletUnits),
      solvencyVerified,
      solvencyReasons,
      hotWalletReserves,
      discrepancies,
      isBalanced,
    };

    const { error: snapshotError } = await supabaseAdmin
      .from('system_reconciliations')
      .insert({
        asset_symbol: 'USDT',
        db_liability: comparison.totalUsdtLiability,
        onchain_balance: formatNumericUnits(totalHotWalletUnits),
        discrepancy: solvencyVerified
          ? formatNumericUnits(totalHotWalletUnits - totalLiabilityUnits)
          : '0',
        is_balanced: isBalanced,
        gas_snapshot: hotWalletReserves,
      });

    if (snapshotError) {
      console.error('[Reconciliation] Could not persist reconciliation snapshot:', snapshotError.message);
    }

    return report;
  } catch (error: unknown) {
    console.error('[Reconciliation] Error running reconciliation:', error);
    throw error;
  }
}
