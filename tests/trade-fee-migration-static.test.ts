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

const canonicalP2pStateMachinePath = join(
  process.cwd(),
  'supabase/migrations/20260928070000_canonical_p2p_state_machine_and_rpcs.sql'
);
const canonicalP2pStateMachineSql = readFileSync(canonicalP2pStateMachinePath, 'utf8');
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

const depositSnapshotMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20261001010000_part6k14_controlled_blocker_remediation.sql'
);
const depositSnapshotMigrationSql = readFileSync(depositSnapshotMigrationPath, 'utf8');
assert.match(
  depositSnapshotMigrationSql,
  /to_jsonb\(uda\)->>'chain'[\s\S]*?to_jsonb\(uda\)->>'asset_code'[\s\S]*?to_jsonb\(uda\)->>'network_code'[\s\S]*?FROM public\.user_deposit_addresses AS uda/,
  'deposit-address snapshot must read optional legacy columns through JSON rather than direct column references'
);
assert.doesNotMatch(
  depositSnapshotMigrationSql,
  /SELECT id, user_id, network::text, address, asset_symbol, created_at, updated_at, chain, asset_code, network_code\s+FROM public\.user_deposit_addresses/,
  'deposit-address snapshot must not assume optional chain or asset-code columns exist'
);

assert.match(
  depositSnapshotMigrationSql,
  /to_jsonb\(w\)->>'chain'[\s\S]*?to_jsonb\(w\)->>'address'[\s\S]*?FROM public\.wallets AS w/,
  'wallet snapshot must read optional legacy fields through JSON rather than direct column references'
);
assert.doesNotMatch(
  depositSnapshotMigrationSql,
  /SELECT id, user_id, chain, address, funding_status, created_at, updated_at\s+FROM public\.wallets/,
  'wallet snapshot must not assume the legacy chain column exists'
);

assert.match(
  depositSnapshotMigrationSql,
  /to_jsonb\(t\)->>'crypto_amount'[\s\S]*?to_jsonb\(t\)->>'amount'[\s\S]*?to_jsonb\(t\)->>'escrow_fee'[\s\S]*?to_jsonb\(t\)->>'platform_fee'[\s\S]*?FROM public\.trades AS t/,
  'trade baseline snapshot must tolerate optional legacy amount and fee columns'
);
assert.doesNotMatch(
  depositSnapshotMigrationSql,
  /COALESCE\(crypto_amount, amount\), COALESCE\(escrow_fee, platform_fee, 0\)/,
  'trade baseline snapshot must not directly reference optional legacy columns'
);

assert.doesNotMatch(
  depositSnapshotMigrationSql,
  /8925fed8-c8bf-44a3-97fa-bd806aade05a/,
  'schema migration must not hardcode a production user UUID'
);
assert.doesNotMatch(
  depositSnapshotMigrationSql,
  /STEP 4: PRECHECK & VERIFICATION OF USER ROUTE INTEGRITY|STEP 5: FINAL TRANSACTION VERIFICATION ASSERTIONS/,
  'user-specific operational data checks must not block clean migration replay'
);

const tradeFlowHardeningPath = join(
  process.cwd(),
  'supabase/migrations/20260928080000_p2p_trade_flow_and_rls_hardening.sql'
);
const tradeFlowHardeningSql = readFileSync(tradeFlowHardeningPath, 'utf8');
assert.doesNotMatch(
  tradeFlowHardeningSql,
  /DROP POLICYIF/,
  'trade flow migration must not contain malformed DROP POLICY syntax'
);
assert.match(
  tradeFlowHardeningSql,
  /DROP POLICY IF EXISTS "trade_messages_insert_policy" ON public\.trade_messages;/,
  'trade message insert policy must be dropped with valid SQL syntax'
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


const hotWalletNonceMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20261001040000_final_production_consistency_hardening.sql'
);
const hotWalletNonceMigrationSql = readFileSync(hotWalletNonceMigrationPath, 'utf8');
assert.match(
  hotWalletNonceMigrationSql,
  /ALTER TABLE public\.hot_wallet_nonces\s+ADD COLUMN IF NOT EXISTS chain_id INTEGER;/,
  'hot-wallet nonce migration must upgrade the legacy network_code-keyed table in place'
);
assert.match(
  hotWalletNonceMigrationSql,
  /UPDATE public\.hot_wallet_nonces[\s\S]*?WHEN 'ERC20' THEN 1[\s\S]*?WHEN 'BEP20' THEN 56[\s\S]*?WHERE chain_id IS NULL;/,
  'existing ERC20 and BEP20 nonce rows must be mapped to their EVM chain IDs'
);
assert.match(
  hotWalletNonceMigrationSql,
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_wallet_nonces_chain_id[\s\S]*?WHERE chain_id IS NOT NULL;/,
  'chain ID mapping must be unique without rejecting legacy non-EVM nonce rows'
);
assert.match(
  hotWalletNonceMigrationSql,
  /INSERT INTO public\.hot_wallet_nonces[\s\S]*?network_code, current_nonce, hot_wallet_address[\s\S]*?ON CONFLICT DO NOTHING[\s\S]*?SELECT current_nonce INTO v_current_nonce[\s\S]*?WHERE chain_id = v_chain_id[\s\S]*?FOR UPDATE;/,
  'nonce allocation must preserve legacy required columns and lock the canonical chain row'
);


const disputeAlignmentMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20261003000000_p2p_dispute_schema_and_resolution_alignment.sql'
);
const disputeAlignmentSql = readFileSync(disputeAlignmentMigrationPath, 'utf8');
assert.match(
  disputeAlignmentSql,
  /CREATE OR REPLACE FUNCTION public\.resolve_trade_dispute\(\s*p_dispute_id UUID,\s*p_resolution TEXT DEFAULT NULL,\s*p_winner_id UUID DEFAULT NULL,\s*p_caller_id UUID DEFAULT NULL\s*\)/,
  'resolve_trade_dispute replacement must preserve existing trailing argument defaults'
);


const platformControlsMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20261004000000_secure_global_platform_controls.sql'
);
const platformControlsSql = readFileSync(platformControlsMigrationPath, 'utf8');
assert.match(
  platformControlsSql,
  /ALTER TABLE public\.profiles\s+ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',\s+ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,\s+ADD COLUMN IF NOT EXISTS is_admin_account BOOLEAN DEFAULT FALSE;/,
  'platform control policies must not reference admin profile columns before they exist on a clean replay'
);


assert.match(
  platformControlsSql,
  /IF to_regclass\('public\.user_blocks'\) IS NOT NULL THEN[\s\S]*?Skipping user_blocks hardening/,
  'platform controls migration must tolerate schemas where the optional user_blocks table is absent'
);


const profileHardeningMigrationPath = join(
  process.cwd(),
  'supabase/migrations/20261004080000_admin_security_foundation_hardening.sql'
);
const profileHardeningSql = readFileSync(profileHardeningMigrationPath, 'utf8');
assert.match(
  profileHardeningSql,
  /information_schema\.columns[\s\S]*column_name = ANY \(ARRAY\[[\s\S]*'trade_volume'[\s\S]*\]\)[\s\S]*EXECUTE format\([\s\S]*GRANT SELECT \(%s\) ON public\.profiles TO anon, authenticated/,
  'profile column grants must filter the explicit allowlist against columns present in legacy schemas'
);
assert.doesNotMatch(
  profileHardeningSql,
  /GRANT SELECT\s*\([\s\S]*?\)\s*ON public\.profiles TO anon, authenticated;/,
  'profile hardening must not statically grant columns that may be absent'
);


const adCreationRoutePath = join(process.cwd(), 'src/app/api/ads/create/route.ts');
const adCreationRoute = readFileSync(adCreationRoutePath, 'utf8');
assert.match(adCreationRoute, /const MAX_MARKET_PRICE_AGE_MS = 15 \* 60 \* 1000;/,
  'ad creation must centralize the maximum market-price age');
assert.equal((adCreationRoute.match(/marketAgeMs > MAX_MARKET_PRICE_AGE_MS/g) ?? []).length, 2,
  'fixed and floating ad pricing must both reject stale market data');
assert.equal((adCreationRoute.match(/\.select\('price_in_fiat, updated_at'\)/g) ?? []).length, 2,
  'both pricing modes must load the market timestamp before accepting a reference price');

const marketPriceWorkerPath = join(process.cwd(), 'src/jobs/priceUpdaterWorker.ts');
const marketPriceWorker = readFileSync(marketPriceWorkerPath, 'utf8');
assert.match(marketPriceWorker, /process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*''/,
  'market-price worker must require the service-role credential');
assert.match(marketPriceWorker, /if \(!supabaseUrl \|\| !supabaseKey\)[\s\S]*?SUPABASE_SERVICE_CONFIGURATION_MISSING/,
  'market-price worker must fail closed when Supabase server configuration is missing');
const safeFetchJsonStart = marketPriceWorker.indexOf('async function safeFetchJson');
const safeFetchJsonEnd = marketPriceWorker.indexOf('\n}', safeFetchJsonStart);
const safeFetchJsonSource = marketPriceWorker.slice(safeFetchJsonStart, safeFetchJsonEnd);
assert.ok(safeFetchJsonSource.indexOf('return await res.json()') < safeFetchJsonSource.indexOf('clearTimeout(timeoutId)'),
  'provider timeout must remain active while the response body is parsed');
assert.match(safeFetchJsonSource, /finally\s*\{\s*clearTimeout\(timeoutId\);/s,
  'provider timeout must always be cleared after request/body completion');

const marketWorkerFunctionIndex = marketPriceWorker.indexOf('export async function runMarketPriceUpdate');
const marketWorkerConfigGuardIndex = marketPriceWorker.indexOf('if (!supabaseUrl || !supabaseKey)');
const marketWorkerClientIndex = marketPriceWorker.indexOf('createClient(supabaseUrl, supabaseKey');
assert.ok(marketWorkerFunctionIndex >= 0 && marketWorkerConfigGuardIndex > marketWorkerFunctionIndex,
  'market-price worker configuration guard must execute inside the exported worker');
assert.ok(marketWorkerClientIndex > marketWorkerConfigGuardIndex,
  'market-price Supabase client must only be constructed after configuration validation');

assert.doesNotMatch(marketPriceWorker, /NEXT_PUBLIC_SUPABASE_ANON_KEY|placeholder\.supabase\.co|placeholder-key/,
  'market-price worker must not fall back to public anon credentials or placeholder configuration');

const marketPriceCronRoutePath = join(process.cwd(), 'src/app/api/cron/update-prices/route.ts');
const marketPriceCronRoute = readFileSync(marketPriceCronRoutePath, 'utf8');
assert.match(marketPriceCronRoute, /result\.error === 'SUPABASE_SERVICE_CONFIGURATION_MISSING'[\s\S]*?\? 503 : 500/,
  'cron endpoint must report missing server credentials as service unavailable, not a generic internal error');

assert.ok(
  marketPriceCronRoute.indexOf('if (!auth.authorized)') < marketPriceCronRoute.indexOf('await runMarketPriceUpdate()'),
  'price cron route must reject unauthorized requests before running the market-price worker'
);
assert.match(marketPriceCronRoute, /status: 401/,
  'price cron route must return HTTP 401 for failed worker authentication');

assert.match(marketPriceCronRoute, /error: 'Market price update failed'/,
  'price cron route must return a generic error instead of exposing internal exception details');
assert.doesNotMatch(marketPriceCronRoute, /error: err\.message/,
  'price cron route must not send raw exception messages to clients');

console.log('PASS: escrow fee migration static safety checks');
console.log('NOTE: run integration tests against a fully initialized disposable Supabase project before deployment.');
