import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Static guard only: this verifies that the candidate migration preserves key
// safety properties in source. It does NOT execute SQL or replace DB integration tests.
const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261015130000_restore_p2p_trade_fee_ledger_on_release.sql'
);
const sql = readFileSync(migrationPath, 'utf8');
const chatMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260831000001_realtime_chat.sql'
);
const chatMigrationSql = readFileSync(chatMigrationPath, 'utf8');
assert.equal(
  (chatMigrationSql.match(/to_jsonb\(t\)->>'firestore_trade_id'/g) ?? []).length,
  2,
  'both trade-chat policies must safely support the optional legacy Firestore trade ID'
);
assert.doesNotMatch(
  chatMigrationSql,
  /t\.firestore_trade_id/,
  'trade-chat policies must not directly reference a possibly missing legacy column'
);

const adminOverviewMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260920000001_security_advisor_hardening.sql'
);
const adminOverviewMigrationSql = readFileSync(adminOverviewMigrationPath, 'utf8');
assert.match(
  adminOverviewMigrationSql,
  /to_regprocedure\('public\.process_user_deposit\(uuid, text, numeric, text, text, text, text\)'\) IS NOT NULL/,
  'financial RPC hardening must guard the exact process_user_deposit signature'
);
assert.doesNotMatch(
  adminOverviewMigrationSql,
  /IF EXISTS \(SELECT 1 FROM pg_proc WHERE proname = '(?:credit_confirmed_deposit|ingest_and_credit_deposit|process_user_deposit|mark_gas_funded|mark_swept|sync_didit_kyc_status|cancel_expired_p2p_trades)'\)/,
  'financial RPC hardening must not guard a different signature by function name alone'
);

const optionalAdsGuards = [
  /v_legacy_ad RECORD;/,
  /IF to_regclass\('public\.ads'\) IS NOT NULL THEN[\s\S]*?FROM public\.ads/,
  /IF NOT v_found_ad AND to_regclass\('public\.ads'\) IS NOT NULL THEN[\s\S]*?FROM public\.ads/,
];
for (const guard of optionalAdsGuards) {
  assert.match(
    canonicalP2pStateMachineSql,
    guard,
    'canonical trade RPC must not require the optional legacy public.ads relation'
  );
}
assert.doesNotMatch(
  canonicalP2pStateMachineSql,
  /v_legacy_ad public\.ads%ROWTYPE/,
  'legacy ads row type must not be resolved when the table is absent'
);

const canonicalP2pStateMachinePath = join(
  process.cwd(),
  'supabase/migrations/20260928070000_canonical_p2p_state_machine_and_rpcs.sql'
);
const canonicalP2pStateMachineSql = readFileSync(canonicalP2pStateMachinePath, 'utf8');
assert.match(
  canonicalP2pStateMachineSql,
  /v_p2p_ad RECORD;[\s\S]*?IF to_regclass\('public\.p2p_ads'\) IS NOT NULL THEN[\s\S]*?FROM public\.p2p_ads/,
  'canonical trade RPC must guard the optional p2p_ads relation and avoid a compile-time ROWTYPE dependency'
);
assert.doesNotMatch(
  canonicalP2pStateMachineSql,
  /v_p2p_ad public\.p2p_ads%ROWTYPE/,
  'canonical trade RPC must not require p2p_ads to exist at function-creation time'
);

const profileWalletIndexMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260925000014_fix_profile_and_wallet_index_provisioning.sql'
);
const profileWalletIndexMigrationSql = readFileSync(profileWalletIndexMigrationPath, 'utf8');
assert.match(
  profileWalletIndexMigrationSql,
  /ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS wallet_index INTEGER;[\s\S]*?SELECT COALESCE\(MAX\(wallet_index\), 0\)/,
  'wallet_index must exist before the migration synchronizes the sequence or creates its unique index'
);

const sweeperHardeningPath = join(
  process.cwd(),
  'supabase/migrations/20260925000000_sweeper_hardening.sql'
);
const sweeperHardeningSql = readFileSync(sweeperHardeningPath, 'utf8');
assert.equal(
  (sweeperHardeningSql.match(/to_regprocedure\('public\.allocate_hot_wallet_nonce\(integer\)'\) IS NOT NULL/g) ?? []).length,
  2,
  'optional hot-wallet nonce RPC revoke and grant must both guard the exact signature'
);

assert.match(
  adminOverviewMigrationSql,
  /CREATE VIEW public\.admin_financial_overview[\s\S]*?COALESCE\(main_balance, 0\)/,
  'admin overview must use the actual main_balance column exposed by user_wallets'
);
assert.match(
  adminOverviewMigrationSql,
  /to_regclass\('public\.sweep_logs'\)[\s\S]*?v_swept_expr :=/,
  'admin overview must guard the optional sweep_logs relation before referencing it'
);
assert.match(
  adminOverviewMigrationSql,
  /to_regclass\('public\.withdrawals'\)[\s\S]*?v_withdrawal_fee_expr :=/,
  'admin overview must guard optional withdrawal metrics before referencing their table'
);
assert.match(
  adminOverviewMigrationSql,
  /to_regclass\('public\.escrow_ledger'\)[\s\S]*?v_p2p_fee_expr :=/,
  'admin overview must guard optional escrow ledger metrics before referencing their table'
);
assert.doesNotMatch(
  adminOverviewMigrationSql,
  /COALESCE\(balance, 0\)/,
  'admin overview must not reference a nonexistent balance column on user_wallets'
);

assert.match(
  adminOverviewMigrationSql,
  /IF to_regclass\('public\.sweep_logs'\) IS NOT NULL THEN[\s\S]*?CREATE POLICY "sweep_logs_service_role_all"/,
  'sweep_logs RLS changes must be guarded when the optional legacy table is absent'
);
assert.match(
  adminOverviewMigrationSql,
  /IF to_regclass\('public\.sweep_queue'\) IS NOT NULL THEN[\s\S]*?CREATE POLICY "sweep_queue_service_role_all"/,
  'sweep_queue RLS changes must be guarded when the optional legacy table is absent'
);
assert.match(
  adminOverviewMigrationSql,
  /IF to_regclass\('public\.trade_attachments'\) IS NOT NULL THEN[\s\S]*?CREATE POLICY "trade_attachments_participant_select"/,
  'trade attachment policies must be guarded when the optional legacy table is absent'
);

const reservedBalanceMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260917000000_add_reserved_balance_and_sync.sql'
);
const reservedBalanceMigrationSql = readFileSync(reservedBalanceMigrationPath, 'utf8');
assert.doesNotMatch(
  reservedBalanceMigrationSql,
  /\\bDO\\s+\\$(?:\\s|;)|\\bEND\\s+\\$(?:\\s|;)/,
  'guarded wallet migration blocks must use valid dollar-quote delimiters'
);
assert.equal(
  (reservedBalanceMigrationSql.match(/DO \\$guard\\$/g) ?? []).length,
  (reservedBalanceMigrationSql.match(/END \\$guard\\$;/g) ?? []).length,
  'each guarded wallet migration block must have a matching closing delimiter'
);
assert.match(
  reservedBalanceMigrationSql,
  /IF EXISTS \([\s\S]*?c\.relname = 'balances'[\s\S]*?UPDATE public\.balances[\s\S]*?END IF;/,
  'legacy balances backfill must only run when public.balances is a real table'
);
assert.match(
  reservedBalanceMigrationSql,
  /c\.relname = 'balances'[\s\S]*?EXECUTE 'CREATE TRIGGER trg_sync_balances/,
  'legacy balances trigger must only be created when public.balances is a real table'
);

const legacyAdsMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20260906000000_name_privacy_and_trader_requirements.sql'
);
const legacyAdsMigrationSql = readFileSync(legacyAdsMigrationPath, 'utf8');
assert.match(
  legacyAdsMigrationSql,
  /IF to_regclass\('public\.p2p_ads'\) IS NOT NULL THEN[\s\S]*?ALTER TABLE public\.p2p_ads/,
  'legacy p2p_ads changes must be guarded because clean installs use canonical public.ads'
);
assert.match(
  legacyAdsMigrationSql,
  /COMMENT ON COLUMN public\.profiles\.name_visibility IS/,
  'profile name privacy documentation must remain independent of the optional legacy ads table'
);


const withdrawalCompatibilityPath = join(
  process.cwd(),
  'supabase/migrations/20260907000001_fix_withdrawal_escrow_separation.sql'
);
const withdrawalCompatibilitySql = readFileSync(withdrawalCompatibilityPath, 'utf8');
assert.match(
  withdrawalCompatibilitySql,
  /IF to_regclass\('public\.wallet_transactions'\) IS NOT NULL THEN[\s\S]*?ALTER TABLE public\.wallet_transactions/,
  'legacy wallet_transactions column changes must be guarded when the optional table is absent'
);

const securityHotfixPath = join(
  process.cwd(),
  'supabase/migrations/20260907000000_security_hotfix.sql'
);
const securityHotfixSql = readFileSync(securityHotfixPath, 'utf8');
const profileUpdatePolicyStart = securityHotfixSql.indexOf('CREATE POLICY "Users can update own profile"');
const profileUpdatePolicyEnd = securityHotfixSql.indexOf(';', profileUpdatePolicyStart);
assert.ok(profileUpdatePolicyStart >= 0 && profileUpdatePolicyEnd > profileUpdatePolicyStart,
  'security hotfix must define the profile update policy');
const profileUpdatePolicy = securityHotfixSql
  .slice(profileUpdatePolicyStart, profileUpdatePolicyEnd)
  .replace(/--[^\n]*/g, ''); // Ignore explanatory comments; inspect executable policy SQL only.
assert.doesNotMatch(profileUpdatePolicy, /\b(?:role|is_admin)\b/,
  'profile update policy must not reference role/is_admin columns absent from canonical profiles schema');
const checkAdminStart = securityHotfixSql.indexOf('CREATE OR REPLACE FUNCTION public.check_is_admin');
const checkAdminEnd = securityHotfixSql.indexOf('$;', checkAdminStart);
assert.ok(checkAdminStart >= 0 && checkAdminEnd > checkAdminStart,
  'security hotfix must define check_is_admin');
const checkAdminFunction = securityHotfixSql.slice(checkAdminStart, checkAdminEnd);
assert.doesNotMatch(checkAdminFunction, /FROM public\.profiles/,
  'admin authorization must not query nonexistent role/is_admin profile columns');

const ledgerHelperPath = join(
  process.cwd(),
  'supabase/migrations/20260928000000_platform_ledger_entries.sql'
);
const ledgerHelperSql = readFileSync(ledgerHelperPath, 'utf8');

assert.match(ledgerHelperSql, /'trade_fee_collected'/,
  'platform ledger schema must permit trade fee entries');
assert.match(ledgerHelperSql, /asset_code TEXT NOT NULL[\s\S]*?REFERENCES public\.assets\(code\)/,
  'platform fee asset must reference a registered asset code');
assert.match(ledgerHelperSql, /amount NUMERIC\(36,18\) NOT NULL[\s\S]*?CHECK \(amount > 0\)/,
  'platform ledger must reject zero or negative fee entries');
assert.match(ledgerHelperSql, /idempotency_key TEXT NOT NULL UNIQUE/,
  'platform ledger must enforce unique idempotency keys');
assert.match(ledgerHelperSql, /ON CONFLICT \(idempotency_key\) DO NOTHING/,
  'platform ledger helper must make repeated inserts idempotent');
assert.match(ledgerHelperSql, /v_existing\.entry_type IS DISTINCT FROM p_entry_type[\s\S]*?v_existing\.amount IS DISTINCT FROM p_amount/,
  'reused idempotency keys must reject conflicting financial fields');

const releaseStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.release_trade_escrow');
assert.notEqual(releaseStart, -1, 'migration must redefine release_trade_escrow');
const releaseEnd = sql.indexOf('$function$;', releaseStart + 3);
assert.notEqual(releaseEnd, -1, 'release function must terminate');
const releaseFn = sql.slice(releaseStart, releaseEnd + '$function$;'.length);

assert.match(releaseFn, /Caller ID mismatch: unauthorized impersonation\./,
  'caller identity mismatch guard must remain');
assert.match(releaseFn, /FROM public\.trades[\s\S]*?FOR UPDATE/,
  'trade row must be locked before settlement');
assert.match(releaseFn, /v_total_escrow := v_trade\.crypto_amount \+ COALESCE\(v_trade\.escrow_fee, 0\.0\)/,
  'total escrow must include fee');
assert.equal((releaseFn.match(/record_platform_ledger_entry\(/g) ?? []).length, 2,
  'fee helper must be used for settlement and completed-trade replay');
assert.equal((releaseFn.match(/'pf_p2pfee_' \|\| p_trade_id::TEXT/g) ?? []).length, 2,
  'settlement and replay must share deterministic fee idempotency key');
assert.match(releaseFn, /IF COALESCE\(v_trade\.escrow_fee, 0\) > 0 THEN[\s\S]*?p_entry_type := 'trade_fee_collected'/,
  'positive fee must create a platform fee ledger entry');
assert.match(releaseFn, /'completed'[\s\S]*?Already released \(idempotent success\)/,
  'completed-trade replay path must remain');
assert.match(releaseFn, /v_is_paid :=[\s\S]*?escrow_status::TEXT, ''\)\) IN \('paid', 'completed', 'released'\)/,
  'completed or released escrow state must not be rejected by the paid-state guard');

const replayStart = releaseFn.indexOf('-- 6. Terminal State & Replay Safety');
const replayEnd = releaseFn.indexOf('-- 7. Atomic Financial Settlement Mutations', replayStart);
assert.ok(replayStart >= 0 && replayEnd > replayStart,
  'replay and settlement sections must remain separately identifiable');
const replaySection = releaseFn.slice(replayStart, replayEnd);
assert.ok(replaySection.indexOf('record_platform_ledger_entry(') < replaySection.indexOf('RETURN jsonb_build_object('),
  'replay must ensure the platform fee entry before returning success');

const settlementFeeCall = releaseFn.indexOf('record_platform_ledger_entry(', replayEnd);
const tradeCompletionUpdate = releaseFn.indexOf('UPDATE public.trades', settlementFeeCall);
assert.ok(settlementFeeCall > replayEnd && tradeCompletionUpdate > settlementFeeCall,
  'settlement must record the platform fee before marking the trade completed');
assert.match(releaseFn, /v_crypto_symbol := UPPER\(COALESCE\([\s\S]*?to_jsonb\(v_trade\)->>'asset_code'[\s\S]*?\)\);/,
  'ledger asset code must be normalized using schema-compatible trade asset fields');
assert.doesNotMatch(releaseFn, /v_trade\.crypto\b/,
  'release function must not directly reference an optional legacy crypto column');
assert.match(releaseFn, /p_asset_code := v_crypto_symbol[\s\S]*?p_amount := v_trade\.escrow_fee[\s\S]*?p_direction := 'CREDIT'/,
  'fee entry must use the trade asset, recorded fee amount, and CREDIT direction');
assert.match(releaseFn, /'trade_id', p_trade_id[\s\S]*?'escrow_fee', v_trade\.escrow_fee[\s\S]*?'seller_id', v_trade\.seller_id/,
  'fee metadata must identify the trade, fee, and seller');
assert.match(releaseFn, /SECURITY DEFINER[\s\S]*?SET search_path TO 'public', 'pg_temp'/,
  'existing privileged function execution context and fixed search path must remain');
assert.match(releaseFn, /v_is_admin := public\.is_admin\(\)/,
  'live admin authorization helper must be preserved');
assert.doesNotMatch(releaseFn, /raw_user_meta_data|user_metadata/i,
  'escrow authorization must not trust user-editable metadata');
assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/,
  'migration must be transaction-wrapped');

console.log('PASS: escrow fee migration static safety checks');
console.log('NOTE: run integration tests against a fully initialized disposable Supabase project before deployment.');
