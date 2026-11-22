import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261017170800_deactivate_ads_after_offline_attempts.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const triggerStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.guard_trade_seller_online()");
assert.notEqual(triggerStart, -1, "offline-owner trigger function must exist");
const triggerSql = sql.slice(triggerStart);

assert.match(triggerSql, /FROM public\.ads a/i, "canonical ads must be checked first");
assert.match(triggerSql, /IF NOT FOUND OR v_ad_owner_id IS NULL THEN[\s\S]*?FROM public\.p2p_ads p/i,
  "legacy p2p_ads must be a fallback when the canonical row is missing");
assert.match(triggerSql, /p\.id::text = COALESCE\(NEW\.ad_id::text, ''\)/i,
  "legacy UUID ad_id must resolve to the legacy ad owner");
assert.match(triggerSql, /p\.public_ad_id = NEW\.public_ad_id::text/i,
  "public ad identifiers must resolve to the legacy ad owner");
assert.match(triggerSql, /DETAIL = 'AD_OWNER_UNAVAILABLE'/i,
  "unknown ad owner must fail closed");
assert.match(triggerSql, /v_last_seen < now\(\) - interval '120 seconds'/i,
  "stale seller presence must be rejected");

const attemptSql = sql.slice(0, triggerStart);
assert.match(attemptSql, /UPDATE public\.ads[\s\S]*?OR public_id = v_ad_key OR public_id = v_public_ad_id/i,
  "canonical ad counters must match the canonical public_id as well as public_ad_id");
assert.match(attemptSql, /SET active = false, is_active = false, status = 'paused'[\s\S]*?OR public_id = v_ad_key OR public_id = v_public_ad_id/i,
  "automatic pause must reach canonical ads identified by public_id");

console.log("PASS: offline-ad owner resolution and canonical ID migration contract checks");
console.log("NOTE: Static checks do not replace execution against an isolated PostgreSQL schema.");
