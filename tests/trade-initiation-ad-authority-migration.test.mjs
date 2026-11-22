import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261030100000_harden_trade_initiation_ad_authority.sql", import.meta.url),
  "utf8"
);
const latestLocalRpc = readFileSync(
  new URL("../supabase/migrations/20261017010000_enforce_trade_account_restrictions.sql", import.meta.url),
  "utf8"
);

test("trade RPC hardening migration fails closed when the audited signature or source markers drift", () => {
  assert.match(migration, /to_regprocedure\(/);
  assert.match(migration, /Audited function definition has drifted; no changes made/);
  assert.match(migration, /Required initiate_trade_with_escrow signature not found/);
  assert.match(migration, /EXECUTE v_definition/);
});

test("migration targets the latest local public.ads RPC and uses stored price/currency", () => {
  assert.match(latestLocalRpc, /v_ad public\.ads%ROWTYPE/);
  assert.match(latestLocalRpc, /v_ad_price := COALESCE\(v_ad\.price, v_ad\.unit_price, 1\.0\)/);
  assert.match(migration, /to_jsonb\(v_ad\)->>''fixed_rate''/);
  assert.match(migration, /v_price_old text := '        v_ad_price := COALESCE\(v_ad\.price, v_ad\.unit_price\);'/);
  assert.match(migration, /v_price_alt text := '        v_ad_price := COALESCE\(v_ad\.price, v_ad\.unit_price, 1\.0\);'/);
  assert.ok(migration.includes('BTRIM(v_ad.fiat_currency)'));
  assert.ok(migration.includes('BTRIM(v_ad.fiat_symbol)'));
  assert.doesNotMatch(migration, /v_p2p_ad|v_legacy_ad/);
});

test("database trade initiation validates stored fiat limits and payment methods", () => {
  assert.match(migration, /v_min_fiat IS NOT NULL AND v_fiat_amount < v_min_fiat/);
  assert.match(migration, /v_max_fiat IS NOT NULL AND v_fiat_amount > v_max_fiat/);
  assert.match(migration, /AD_FIAT_LIMIT/);
  assert.match(migration, /AD_PAYMENT_METHOD_INVALID/);
  assert.match(migration, /AD_CALLER_RESTRICTED/);
  assert.match(migration, /AD_OWNER_RESTRICTED/);
  assert.match(migration, /v_account_marker/);
  assert.match(migration, /jsonb_array_elements_text/);
});

test("migration does not directly change balances or insert financial ledger entries", () => {
  assert.doesNotMatch(migration, /UPDATE\s+public\.wallet_assets/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.ledger_entries/i);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});
