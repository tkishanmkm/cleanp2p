import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20261014070000_atomic_deposit_block_hash_persistence.sql';
const sql = readFileSync(migrationPath, 'utf8');

const functionDefinition = sql.match(/CREATE OR REPLACE FUNCTION public\.process_deposit_atomic[\s\S]*?\$function\$;?/g) ?? [];
assert.equal(functionDefinition.length, 1, 'migration must define exactly one atomic deposit function');
assert.equal((sql.match(/\$function\$/g) ?? []).length, 2, 'function body delimiters must be balanced');
assert.match(sql, /BLOCK_HASH_REQUIRED/, 'missing block hashes must fail closed');
assert.match(sql, /INVALID_BLOCK_HASH/, 'malformed block hashes must fail closed');
assert.match(sql, /DEPOSIT_BLOCK_HASH_MISMATCH/, 'changed stored hashes must be rejected for manual reconciliation');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([^;]+ FROM PUBLIC;/, 'function execute must be revoked from PUBLIC');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([^;]+ FROM anon, authenticated;/, 'function execute must be revoked from client roles');
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_deposit_atomic\([^;]+ TO service_role;/, 'function execute must be granted to service_role');

const mismatchGuard = sql.indexOf('DEPOSIT_BLOCK_HASH_MISMATCH');
const pendingBranch = sql.indexOf('-- PENDING DEPOSIT');
assert.ok(mismatchGuard > 0 && pendingBranch > mismatchGuard, 'hash mismatch guard must occur before pending-state writes');

console.log('Deposit migration static safety checks passed. This is not a PostgreSQL parser or execution test.');
