import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261026134500_atomic_admin_withdrawal_rejection.sql"), "utf8");
const route = readFileSync(join(process.cwd(), "src/app/api/admin/withdrawals/review/route.ts"), "utf8");
assert.ok(migration.includes("CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal"));
assert.ok(migration.includes("public.process_failed_withdrawal("));
assert.ok(migration.includes("INSERT INTO public.admin_audit_logs"));
assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(UUID, UUID, TEXT)"));
assert.ok(migration.includes("FROM PUBLIC, anon, authenticated"));
assert.ok(migration.includes("TO service_role, postgres"));
assert.ok(migration.includes("v_is_admin IS DISTINCT FROM TRUE"));
assert.ok(route.includes("rpc('admin_reject_withdrawal'"));
assert.ok(!route.includes("rpc('process_failed_withdrawal'"));
assert.ok(!route.includes("auditLogError"));
console.log("PASS: admin withdrawal rejection routes through a service-role-only wrapper that couples refund and audit in one transaction.");
console.log("NOTE: static test only; verify function signatures, table columns, and refund semantics on a schema-matched disposable database.");
