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
assert.match(sql, /v_effective_confirmations := COALESCE\(p_confirmations, 0\)/,
  'credit eligibility must use the current independently verified confirmation count');
assert.doesNotMatch(sql, /GREATEST\([\s\S]{0,160}v_existing_onchain\.confirmations/,
  'persisted confirmations must never elevate a stale or lower current confirmation observation');
assert.match(sql, /CONFIRMED_DEPOSIT_CONFIRMATIONS_REGRESSED/,
  'a credited deposit must not be downgraded when the current confirmation count falls below threshold');
assert.match(sql, /Previously credited deposit needs reorg review; no status or balance changes were made/,
  'confirmation regression must return for review without changing credited state');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([^;]+ FROM PUBLIC;/, 'function execute must be revoked from PUBLIC');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([^;]+ FROM anon, authenticated;/, 'function execute must be revoked from client roles');
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_deposit_atomic\([^;]+ TO service_role;/, 'function execute must be granted to service_role');

const mismatchGuard = sql.indexOf('DEPOSIT_BLOCK_HASH_MISMATCH');
const pendingBranch = sql.indexOf('-- PENDING DEPOSIT');
assert.ok(mismatchGuard > 0 && pendingBranch > mismatchGuard, 'hash mismatch guard must occur before pending-state writes');


const txLock = sql.indexOf("'deposit:' ||");
const existingDepositLock = sql.indexOf("FROM public.deposits", txLock);
const existingOnchainLock = sql.indexOf("FROM public.onchain_deposits", existingDepositLock);
assert.ok(txLock > 0 && existingDepositLock > txLock && existingOnchainLock > existingDepositLock,
  'transaction identity advisory lock must be acquired before existing deposit rows are read');
const walletAssetLock = sql.indexOf("'wallet_asset:' ||");
const walletAssetRowLock = sql.indexOf('FROM public.wallet_assets', walletAssetLock);
const balanceWrite = sql.indexOf('UPDATE public.wallet_assets', walletAssetRowLock);
assert.ok(walletAssetLock > 0 && walletAssetRowLock > walletAssetLock && balanceWrite > walletAssetRowLock,
  'wallet asset advisory lock and row lock must precede balance updates');
const ledgerIdempotency = sql.indexOf('-- LEDGER IDEMPOTENCY');
const duplicateCreditReturn = sql.indexOf("'status', 'ALREADY_CREDITED'", ledgerIdempotency);
const firstBalanceWrite = sql.indexOf('UPDATE public.wallet_assets', ledgerIdempotency);
assert.ok(ledgerIdempotency > 0 && duplicateCreditReturn > ledgerIdempotency && firstBalanceWrite > duplicateCreditReturn,
  'duplicate ledger detection must return before any wallet balance credit');


assert.match(sql, /v_block_hash := LOWER\([\s\S]*?SUBSTRING\(BTRIM\(p_block_hash\) FROM 3\)/,
  'optional 0x prefix must be removed when canonicalizing a valid block hash');
assert.match(sql, /LOWER\(v_existing_deposit\.block_hash\) IS DISTINCT FROM v_block_hash/,
  'existing deposit block hash must be compared with the canonical hash');
assert.match(sql, /block_hash = COALESCE\(v_block_hash, block_hash\)/,
  'block hash columns must store the canonical hash');
const postValidation = sql.slice(sql.indexOf('v_block_hash :='));
assert.doesNotMatch(postValidation, /(^|\n)\s+p_block_hash\s*[,)]/,
  'raw caller block hash must not be persisted after canonicalization');


assert.match(sql, /COALESCE\(NULLIF\(v_from_address, ''\), ''\)/,
  'deposit insert must respect the live NOT NULL from_address column when sender is unavailable');
assert.match(sql, /'code', 'WALLET_BALANCE_INVALID'/,
  'NULL or negative wallet balances must fail closed before credit');


assert.match(sql, /DEPOSIT_ADDRESS_OWNERSHIP_AMBIGUOUS/,
  'conflicting ownership across canonical deposit-address and legacy wallet records must fail closed');
assert.match(sql, /uda\.user_id <> w\.user_id/,
  'cross-table address ownership guard must compare distinct user identities');
const ledgerBlock = sql.slice(sql.indexOf('-- LEDGER IDEMPOTENCY'), sql.indexOf('-- CREDIT wallet_assets.balance ONLY'));
assert.match(ledgerBlock, /FROM public\.ledger_entries\s+WHERE reference_id = v_deposit_id::TEXT\s+AND type = 'deposit'/,
  'deposit idempotency count must ignore unrelated ledger entry types sharing a reference string');
assert.match(ledgerBlock, /SELECT \*\s+INTO v_existing_ledger\s+FROM public\.ledger_entries\s+WHERE reference_id = v_deposit_id::TEXT\s+AND type = 'deposit'/,
  'existing ledger validation must select only the deposit entry for this deposit reference');
assert.match(sql, /WHERE network::TEXT = 'bitcoin'\s+AND BTRIM\(address\) = BTRIM\(v_address\)/,
  'Bitcoin deposit-address ownership must preserve case-sensitive Base58 address matching');
assert.match(sql, /WHERE chain = 'BTC'\s+AND BTRIM\(address\) = BTRIM\(v_address\)/,
  'Bitcoin legacy-wallet ownership must preserve case-sensitive address matching');
assert.match(sql, /v_network = 'BTC'[\s\S]*?BTRIM\(uda\.address\) = BTRIM\(v_address\)/,
  'cross-table Bitcoin ownership checks must use exact address equality');


const creditStart = sql.indexOf('-- CREDIT wallet_assets.balance ONLY');
const ledgerInsert = sql.indexOf('INSERT INTO public.ledger_entries', creditStart);
const depositFinalize = sql.indexOf('UPDATE public.deposits', ledgerInsert);
const onchainFinalize = sql.indexOf('-- FINALIZE ON-CHAIN DEPOSIT', depositFinalize);
const finalSuccess = sql.indexOf("'status', 'CONFIRMED'", onchainFinalize);
assert.ok(creditStart > 0 && ledgerInsert > creditStart && depositFinalize > ledgerInsert &&
  onchainFinalize > depositFinalize && finalSuccess > onchainFinalize,
  'wallet credit, ledger insert, and both deposit finalizations must remain in the same ordered function path');
assert.doesNotMatch(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.process_deposit_atomic'), sql.indexOf('$function$;', sql.indexOf('CREATE OR REPLACE FUNCTION public.process_deposit_atomic'))),
  /EXCEPTION\s+WHEN[\s\S]*?THEN[\s\S]*?RETURN\s+jsonb_build_object/,
  'the atomic credit function must not swallow a write failure and return success after partial writes');
assert.match(sql, /INSERT INTO public\.ledger_entries[\s\S]*?RETURNING id INTO v_ledger_id/,
  'deposit ledger insertion must return a ledger id before success is reported');

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
assert.doesNotMatch(audit, /\.from\('(deposits|user_balances|wallet_balances|ledger_entries|financial_ledger)'\)\s*\.(update|insert|upsert|delete)|\.rpc\s*\(/, 'reorg audit may record review incidents but must not mutate financial records or call financial RPCs');

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

assert.match(worker, /const indexRequired =\s*[\s\S]*normNet === 'BTC'[\s\S]*normNet === 'LTC'[\s\S]*SUPPORTED_EVM_CHAINS\[normNet\]/,
  'confirmation worker must require output/event indexes for UTXO outputs and supported token events');
assert.match(worker, /Required output\/event index is missing; credit RPC not called\./,
  'confirmation worker must keep deposits pending when required index is missing');
