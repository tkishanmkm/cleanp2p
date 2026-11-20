import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const tableDml = read('supabase/migrations/20261105320000_restrict_financial_table_dml.sql');
const alertDedupe = read('supabase/migrations/20261024160000_system_alert_active_deduplication.sql');
const reconciliationTotals = read('supabase/migrations/20261106115041_withdrawal_reconciliation_canonical_aggregation.sql');
const legacyHelperRetirement = read('supabase/migrations/20261107160000_restrict_legacy_financial_mutation_helpers.sql');
const adjustmentRepair = read('supabase/migrations/20261120201500_step_11_repair_admin_wallet_adjustment_ledger_contract.sql');
const walletBucketInvariants = read('supabase/migrations/20261120213000_step_11_enforce_wallet_bucket_invariants.sql');
const reconciliationWorker = read('src/jobs/reconciliationWorker.ts');
const walletContext = read('src/context/wallet-context.tsx');
const myAdsPage = read('src/app/(dashboard)/my-ads/page.tsx');
const myAdsRoute = read('src/app/api/p2p/my-ads/route.ts');
const adminWalletsRoute = read('src/app/api/admin/wallets/route.ts');
const adminMetricsRoute = read('src/app/api/admin/metrics/route.ts');
const adminUserDetailRoute = read('src/app/api/admin/users/[userId]/route.ts');
const adminUsersRoute = read('src/app/api/admin/users/route.ts');
const adminWalletPage = read('src/app/adminnarayan/wallets/page.tsx');
const sharedWalletDb = read('src/lib/supabase/db.ts');
const walletLedger = read('src/lib/security/wallet-ledger-reconciliation.ts');
const reconciliationService = read('src/lib/security/reconciliation.ts');
const walletContext = read('src/context/wallet-context.tsx');
const myAdsPage = read('src/app/(dashboard)/my-ads/page.tsx');
const myAdsRoute = read('src/app/api/p2p/my-ads/route.ts');
const adminWalletsRoute = read('src/app/api/admin/wallets/route.ts');
const adminMetricsRoute = read('src/app/api/admin/metrics/route.ts');
const adminUserDetailRoute = read('src/app/api/admin/users/[userId]/route.ts');
const adminUsersRoute = read('src/app/api/admin/users/route.ts');
const adminWalletPage = read('src/app/adminnarayan/wallets/page.tsx');
const sharedWalletDb = read('src/lib/supabase/db.ts');
const balanceNormalizer = read('src/lib/wallet-balance-normalization.ts');
const walletRoute = read('src/app/api/wallet/route.ts');
const walletBalanceRoute = read('src/app/api/wallet/balance/route.ts');

test('financial wallet tables retain authenticated owner reads but no direct browser DML', () => {
  assert.match(tableDml, /REVOKE ALL PRIVILEGES ON TABLE public\.wallet_assets[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(tableDml, /REVOKE ALL PRIVILEGES ON TABLE public\.wallets[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(tableDml, /GRANT SELECT ON TABLE public\.trades,[\s\S]*public\.wallet_assets,[\s\S]*public\.wallets,[\s\S]*public\.user_wallets[\s\S]*TO authenticated/);
  assert.match(tableDml, /ALTER TABLE public\.wallet_assets ENABLE ROW LEVEL SECURITY/);
  assert.match(tableDml, /ALTER TABLE public\.wallets ENABLE ROW LEVEL SECURITY/);
  assert.match(tableDml, /preserve its owner\/participant SELECT policy/i);
});

test('system alert active deduplication uses a partial unique index without deleting old alerts', () => {
  assert.match(alertDedupe, /ADD COLUMN IF NOT EXISTS dedupe_key TEXT/);
  assert.match(alertDedupe, /CREATE UNIQUE INDEX IF NOT EXISTS uq_system_alerts_active_dedupe_key/);
  assert.match(alertDedupe, /WHERE is_resolved = FALSE AND dedupe_key IS NOT NULL/);
  assert.match(alertDedupe, /Existing rows are left intact/);
});

test('canonical reconciliation aggregate includes all held liability buckets exactly once', () => {
  assert.match(reconciliationTotals, /CREATE OR REPLACE FUNCTION public\.get_withdrawal_reconciliation_totals/);
  assert.match(reconciliationTotals, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(reconciliationTotals, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(reconciliationTotals, /coalesce\(wa\.balance, 0\)[\s\S]*coalesce\(wa\.locked_balance, 0\)[\s\S]*coalesce\(wa\.in_escrow, 0\)[\s\S]*coalesce\(wa\.in_withdrawal, 0\)/);
  assert.match(reconciliationTotals, /locked_balance[\s\S]*reserved_balance/);
  assert.match(reconciliationTotals, /RETURN QUERY[\s\S]*\)::text/);
  assert.match(reconciliationTotals, /GRANT EXECUTE ON FUNCTION public\.get_withdrawal_reconciliation_totals\(text\)[\s\S]*TO service_role, postgres/);
});

test('legacy direct balance and ledger helpers are retired only after dependency checks', () => {
  for (const name of [
    'admin_adjust_balance',
    'ensure_user_balance_wallet',
    'mark_gas_funded',
    'mark_swept',
    'record_platform_ledger_entry',
  ]) assert.ok(legacyHelperRetirement.includes(name), `missing helper retirement: ${name}`);
  assert.match(legacyHelperRetirement, /v_caller_count <> 2/);
  assert.match(legacyHelperRetirement, /caller\.prosecdef IS NOT TRUE/);
  assert.match(legacyHelperRetirement, /caller\.proowner\) <> 'postgres'/);
  assert.match(legacyHelperRetirement, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(legacyHelperRetirement, /ALTER FUNCTION public\.execute_internal_transfer\(uuid,text,text,numeric,text\)[\s\S]*SET search_path = ''/);
});

test('wallet bucket database constraints reject negative/non-finite values and preserve reserve mirroring', () => {
  assert.match(walletBucketInvariants, /wallet_assets_balance_nonnegative_finite_check/);
  assert.match(walletBucketInvariants, /wallet_assets_locked_nonnegative_finite_check/);
  assert.match(walletBucketInvariants, /wallet_assets_reserved_nonnegative_finite_check/);
  assert.match(walletBucketInvariants, /wallet_assets_escrow_nonnegative_finite_check/);
  assert.match(walletBucketInvariants, /wallet_assets_withdrawal_nonnegative_finite_check/);
  assert.match(walletBucketInvariants, /wallet_assets_reserved_mirror_check/);
  assert.match(walletBucketInvariants, /balance < 'Infinity'::numeric/);
  assert.match(walletBucketInvariants, /COALESCE\(locked_balance, 0\) = reserved_balance/);
  assert.match(walletBucketInvariants, /v_negative_rows <> 0 OR v_mirror_mismatch_rows <> 0/);
  assert.match(walletBucketInvariants, /v_source_after IS DISTINCT FROM v_source_before/);
  assert.match(walletBucketInvariants, /search_path=""/);
});

test('admin adjustment ledger event types and active-admin identity are made compatible atomically', () => {
  assert.match(adjustmentRepair, /ledger_entries_type_check/);
  assert.match(adjustmentRepair, /'admin_add'[\s\S]*'admin_subtract'/);
  assert.match(adjustmentRepair, /public\.is_active_admin_identity\(p_admin_id\)/);
  assert.match(adjustmentRepair, /v_acl_after IS DISTINCT FROM v_acl_before/);
  assert.match(adjustmentRepair, /ledger_entries contains % pre-existing rows outside the current allowed transaction types/);
  assert.match(adjustmentRepair, /BEGIN;[\s\S]*COMMIT;/);
});

test('active reconciliation fails closed unless ERC20, BEP20 and TRC20 reserves can all be read', () => {
  assert.match(reconciliationWorker, /get_withdrawal_reconciliation_totals/);
  assert.match(reconciliationWorker, /getTronWeb, isValidTronAddress, TRON_CONFIG/);
  assert.match(reconciliationWorker, /process\.env\.TRON_HOT_WALLET_ADDRESS/);
  assert.match(reconciliationWorker, /isValidTronAddress\(tronHotWalletAddress\)/);
  assert.match(reconciliationWorker, /getTronWeb\(false\)/);
  assert.match(reconciliationWorker, /tronWeb\.contract\(\)\.at\(TRON_CONFIG\.usdtContract\)/);
  assert.match(reconciliationWorker, /TRON_CONFIG\.usdtDecimals/);
  assert.match(reconciliationWorker, /Reconciliation incomplete: failed fetching TRC20 reserve balance/);
  assert.match(reconciliationWorker, /provider\.send\('eth_chainId', \[\]\)/);
  assert.match(reconciliationWorker, /actualChainId !== BigInt\(item\.chainId\)/);
  assert.doesNotMatch(reconciliationWorker, /HOT_WALLET_PRIVATE_KEY|EVM_HOT_WALLET_PRIVATE_KEY/);
  assert.match(reconciliationWorker, /system_reconciliations/);
  assert.match(reconciliationWorker, /dedupe_key: dedupeKey/);
  assert.match(reconciliationWorker, /\.eq\('alert_type', type\)/);
  assert.match(reconciliationWorker, /\.eq\('title', title\)/);
  assert.match(reconciliationWorker, /\.eq\('is_resolved', false\)/);
  assert.match(reconciliationWorker, /existing && existing\.length > 0/);
  assert.match(reconciliationWorker, /status: 'UNAVAILABLE'/);
  assert.match(reconciliationWorker, /Native Gas Balance Check Unavailable/);
  assert.match(reconciliationWorker, /gas\.status === 'UNAVAILABLE'/);
  assert.match(reconciliationWorker, /gas\.status === 'ONLINE'/);
  assert.doesNotMatch(reconciliationWorker, /nativeBalance: '0\.0'[\s\S]*isSufficient: false[\s\S]*status: 'ONLINE'/);
});

test('wallet read endpoints treat wallet_assets.balance as already spendable', () => {
  assert.match(walletRoute, /\.from\('wallet_assets'\)/);
  assert.match(walletRoute, /\.select\('asset_symbol,balance,updated_at'\)/);
  assert.match(walletRoute, /availableBalance = balance/);
  assert.doesNotMatch(walletRoute, /balance - locked/);
  assert.doesNotMatch(walletRoute, /from\('user_wallets'\)/);
  assert.doesNotMatch(walletRoute, /from\('wallets'\)/);

  assert.match(walletBalanceRoute, /\.from\('wallet_assets'\)/);
  assert.match(walletBalanceRoute, /normalizePrimaryWalletAssetBalance\(row\)/);
  assert.match(walletBalanceRoute, /normalized\.accountingValid/);
  assert.match(walletBalanceRoute, /Duplicate canonical wallet asset row/);
  assert.doesNotMatch(walletBalanceRoute, /from\('trades'\)/);
  assert.doesNotMatch(walletBalanceRoute, /from\('p2p_trades'\)/);
});

test('wallet normalization keeps reserved, escrow and withdrawal buckets separate', () => {
  assert.match(balanceNormalizer, /available = finiteNonNegative\(row\.balance\)/);
  assert.match(balanceNormalizer, /reserved = finiteNonNegative\(row\.reserved_balance\)/);
  assert.match(balanceNormalizer, /lockedMirror = finiteNonNegative\(row\.locked_balance\)/);
  assert.match(balanceNormalizer, /inEscrow = finiteNonNegative\(row\.in_escrow\)/);
  assert.match(balanceNormalizer, /inWithdrawal = finiteNonNegative\(row\.in_withdrawal\)/);
  assert.match(balanceNormalizer, /lockedMirror === reserved/);
  assert.match(balanceNormalizer, /safeAvailable \+ safeReserved \+ safeEscrow \+ safeWithdrawal/);
  assert.doesNotMatch(balanceNormalizer, /activeEscrowFallback/);
});

test('wallet context portfolio totals include the reserved bucket exactly once', () => {
  assert.match(walletContext, /reserved: number/);
  assert.match(walletContext, /coinItem\.reserved/);
  assert.match(walletContext, /totalCoin = \(data\.available \|\| 0\) \+ \(data\.reserved \|\| 0\) \+ \(data\.inEscrow \|\| 0\) \+ \(data\.inWithdrawal \|\| 0\)/);
  assert.match(walletContext, /inWithdrawal: prev\[asset\]\.inWithdrawal \+ totalDeduction/);
});

test('My Ads never max-merges legacy wallet tables or ad-published availability', () => {
  assert.match(myAdsRoute, /normalizePrimaryWalletAssetBalance\(wallet\)/);
  assert.match(myAdsRoute, /seenAssets\.has\(symbol\)/);
  assert.match(myAdsRoute, /balances\[symbol\] = normalized\.available/);
  assert.match(myAdsPage, /userCoinBalances\[coin\]/);
  assert.doesNotMatch(myAdsPage, /walletContextBalances/);
  assert.doesNotMatch(myAdsPage, /raw\.available_crypto|raw\.available_amount/);
  assert.doesNotMatch(myAdsPage, /from\('wallet_assets'\)|from\('user_wallets'\)/);
});

test('admin aggregate and user detail reports preserve reserved, escrow and withdrawal as separate buckets', () => {
  assert.match(adminWalletsRoute, /reserved: number/);
  assert.match(adminWalletsRoute, /systemBalances\[currency\]\.reserved \+= normalized\.reserved/);
  assert.match(adminWalletsRoute, /item\.available \+ item\.reserved \+ item\.escrow \+ item\.pendingWithdrawal/);
  assert.match(adminMetricsRoute, /totalReserved/);
  assert.match(adminMetricsRoute, /totalAvailable \+ totalReserved \+ totalLockedEscrow \+ totalLockedWithdrawal/);
  assert.match(adminUserDetailRoute, /reserved_balance: normalized\.reserved/);
  assert.match(adminUserDetailRoute, /reserved_total: normalized\.reserved \+ normalized\.inEscrow \+ normalized\.inWithdrawal/);
  assert.match(adminUsersRoute, /reserved_balance: normalized\.reserved/);
  assert.match(adminUsersRoute, /normalized\.accountingValid/);
  assert.match(adminWalletPage, /Reserved:/);
  assert.match(adminWalletPage, /bal\.reserved/);
});

test('shared wallet repository helper uses the production wallet_assets column contract', () => {
  assert.match(sharedWalletDb, /\.select\('user_id,asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal,updated_at'\)/);
  assert.doesNotMatch(sharedWalletDb, /\.select\('asset_symbol, available, locked, updated_at'\)/);
  assert.match(sharedWalletDb, /reserved_balance: Number\(row\.reserved_balance \?\? 0\)/);
});

test('wallet context portfolio totals include reserved amounts exactly once', () => {
  assert.match(walletContext, /reserved: number/);
  assert.match(walletContext, /coinItem\.reserved/);
  assert.match(walletContext, /totalCoin = \(data\.available \|\| 0\) \+ \(data\.reserved \|\| 0\) \+ \(data\.inEscrow \|\| 0\) \+ \(data\.inWithdrawal \|\| 0\)/);
});

test('My Ads uses only the canonical server-provided available balance', () => {
  assert.match(myAdsRoute, /normalizePrimaryWalletAssetBalance\(wallet\)/);
  assert.match(myAdsRoute, /seenAssets\.has\(symbol\)/);
  assert.match(myAdsRoute, /balances\[symbol\] = normalized\.available/);
  assert.match(myAdsPage, /userCoinBalances\[coin\]/);
  assert.doesNotMatch(myAdsPage, /walletContextBalances|raw\.available_crypto|raw\.available_amount/);
  assert.doesNotMatch(myAdsPage, /from\('wallet_assets'\)|from\('user_wallets'\)/);
});

test('admin wallet reports preserve each canonical bucket and reject mirror drift', () => {
  assert.match(adminWalletsRoute, /systemBalances\[currency\]\.reserved \+= normalized\.reserved/);
  assert.match(adminWalletsRoute, /item\.available \+ item\.reserved \+ item\.escrow \+ item\.pendingWithdrawal/);
  assert.match(adminMetricsRoute, /totalReserved/);
  assert.match(adminMetricsRoute, /totalAvailable \+ totalReserved \+ totalLockedEscrow \+ totalLockedWithdrawal/);
  assert.match(adminUserDetailRoute, /reserved_balance: normalized\.reserved/);
  assert.match(adminUserDetailRoute, /normalized\.accountingValid/);
  assert.match(adminUsersRoute, /reserved_balance: normalized\.reserved/);
  assert.match(adminUsersRoute, /normalized\.accountingValid/);
  assert.match(adminWalletPage, /Reserved:/);
  assert.match(adminWalletPage, /bal\.reserved/);
});

test('shared wallet database contract matches production column names', () => {
  assert.match(sharedWalletDb, /asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal/);
  assert.doesNotMatch(sharedWalletDb, /asset_code,available,locked_escrow/);
});

test('exact ledger snapshot reconciliation never sums signed event amounts or double-counts mirrored buckets', () => {
  assert.match(walletLedger, /balance_after/);
  assert.match(walletLedger, /locked_balance is a mirror of reserved_balance/);
  assert.match(walletLedger, /totalLiabilityUnits = balance \+ reserved \+ inEscrow \+ inWithdrawal/);
  assert.match(walletLedger, /LEDGER_SNAPSHOT_AMBIGUOUS/);
  assert.match(walletLedger, /BALANCE_TOLERANCE = 0n/);
  assert.doesNotMatch(walletLedger, /sum\(ledger_entries\.amount\)/);
  assert.match(reconciliationService, /ledger_balance_after: alert\.ledgerBalanceAfter/);
});
