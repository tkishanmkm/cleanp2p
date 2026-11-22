import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const brandingRoute = readFileSync(path.join(root, 'src/app/api/admin/branding/route.ts'), 'utf8');
const brandingContext = readFileSync(path.join(root, 'src/context/branding-context.tsx'), 'utf8');
const appearancePage = readFileSync(path.join(root, 'src/app/adminnarayan/appearance/page.tsx'), 'utf8');
const metricsRoute = readFileSync(path.join(root, 'src/app/api/admin/metrics/route.ts'), 'utf8');
const reconciliation = readFileSync(path.join(root, 'src/lib/security/reconciliation.ts'), 'utf8');
const dataManagement = readFileSync(path.join(root, 'src/app/adminnarayan/settings/data/page.tsx'), 'utf8');
const addressSetsMigration = readFileSync(path.join(root, 'supabase/migrations/20261022041632_add_crypto_deposit_address_sets.sql'), 'utf8');
const platformWalletMigration = readFileSync(path.join(root, 'supabase/migrations/20261022050000_restore_platform_wallets_contract.sql'), 'utf8');
const dbTypes = readFileSync(path.join(root, 'src/lib/supabase/db.ts'), 'utf8');

assert.ok(brandingRoute.includes(".from('app_settings')"), 'branding API must use the deployed app_settings table');
assert.ok(brandingRoute.includes("value: JSON.stringify(branding)"), 'branding JSON must be serialized for app_settings.value text column');
assert.ok(brandingRoute.includes('verifyServerAdmin(req)'), 'branding writes must require server-side admin authorization');
assert.ok(!brandingContext.includes(".from('app_config')"), 'client branding context must not query missing app_config');
assert.ok(brandingContext.includes("fetch('/api/admin/branding'"), 'branding context must load via server API');
assert.ok(appearancePage.includes("fetch('/api/admin/branding'"), 'appearance editor must persist via server API');
assert.ok(!appearancePage.includes(".from('app_config')"), 'appearance editor must not write missing app_config');
assert.ok(metricsRoute.includes(".from('system_alerts')"), 'admin metrics must query the deployed system_alerts table');
assert.ok(reconciliation.includes(".from('system_alerts').insert({"), 'reconciliation alerts must write to the deployed system_alerts table');
assert.ok(reconciliation.includes('metadata: {'), 'alert details must map to system_alerts.metadata');
assert.ok(dataManagement.includes("'app_settings'"), 'backup list must use deployed app_settings');
assert.ok(dataManagement.includes("'deposit_addresses'"), 'backup list must use deployed deposit_addresses');
assert.ok(addressSetsMigration.includes('CREATE TABLE IF NOT EXISTS public.crypto_deposit_addresses'), 'rotating address-set table migration must exist');
assert.ok(addressSetsMigration.includes('ENABLE ROW LEVEL SECURITY'), 'rotating address-set table must enable RLS');
assert.ok(addressSetsMigration.includes('TO authenticated'), 'rotating address-set access must be scoped to authenticated users');
assert.ok(addressSetsMigration.includes('public.is_admin()'), 'rotating address-set writes must be admin-only');
assert.ok(addressSetsMigration.includes('jsonb_typeof(addresses) = \'object\''), 'address sets must be JSON objects');
assert.ok(platformWalletMigration.includes('CREATE TABLE IF NOT EXISTS public.platform_wallets'), 'platform wallet registry migration must exist');
assert.ok(platformWalletMigration.includes('public.is_admin()'), 'platform wallet reads must be admin-only');
assert.ok(platformWalletMigration.includes('REVOKE ALL ON TABLE public.platform_wallets FROM PUBLIC, anon, authenticated'), 'platform wallet registry must default-deny client writes');
assert.ok(dbTypes.includes("role: 'hot_wallet' | 'cold_storage' | 'fee_collector' | 'escrow_pool'"), 'platform wallet type must match SQL role values');
assert.ok(!/wallet_type: 'hot' \| 'warm' \| 'cold'/.test(dbTypes), 'platform wallet type must not expect absent wallet_type column');

console.log('PASS: branding, alerts, backups, rotating address sets, and platform wallet contracts are guarded');
