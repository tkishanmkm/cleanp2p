import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260928070000_canonical_p2p_state_machine_and_rpcs.sql"),
  "utf8",
);
const initiateRpc = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.initiate_trade_with_escrow"),
  migration.indexOf("-- 2. Authoritative release_trade_escrow RPC"),
);

test("trade initiation checks both accounts inside the SECURITY DEFINER RPC", () => {
  assert.match(initiateRpc, /ACCOUNT_TRADE_ACCESS_BLOCKED/);
  assert.match(initiateRpc, /AD_OWNER_TRADE_ACCESS_BLOCKED/);
  assert.match(initiateRpc, /p\.id = v_effective_caller[\s\S]*?p\.is_banned[\s\S]*?p\.is_restricted[\s\S]*?p\.is_suspended/);
  assert.match(initiateRpc, /p\.id = v_ad_user_id[\s\S]*?p\.is_banned[\s\S]*?p\.is_restricted[\s\S]*?p\.is_suspended/);
  const callerGuard = initiateRpc.indexOf("ACCOUNT_TRADE_ACCESS_BLOCKED");
  const ownerGuard = initiateRpc.indexOf("AD_OWNER_TRADE_ACCESS_BLOCKED");
  const walletMutation = initiateRpc.indexOf("INSERT INTO public.wallet_assets");
  assert.ok(callerGuard > 0 && ownerGuard > 0 && walletMutation > ownerGuard,
    "account guards must run before wallet creation or escrow mutation");
});

test("trade price comes from the selected stored ad, not caller p_price", () => {
  assert.match(initiateRpc, /v_ad_price := COALESCE\(v_p2p_ad\.price, 0\)/);
  assert.match(initiateRpc, /NULLIF\(v_legacy_ad\.price, 0\)/);
  assert.doesNotMatch(initiateRpc, /NULLIF\(p_price,\s*0\)/);
  assert.match(initiateRpc, /DETAIL = 'INVALID_AD_PRICE'/);
  assert.doesNotMatch(initiateRpc, /v_ad_price\s*:=\s*1\.0/,
    "invalid ad prices must fail closed rather than silently become 1.0");
});

console.log("NOTE: static migration contract tests only; execute against a schema-matched disposable PostgreSQL database before deployment.");
