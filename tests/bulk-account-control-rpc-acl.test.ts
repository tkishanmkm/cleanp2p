import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261026131000_restrict_bulk_account_control_rpc_acl.sql"),
  "utf8",
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/platform-controls/bulk/route.ts"),
  "utf8",
);
const helper = readFileSync(
  join(process.cwd(), "src/lib/platform-bulk-actions.ts"),
  "utf8",
);

for (const [name, signature] of [
  ["execute_bulk_ban_atomic", "UUID, TEXT, TEXT"],
  ["execute_bulk_unban_atomic", "UUID, TEXT"],
  ["execute_bulk_restrict_atomic", "UUID, TEXT, TEXT"],
  ["execute_bulk_unrestrict_atomic", "UUID, TEXT"],
]) {
  assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature})`), name);
  assert.ok(migration.includes(`TO service_role, postgres`), name);
  assert.ok(helper.includes(`rpc("${name}"`), name + " server helper call");
}
assert.ok(route.includes("const auth = await verifyServerAdmin(req);"));
assert.ok(route.includes("if (!auth.authorized)"));
console.log("PASS: bulk account-control RPCs are limited to trusted server roles and the route verifies admin access.");
console.log("NOTE: static source contract only; check all call sites and rehearse grants on a schema-matched database before deployment.");
