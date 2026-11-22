import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019120000_harden_trade_escrow_rpc_search_path.sql",
);
const sql = readFileSync(migrationPath, "utf8");

assert.match(
  sql,
  /ALTER FUNCTION public\.initiate_trade_with_escrow\(\s*text, numeric, numeric, text, numeric, text, text, text, uuid\s*\) SET search_path = ''/i,
);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
assert.doesNotMatch(sql, /DROP FUNCTION|CREATE OR REPLACE FUNCTION|REVOKE ALL|GRANT EXECUTE/i);

console.log("PASS: escrow RPC search_path migration contract checks");
console.log("NOTE: Static checks do not replace PostgreSQL migration and runtime authorization tests.");
