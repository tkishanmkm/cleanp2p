import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const path = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261018100000_restrict_didit_kyc_rpc_execution.sql",
);
const sql = readFileSync(path, "utf8");

assert.match(sql, /REVOKE ALL ON FUNCTION public\.initiate_didit_kyc\(uuid, text\)\s+FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.initiate_didit_kyc\(uuid, text\)\s+TO service_role, postgres/i);
assert.match(sql, /ALTER FUNCTION public\.initiate_didit_kyc\(uuid, text\)\s+SET search_path = ''/i);
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.initiate_didit_kyc\(uuid, text\)\s+TO [^;]*(PUBLIC|anon|authenticated)/i);

console.log("PASS: Didit KYC RPC is restricted to trusted backend roles in the migration contract");
console.log("NOTE: Static checks do not verify live grants or runtime callers.");
