import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const migration = (file: string) => read(join('supabase', 'migrations', file));

const dml = () => migration('20261123155908_harden_marketplace_rls_and_dml.sql');
const buyRpc = () => migration('20261123155929_atomic_buy_ad_creation.sql');
const sellInterlock = () => migration('20261123155955_enforce_sell_ad_escrow_interlock.sql');
const buyHardening = () => migration('20261123160000_harden_atomic_buy_ad_creation_limits.sql');

test('marketplace tables allow reads but revoke direct client DML', () => {
  const sql = dml();
  assert.ok(sql.includes('ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('ALTER TABLE public.p2p_ads ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('CREATE POLICY ads_public_active_read'));
  assert.ok(sql.includes('CREATE POLICY ads_owner_read'));
  assert.ok(sql.includes('CREATE POLICY p2p_ads_public_active_read'));
  assert.ok(sql.includes('CREATE POLICY p2p_ads_owner_read'));
  assert.ok(sql.includes('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));
  assert.ok(sql.includes('FROM PUBLIC, anon, authenticated'));
  assert.ok(sql.includes('GRANT SELECT ON TABLE public.ads, public.p2p_ads'));
  assert.ok(sql.includes('REVOKE ALL PRIVILEGES ON TABLE public.p2p_orders'));
});

test('BUY RPC creates both marketplace representations in one database transaction', () => {
  const sql = buyRpc();
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.create_buy_ad_atomic'));
  assert.ok(sql.includes('SECURITY DEFINER'));
  assert.ok(sql.includes('SET search_path = \'\''));
  assert.ok(sql.includes('INSERT INTO public.ads'));
  assert.ok(sql.includes('INSERT INTO public.p2p_ads'));
  assert.ok(sql.includes('RETURNING * INTO v_ad'));
  assert.ok(sql.includes('RETURNING id INTO v_p2p_id'));
  assert.ok(sql.includes('A fresh reference price is unavailable'));
  assert.ok(sql.includes('MARKET_PRICE_UNAVAILABLE'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.create_buy_ad_atomic'));
  assert.ok(sql.includes('TO authenticated'));
  assert.ok(sql.includes('FROM PUBLIC, anon, service_role, supabase_auth_admin'));
});

test('BUY RPC uses a fresh server-side price and never trusts a client float price', () => {
  const sql = buyRpc();
  assert.ok(sql.includes('v_market_updated_at < v_now - INTERVAL \'10 minutes\''));
  assert.ok(sql.includes('v_price := ROUND(v_reference_price * (1 + (v_margin / 100)), 18)'));
  assert.ok(sql.includes('FIXED_PRICE_OUTSIDE_MARKET_RANGE'));
});

test('SELL is rejected in the authenticated API and the SECURITY DEFINER escrow RPC', () => {
  const sql = sellInterlock();
  const route = read(join('src', 'app', 'api', 'ads', 'create', 'route.ts'));
  assert.ok(sql.includes('SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'));
  assert.ok(sql.includes('IF v_ad_type IS DISTINCT FROM \'\'BUY\'\''));
  assert.ok(route.includes("resolvedDirection === 'SELL'"));
  assert.ok(route.includes('SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'));
  assert.ok(route.includes("supabase.rpc('create_buy_ad_atomic'"));
});

test('BUY ad hardening serializes the owner and enforces the ten-listing limit', () => {
  const sql = buyHardening();
  assert.ok(sql.includes('IF v_active_count >= 10'));
  assert.ok(sql.includes('USER_AD_LIMIT_REACHED'));
  assert.ok(sql.includes('FOR UPDATE'));
  assert.ok(sql.includes('COUNT(DISTINCT active_ads.ad_key)'));
  assert.ok(sql.includes('public.ads AS a'));
  assert.ok(sql.includes('public.p2p_ads AS p'));
  assert.ok(sql.includes('USER_AD_LIMIT_REACHED'));
  assert.ok(sql.includes('TO authenticated'));
});

test('the create-ad API maps only a validated BUY request to the atomic RPC', () => {
  const route = read(join('src', 'app', 'api', 'ads', 'create', 'route.ts'));
  assert.ok(route.includes("resolvedDirection !== 'BUY'"));
  assert.ok(route.includes("supabase.rpc('create_buy_ad_atomic'"));
  assert.ok(route.includes('p_public_ad_id: uniqueAdId'));
  assert.ok(route.includes('p_asset: rawAsset'));
  assert.ok(route.includes('p_fiat: rawFiat'));
  assert.ok(route.includes('p_min_amount: minValue'));
  assert.ok(route.includes('p_max_amount: maxValue'));
  assert.ok(route.includes('AD_CREATE_RECEIPT_INVALID'));
  assert.doesNotMatch(route, /\.from\(['"]ads['"]\)\s*\.insert\(/);
  assert.doesNotMatch(route, /\.from\(['"]p2p_ads['"]\)\s*\.insert\(/);
});

test('SELL remains unavailable until per-ad inventory reserve and idempotent restore exist', () => {
  const source = read(join('src', 'app', 'api', 'ads', 'create', 'route.ts'));
  const sql = sellInterlock();
  assert.ok(source.includes('temporarily unavailable until atomic per-ad inventory reservation'));
  assert.ok(sql.includes('seller wallet lock'));
  assert.ok(sql.includes('restored exactly once'));
});
