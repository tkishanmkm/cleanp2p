import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const path = join(process.cwd(), "supabase", "migrations", "20261018110000_restrict_public_financial_write_policies.sql");
const sql = readFileSync(path, "utf8");

assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.ads FROM PUBLIC, anon/i);
assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.p2p_ads FROM PUBLIC, anon/i);
assert.match(sql, /DROP POLICY IF EXISTS "Users can insert transfers as sender" ON public\.transfers/i);
assert.match(sql, /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.transfers FROM PUBLIC, anon/i);
assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.transfers FROM authenticated/i);
assert.match(sql, /GRANT SELECT ON TABLE public\.transfers TO authenticated, service_role/i);
assert.match(sql, /GRANT INSERT ON TABLE public\.transfers TO service_role/i);
assert.match(sql, /CREATE POLICY "Service role can manage transfers"\s+ON public\.transfers\s+FOR ALL\s+TO service_role\s+USING \(true\)\s+WITH CHECK \(true\)/i);
assert.match(sql, /CREATE POLICY "Users can view their own transfers"\s+ON public\.transfers\s+FOR SELECT\s+TO authenticated\s+USING \(auth\.uid\(\) = sender_id OR auth\.uid\(\) = recipient_id\)/i);
assert.doesNotMatch(sql, /CREATE POLICY\s+"Users can insert transfers as sender"/i);

console.log("PASS: financial-write migration static contract checks");
console.log("NOTE: This does not replace executing the migration against a disposable PostgreSQL/Supabase database.");
