import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const path = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019100000_add_financial_fk_indexes.sql",
);
const sql = readFileSync(path, "utf8");

const expectedIndexes = [
  ["idx_deposits_user_id", "deposits", "user_id"],
  ["idx_platform_ledger_entries_related_user_id", "platform_ledger_entries", "related_user_id"],
  ["idx_profiles_emergency_frozen_by", "profiles", "emergency_frozen_by"],
  ["idx_sweep_queue_user_id", "sweep_queue", "user_id"],
  ["idx_utxo_reservations_sweep_id", "utxo_reservations", "sweep_id"],
];

for (const [indexName, tableName, columnName] of expectedIndexes) {
  const pattern = new RegExp(
    `CREATE INDEX IF NOT EXISTS ${indexName}\\s+ON public\\.${tableName}\\s*\\(\\s*${columnName}\\s*\\)`,
    "i",
  );
  assert.match(sql, pattern, `Missing expected FK index: ${indexName}`);
}

assert.match(sql, /BEGIN\s*;[\s\S]*COMMIT\s*;/i);
assert.doesNotMatch(sql, /DROP INDEX|DROP TABLE|DELETE FROM|TRUNCATE/i);

console.log("PASS: all five advisor-reported foreign-key index definitions are present");
console.log("NOTE: Static checks do not confirm live index state or query-plan improvements.");
