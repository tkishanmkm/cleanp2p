import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019150000_harden_security_definer_search_paths.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const normalized = sql.replace(/\s+/g, " ").toLowerCase();

for (const signature of [
  "public.cancel_p2p_trade(uuid, uuid, text)",
  "public.get_emergency_mode()",
  "public.get_user_2fa_status(uuid)",
  "public.initiate_didit_kyc(uuid, text)",
  "public.mark_p2p_trade_paid(uuid, uuid, text)",
  "public.raise_trade_dispute(uuid, uuid, text)",
]) {
  assert.ok(
    normalized.includes(`alter function ${signature} set search_path = ''`),
    `Missing empty search_path hardening for ${signature}`,
  );
}
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION|DROP FUNCTION|REVOKE ALL|GRANT EXECUTE/i);

const escrowSearchPathMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261019120000_harden_trade_escrow_rpc_search_path.sql"),
  "utf8",
);
assert.match(
  escrowSearchPathMigration,
  /ALTER FUNCTION public\.initiate_trade_with_escrow\([\s\S]*?\) SET search_path = '';/i,
);

// A later dynamic replacement of the escrow RPC must not reset the hardened path.
const tradeLimitsMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261031160000_harden_live_trade_ad_limits_and_payment_methods.sql"),
  "utf8",
);
assert.match(
  tradeLimitsMigration,
  /EXECUTE v_definition;[\s\S]*?ALTER FUNCTION public\.initiate_trade_with_escrow\([\s\S]*?\) SET search_path = '';/i,
  "later dynamic function replacement must re-apply the empty search_path",
);
console.log("PASS: reviewed SECURITY DEFINER search_path migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution and runtime authorization tests.");
