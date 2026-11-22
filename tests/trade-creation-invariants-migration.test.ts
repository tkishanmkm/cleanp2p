import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20261118135339_p2p_trade_creation_invariants.sql', 'utf8');
const tradeRoute = readFileSync('src/app/api/trades/create/route.ts', 'utf8');
const orderRoute = readFileSync('src/app/api/p2p/orders/create/route.ts', 'utf8');

test('trade insert trigger requires distinct participants and current active profiles', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enforce_trade_creation_invariants/);
  assert.match(migration, /BEFORE INSERT ON public\.trades/);
  assert.match(migration, /auth\.uid\(\) NOT IN \(v_buyer_id, v_seller_id\)/);
  assert.match(migration, /FOR UPDATE/);
  for (const field of ['is_banned', 'is_restricted', 'is_suspended', 'is_on_hold', 'is_emergency_frozen']) {
    assert.ok(migration.includes(`v_profile ->> '${field}'`), `missing ${field} check`);
  }
  assert.match(migration, /TRADE_PARTICIPANT_ACCOUNT_RESTRICTED/);
});

test('database enforces advertisement fiat minimum and maximum limits', () => {
  assert.match(migration, /v_ad ->> 'min_amount'/);
  assert.match(migration, /v_ad ->> 'min_limit'/);
  assert.match(migration, /v_ad ->> 'max_amount'/);
  assert.match(migration, /v_ad ->> 'max_limit'/);
  assert.match(migration, /NEW\.fiat_amount < v_min_fiat/);
  assert.match(migration, /NEW\.fiat_amount > v_max_fiat/);
  assert.match(migration, /TRADE_AMOUNT_OUTSIDE_AD_LIMITS/);
  assert.match(migration, /NEW\.unit_price IS DISTINCT FROM v_ad_price/);
  assert.match(migration, /NEW\.fiat_amount IS DISTINCT FROM pg_catalog\.round/);
  assert.match(migration, /TRADE_AD_PARAMETERS_MISMATCH/);
  assert.match(migration, /TRADE_ADVERTISEMENT_INACTIVE/);
  assert.match(migration, /TRADE_AD_OWNER_MISMATCH/);
});

test('database enforces the advertisement payment-method allowlist', () => {
  assert.match(migration, /v_ad -> 'payment_methods'/);
  assert.match(migration, /jsonb_array_elements_text\(v_payment_methods\)/);
  assert.match(migration, /TRADE_PAYMENT_METHOD_NOT_ALLOWED/);
  assert.match(migration, /TRADE_PAYMENT_METHOD_CONFIG_INVALID/);
});

test('ad-specific verified-user and full-name requirements are enforced against the initiating user', () => {
  assert.match(migration, /v_ad ->> 'require_full_name_verified'/);
  assert.match(migration, /v_ad ->> 'require_verified_users'/);
  assert.match(migration, /v_initiator_id := CASE WHEN v_ad_type = 'BUY' THEN v_seller_id ELSE v_buyer_id END/);
  assert.match(migration, /public\.get_user_kyc_tier\(v_initiator_id\) < 2/);
  assert.match(migration, /AD_REQUIRES_VERIFIED_FULL_NAME/);
});

test('direct client inserts cannot bypass the atomic escrow RPC', () => {
  assert.match(migration, /CREATE POLICY "trades_insert_policy" ON public\.trades\s+FOR INSERT WITH CHECK \(FALSE\)/);
  assert.match(migration, /REVOKE INSERT ON TABLE public\.trades FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /ALTER FUNCTION public\.initiate_trade_with_escrow\([\s\S]*?\) OWNER TO postgres/);
  assert.match(tradeRoute, /rpc\('initiate_trade_with_escrow'/);
  assert.match(orderRoute, /rpc\('initiate_trade_with_escrow'/);
});

console.log('PASS: P2P trade creation now has database-level participant, account, ad-limit, payment-method and KYC guards.');