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
const workerPath = 'src/jobs/confirmationsWorker.ts';
const worker = readFileSync(workerPath, 'utf8');
const auditStart = worker.indexOf('export async function runConfirmedDepositReorgAudit');
const auditEnd = worker.indexOf('Main worker logic', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart, 'confirmed-deposit reorg audit helper must exist');
const audit = worker.slice(auditStart, auditEnd);
assert.match(audit, /\.from\('onchain_deposits'\)/, 'reorg audit must inspect on-chain deposit records');
assert.match(audit, /\.eq\('status', 'CONFIRMED'\)/, 'reorg audit must include confirmed deposits');
assert.match(audit, /Math\.min\(500, Math\.max\(1, limit\)\)/, 'reorg audit batch size must be bounded');
assert.match(audit, /storedHash !== normalizedObserved/, 'reorg audit must compare stored and observed canonical hashes');
assert.match(audit, /REORG_SUSPECTED/, 'reorg audit must flag hash mismatches');
assert.doesNotMatch(audit, /\.update\s*\(|\.insert\s*\(|\.upsert\s*\(|\.delete\s*\(|\.rpc\s*\(/, 'reorg audit must remain read-only and must not call financial RPCs');

console.log('Confirmed-deposit reorg audit static safety checks passed. This is not a runtime chain or database test.');
const incidentMigration = readFileSync(
  'supabase/migrations/20261014080000_create_deposit_reorg_incidents.sql',
  'utf8'
);
assert.match(incidentMigration, /CREATE TABLE IF NOT EXISTS public\.deposit_reorg_incidents/);
assert.match(incidentMigration, /UNIQUE INDEX IF NOT EXISTS deposit_reorg_incidents_identity_key/);
assert.match(incidentMigration, /REORG_SUSPECTED/);
assert.match(incidentMigration, /MISSING_STORED_HASH/);
assert.match(incidentMigration, /review_status text NOT NULL DEFAULT 'OPEN'/);
assert.match(incidentMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(incidentMigration, /REVOKE ALL ON TABLE public\.deposit_reorg_incidents FROM PUBLIC, anon, authenticated/);
assert.match(incidentMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.deposit_reorg_incidents TO service_role/);
assert.doesNotMatch(incidentMigration, /UPDATE public\.(deposits|onchain_deposits|user_balances|wallet_balances|ledger_entries)|INSERT INTO public\.(ledger_entries|financial_ledger)|process_deposit_atomic/i,
  'incident-table migration must not alter financial balances, deposit records, or call credit RPCs');

console.log('Deposit reorg incident migration static safety checks passed. This is not a PostgreSQL parser or execution test.');


const recorderStart = worker.indexOf('export async function recordConfirmedDepositReorgIncidents');
const recorderEnd = worker.indexOf('Main worker logic', recorderStart);
assert.ok(recorderStart >= 0 && recorderEnd > recorderStart, 'incident recorder must exist');
const recorder = worker.slice(recorderStart, recorderEnd);
assert.match(recorder, /\.from\('deposit_reorg_incidents'\)/, 'recorder may write only to incident review table');
assert.match(recorder, /\.from\('onchain_deposits'\)/, 'recorder must resolve source deposit output index');
assert.match(recorder, /sourceNetwork !== network/, 'recorder must validate the source network');
assert.match(recorder, /sourceTxHash !== txHash/, 'recorder must validate the source transaction hash');
assert.match(recorder, /Number\.isSafeInteger\(sourceOutputIndex\)/, 'recorder must reject missing/invalid output indices');
assert.doesNotMatch(recorder, /sourceDeposit\.output_index \?\? sourceDeposit\.log_index \?\? 0/, 'recorder must not silently collapse missing output indices to zero');
assert.match(recorder, /review_status: 'OPEN'/, 'new incidents must start open');
assert.match(recorder, /hashChanged[\s\S]*review_status: 'OPEN'/, 'changed canonical hashes must reopen incidents');
assert.doesNotMatch(recorder, /\.from\('(deposits|user_balances|wallet_balances|ledger_entries|financial_ledger)'\)\s*\.(update|insert|upsert|delete)|\.rpc\s*\(/,
  'incident recorder must never change balances, deposits, ledgers, or call financial RPCs');
console.log('Deposit reorg incident recorder static safety checks passed.');
