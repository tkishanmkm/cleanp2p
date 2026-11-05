import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261031170000_restrict_admin_financial_overview_view.sql"),
  "utf8",
);

assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.admin_financial_overview\s+FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /GRANT SELECT ON TABLE public\.admin_financial_overview TO service_role/i);
assert.match(migration, /BEGIN;[\s\S]*COMMIT;/i);
assert.doesNotMatch(migration, /DROP VIEW|CREATE OR REPLACE VIEW|SECURITY DEFINER|supabase db push|supabase migration up/i);

console.log("PASS: admin financial overview view is restricted to backend service-role access without changing its definition.");
