import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const engine = read('src/lib/hd-derivation-engine.ts');
const canonicalAddressRoute = read('src/app/api/wallets/deposit-address/route.ts');
const addressAliasRoute = read('src/app/api/wallets/provision-address/route.ts');
const oldInternalProvisionRoute = read('src/app/api/internal/provision/route.ts');
const oldRandomWalletRoute = read('src/app/api/wallet/create-address/route.ts');
const userAddressListRoute = read('src/app/api/wallet/deposit-addresses/route.ts');
const userAddressRoute = read('src/app/api/wallet/deposit-address/route.ts');
const serviceProvisionRoute = read('src/app/api/auth/provision-wallets/route.ts');
const provisioningAuth = read('src/lib/wallet/provisioning-auth.ts');
const xpubDerivation = read('src/lib/crypto/hd-derivation.ts');
const adminIndexRoute = read('src/app/api/admin/wallet-index/assign/route.ts');
const signupTrigger = read('supabase/migrations/20261011161643_secure_wallet_provisioning_trigger.sql');
const allocatorMigration = read('supabase/migrations/20261119174139_step_06_unify_wallet_index_allocator.sql');
const signupSearchPathMigration = read('supabase/migrations/20261120230000_step_13_harden_signup_wallet_index_trigger_search_path.sql');

test('canonical HD provisioning requires a UUID and a previously allocated positive immutable index', () => {
  assert.match(engine, /A verified UUID user identity is required for wallet provisioning/);
  assert.match(engine, /walletIndex <= 0/);
  assert.match(engine, /walletIndex > 0x7fffffff/);
  assert.match(engine, /deriveAllAddressesAsync\(walletIndex\)/);
  assert.match(engine, /rpc\('provision_user_wallets_atomic'/);
  assert.match(engine, /p_user_id: normalizedUserId/);
  assert.match(engine, /p_wallet_index: walletIndex/);
  assert.match(engine, /committed\.success !== true/);
  assert.match(engine, /committed\.user_id/);
  assert.match(engine, /committed\.wallet_index/);
  assert.match(engine, /committedAddresses\?\.evm/);
  assert.match(engine, /committedAddresses\?\.tron/);
  assert.match(engine, /committedAddresses\?\.btc/);
  assert.match(engine, /committedAddresses\?\.ltc/);
  assert.match(engine, /user_id: normalizedUserId/);
});

test('public address routes resolve from the canonical atomic HD registry, not stale legacy rows', () => {
  assert.match(canonicalAddressRoute, /getOrDeriveUserDepositAddresses\(user\.id\)/);
  assert.doesNotMatch(canonicalAddressRoute, /\.from\(['"]deposit_addresses['"]\)/);
  assert.doesNotMatch(canonicalAddressRoute, /existingRecords/);
  assert.match(canonicalAddressRoute, /Unsupported asset\/network combination/);
  assert.match(canonicalAddressRoute, /derivationIndex: provisionResult\.walletIndex/);
  assert.match(addressAliasRoute, /export \{ GET, POST \} from '\.\.\/deposit-address\/route'/);
  assert.match(userAddressListRoute, /getOrDeriveUserDepositAddresses\(userId\)/);
  assert.match(userAddressRoute, /getOrDeriveUserDepositAddresses\(userId\)/);
  assert.match(userAddressListRoute, /temporarily unavailable/);
  assert.doesNotMatch(userAddressListRoute, /error: errorMsg/);
});

test('legacy shared-key queue provisioning and arbitrary random wallet creation remain retired', () => {
  assert.match(oldInternalProvisionRoute, /LEGACY_WALLET_PROVISIONING_DISABLED/);
  assert.match(oldInternalProvisionRoute, /status: 410/);
  assert.doesNotMatch(oldInternalProvisionRoute, /CHAIN_INGEST_SECRET|PROVISION_SERVICE_KEY|\\.from\\(['\"]wallet_provisioning['\"]\\)/);
  assert.match(oldRandomWalletRoute, /LEGACY_WALLET_CREATION_DISABLED/);
  assert.match(oldRandomWalletRoute, /status: 410/);
});

test('database-trigger provisioning uses a dedicated high-entropy bearer separate from user auth', () => {
  assert.match(signupTrigger, /wallet_provisioning_bearer/);
  assert.match(serviceProvisionRoute, /process\\.env\\.WALLET_PROVISIONING_BEARER/);
  assert.match(signupTrigger, /\/api\/auth\/provision-wallets/);
  assert.match(provisioningAuth, /MIN_SERVICE_SECRET_BYTES = 32/);
  assert.match(provisioningAuth, /timingSafeEqual/);
  assert.match(provisioningAuth, /provided\.byteLength !== expected\.byteLength/);
  assert.match(serviceProvisionRoute, /isWalletProvisioningServiceBearer/);
  assert.match(serviceProvisionRoute, /authenticatedUserId/);
  assert.match(serviceProvisionRoute, /bodyUserId !== authenticatedUserId/);
  assert.match(serviceProvisionRoute, /profile\.wallet_index <= 0/);
  assert.match(serviceProvisionRoute, /getOrDeriveUserDepositAddresses\(targetUserId\)/);
  assert.doesNotMatch(serviceProvisionRoute, /console\.log\(.*authorization/i);
});

test('public xpub derivation accepts only four account-level public keys and valid child indexes', () => {
  assert.match(xpubDerivation, /EXPECTED_ACCOUNT_DEPTH = 3/);
  assert.match(xpubDerivation, /EXPECTED_ACCOUNT_CHILD_INDEX = 0x80000000/);
  assert.match(xpubDerivation, /private extended keys are forbidden/);
  assert.match(xpubDerivation, /key\.depth !== EXPECTED_ACCOUNT_DEPTH/);
  assert.match(xpubDerivation, /validateWalletDerivationIndex\(index\)/);
  assert.match(xpubDerivation, /All four account-level public extended keys are required/);
  assert.match(engine, /PUBLIC_XPUB_DERIVATION_ENABLED === 'true'/);
  assert.match(engine, /EVM_XPUB/);
  assert.match(engine, /BTC_XPUB/);
  assert.match(engine, /TRON_XPUB/);
  assert.match(engine, /LTC_XPUB/);
});

test('wallet index allocation uses one monotonic sequence and never falls back to index zero', () => {
  assert.match(allocatorMigration, /public\.user_wallet_index_seq/);
  assert.match(allocatorMigration, /nextval\('public\.user_wallet_index_seq'/);
  assert.match(allocatorMigration, /wallet_index_seq/);
  assert.match(allocatorMigration, /wallet_index_seq.*must increment|legacy allocator contract/);
  assert.match(allocatorMigration, /profile wallet_index must be a positive allocated integer/i);
  assert.match(allocatorMigration, /idx_profiles_wallet_index_unique|unique.*wallet_index/i);
  assert.match(adminIndexRoute, /assign_missing_profile_wallet_indexes/);
  assert.match(adminIndexRoute, /WALLET_INDEX_ALLOCATOR_NOT_INSTALLED/);
  assert.match(adminIndexRoute, /No client-side fallback is permitted/);
  assert.doesNotMatch(adminIndexRoute, /nextval|sequence\.next/);
});

test('signup SECURITY DEFINER wallet allocator is pinned to an empty search path without changing its body or ACL', () => {
  assert.match(signupSearchPathMigration, /public\.handle_new_user\(\)/);
  assert.match(signupSearchPathMigration, /search_path=public, auth, pg_temp/);
  assert.match(signupSearchPathMigration, /public\.user_wallet_index_seq/);
  assert.match(signupSearchPathMigration, /INSERT INTO public\.profiles/);
  assert.match(signupSearchPathMigration, /public\.generate_system_username\(\)/);
  assert.match(signupSearchPathMigration, /ALTER FUNCTION public\.handle_new_user\(\) SET search_path = ''/);
  assert.match(signupSearchPathMigration, /v_acl_after IS DISTINCT FROM v_acl_before/);
  assert.match(signupSearchPathMigration, /v_source_after IS DISTINCT FROM v_source_before/);
  assert.match(signupSearchPathMigration, /auth\.users/);
  assert.match(signupSearchPathMigration, /tgenabled='O'/);
});
