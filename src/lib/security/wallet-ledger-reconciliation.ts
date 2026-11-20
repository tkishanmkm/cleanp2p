export type WalletLedgerAnomalyType =
  | 'BALANCE_DRIFT'
  | 'NEGATIVE_BALANCE'
  | 'UNAUTHORIZED_CREDIT'
  | 'UNDER_COLLATERALIZED'
  | 'ACCOUNTING_BUCKET_INVALID'
  | 'LEDGER_SNAPSHOT_MISSING'
  | 'ORPHANED_LEDGER_ASSET';

export interface WalletAssetBalanceRow {
  id: string;
  user_id: string;
  asset_symbol: string;
  balance: string | number | null;
  locked_balance: string | number | null;
  reserved_balance: string | number | null;
  in_escrow: string | number | null;
  in_withdrawal: string | number | null;
}

export interface LedgerBalanceSnapshotRow {
  id: string;
  user_id: string;
  asset: string | null;
  crypto: string | null;
  balance_after: string | number | null;
  created_at: string | null;
}

export interface WalletLedgerDiscrepancy {
  walletId: string;
  userId: string;
  assetSymbol: string;
  walletBalance: string;
  ledgerSum: string;
  discrepancy: string;
  anomalyType: WalletLedgerAnomalyType;
  details: string;
}

export interface WalletLedgerComparison {
  totalWalletAssetsAudited: number;
  balancedWallets: number;
  totalUsdtLiability: string;
  discrepancies: WalletLedgerDiscrepancy[];
}

const SCALE = 1_000_000_000_000_000_000n;
const BALANCE_TOLERANCE = 100_000_000_000_000n; // 0.0001 at 18 decimal places.

function parseNumericUnits(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!text || /[eE]/.test(text)) return null;

  const match = /^(-?)(\d+)(?:\.(\d{1,18}))?$/.exec(text);
  if (!match) return null;

  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || '').padEnd(18, '0') || '0');
  const units = whole * SCALE + fraction;
  return match[1] === '-' ? -units : units;
}

function formatNumericUnits(value: bigint): string {
  if (value === 0n) return '0';
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(18, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

function normalizeAsset(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

function ledgerKey(userId: string, assetSymbol: string): string {
  return `${userId}:${assetSymbol}`;
}

function isLaterLedgerSnapshot(
  candidate: LedgerBalanceSnapshotRow,
  current: LedgerBalanceSnapshotRow
): boolean {
  const candidateTime = candidate.created_at ? Date.parse(candidate.created_at) : Number.NaN;
  const currentTime = current.created_at ? Date.parse(current.created_at) : Number.NaN;
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  if (Number.isFinite(candidateTime) && !Number.isFinite(currentTime)) return true;
  if (!Number.isFinite(candidateTime) && Number.isFinite(currentTime)) return false;
  return candidate.id.localeCompare(current.id) > 0;
}

function discrepancy(
  wallet: WalletAssetBalanceRow,
  anomalyType: WalletLedgerAnomalyType,
  walletUnits: bigint,
  ledgerUnits: bigint,
  details: string
): WalletLedgerDiscrepancy {
  const diff = walletUnits >= ledgerUnits ? walletUnits - ledgerUnits : ledgerUnits - walletUnits;
  return {
    walletId: wallet.id,
    userId: wallet.user_id,
    assetSymbol: normalizeAsset(wallet.asset_symbol),
    walletBalance: formatNumericUnits(walletUnits),
    ledgerSum: formatNumericUnits(ledgerUnits),
    discrepancy: formatNumericUnits(diff),
    anomalyType,
    details,
  };
}

/**
 * Reconcile canonical wallet_assets balances with the latest ledger balance_after
 * snapshot for the same (user_id, asset) identity. Ledger amount is deliberately
 * not summed: different transaction types record direction/settlement semantics
 * differently, while balance_after is the account balance after that transaction.
 */
export function compareWalletAssetsToLedger(
  walletAssets: WalletAssetBalanceRow[],
  ledgerEntries: LedgerBalanceSnapshotRow[]
): WalletLedgerComparison {
  const latestLedgerByAsset = new Map<string, LedgerBalanceSnapshotRow>();

  for (const entry of ledgerEntries) {
    const assetSymbol = normalizeAsset(entry.asset) || normalizeAsset(entry.crypto);
    if (!entry.user_id || !assetSymbol) continue;

    const key = ledgerKey(entry.user_id, assetSymbol);
    const current = latestLedgerByAsset.get(key);
    if (!current || isLaterLedgerSnapshot(entry, current)) {
      latestLedgerByAsset.set(key, entry);
    }
  }

  const walletKeys = new Set<string>();
  const discrepancies: WalletLedgerDiscrepancy[] = [];
  let balancedWallets = 0;
  let totalUsdtLiabilityUnits = 0n;

  for (const wallet of walletAssets) {
    const assetSymbol = normalizeAsset(wallet.asset_symbol);
    const key = ledgerKey(wallet.user_id, assetSymbol);
    walletKeys.add(key);

    const balance = parseNumericUnits(wallet.balance);
    const locked = parseNumericUnits(wallet.locked_balance ?? '0');
    const reserved = parseNumericUnits(wallet.reserved_balance ?? '0');
    const inEscrow = parseNumericUnits(wallet.in_escrow ?? '0');
    const inWithdrawal = parseNumericUnits(wallet.in_withdrawal ?? '0');

    if (
      balance === null ||
      locked === null ||
      reserved === null ||
      inEscrow === null ||
      inWithdrawal === null
    ) {
      discrepancies.push(discrepancy(
        wallet,
        'ACCOUNTING_BUCKET_INVALID',
        balance ?? 0n,
        0n,
        'One or more canonical wallet accounting buckets are NULL or not a finite decimal value.'
      ));
      continue;
    }

    if (assetSymbol === 'USDT' && balance >= 0n) {
      totalUsdtLiabilityUnits += balance;
    }

    if (balance < 0n || locked < 0n || reserved < 0n || inEscrow < 0n || inWithdrawal < 0n) {
      discrepancies.push(discrepancy(
        wallet,
        'NEGATIVE_BALANCE',
        balance,
        0n,
        `Negative accounting bucket detected: balance=${formatNumericUnits(balance)}, locked=${formatNumericUnits(locked)}, reserved=${formatNumericUnits(reserved)}, escrow=${formatNumericUnits(inEscrow)}, withdrawal=${formatNumericUnits(inWithdrawal)}.`
      ));
      continue;
    }

    // The production BEFORE trigger keeps locked_balance and reserved_balance
    // as mirrors. Escrow/withdrawal buckets are separate and are not summed here.
    if (locked !== reserved) {
      discrepancies.push(discrepancy(
        wallet,
        'ACCOUNTING_BUCKET_INVALID',
        locked,
        reserved,
        `locked_balance (${formatNumericUnits(locked)}) does not match reserved_balance (${formatNumericUnits(reserved)}).`
      ));
      continue;
    }

    const ledger = latestLedgerByAsset.get(key);
    if (!ledger) {
      if (balance > 0n) {
        discrepancies.push(discrepancy(
          wallet,
          'UNAUTHORIZED_CREDIT',
          balance,
          0n,
          `Canonical wallet balance is ${formatNumericUnits(balance)} ${assetSymbol} but no ledger entry exists for this user and asset.`
        ));
      } else {
        balancedWallets++;
      }
      continue;
    }

    const ledgerBalance = parseNumericUnits(ledger.balance_after);
    if (ledgerBalance === null) {
      discrepancies.push(discrepancy(
        wallet,
        'LEDGER_SNAPSHOT_MISSING',
        balance,
        0n,
        `Latest ledger entry ${ledger.id} has no valid balance_after snapshot; reconciliation is inconclusive.`
      ));
      continue;
    }

    const diff = balance >= ledgerBalance ? balance - ledgerBalance : ledgerBalance - balance;
    if (diff > BALANCE_TOLERANCE) {
      discrepancies.push(discrepancy(
        wallet,
        'BALANCE_DRIFT',
        balance,
        ledgerBalance,
        `Canonical wallet balance (${formatNumericUnits(balance)}) differs from the latest ledger balance_after (${formatNumericUnits(ledgerBalance)}) by ${formatNumericUnits(diff)}.`
      ));
      continue;
    }

    balancedWallets++;
  }

  for (const [key, ledger] of latestLedgerByAsset) {
    if (walletKeys.has(key)) continue;
    const snapshot = parseNumericUnits(ledger.balance_after);
    if (snapshot !== null && snapshot !== 0n) {
      const [userId, assetSymbol] = key.split(':', 2);
      discrepancies.push({
        walletId: 'MISSING_WALLET_ASSET',
        userId,
        assetSymbol,
        walletBalance: '0',
        ledgerSum: formatNumericUnits(snapshot),
        discrepancy: formatNumericUnits(snapshot < 0n ? -snapshot : snapshot),
        anomalyType: 'ORPHANED_LEDGER_ASSET',
        details: `Ledger account snapshot ${formatNumericUnits(snapshot)} ${assetSymbol} has no canonical wallet_assets row.`,
      });
    }
  }

  return {
    totalWalletAssetsAudited: walletAssets.length,
    balancedWallets,
    totalUsdtLiability: formatNumericUnits(totalUsdtLiabilityUnits),
    discrepancies,
  };
}
