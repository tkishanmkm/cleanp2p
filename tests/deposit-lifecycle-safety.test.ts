import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const worker = read('src/jobs/confirmationsWorker.ts');
const registrationMigration = read('supabase/migrations/20261104130000_deposit_confirmation_contract.sql');

test('deposit credit requires independently verified on-chain output evidence and threshold', () => {
  const verificationUnavailable = worker.indexOf('if (!onChainData)');
  const verifiedCount = worker.indexOf('const currentConfirmations = onChainData.confirmations');
  const thresholdGuard = worker.indexOf('if (currentConfirmations < requiredConfs)');
  const creditCall = worker.indexOf("rpc('process_deposit_atomic_with_lease'");

  assert.ok(verificationUnavailable >= 0 && verifiedCount > verificationUnavailable);
  assert.ok(thresholdGuard > verifiedCount && creditCall > thresholdGuard);
  assert.match(worker.slice(verificationUnavailable, verifiedCount), /newConfirmations: 0/);
  assert.match(worker.slice(thresholdGuard, creditCall), /credit RPC not called/);
  assert.match(worker.slice(thresholdGuard, creditCall), /continue;/);
  assert.doesNotMatch(worker, /rpc\(['"]process_deposit_atomic['"]/);
});

test('scanner registration is service-role-only and can register only zero-confirmation candidates', () => {
  const start = registrationMigration.indexOf('CREATE OR REPLACE FUNCTION public.register_pending_deposit');
  const end = registrationMigration.indexOf('REVOKE ALL ON FUNCTION public.register_pending_deposit', start);
  assert.ok(start >= 0 && end > start);
  const registration = registrationMigration.slice(start, end);
  assert.match(registration, /SECURITY DEFINER/);
  assert.match(registration, /SET search_path = ''/);
  assert.match(registration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(registration, /p_confirmations IS DISTINCT FROM 0/);
  assert.match(registration, /public\.process_deposit_atomic\([\s\S]*?\s+0,\s+p_provider/);
  assert.doesNotMatch(registration, /INSERT INTO public\.ledger_entries/i);
  assert.doesNotMatch(registration, /UPDATE public\.wallet_assets/i);
});

test('cross-process deposit claims use row locks, bounded batches and expiring owner tokens', () => {
  const start = registrationMigration.indexOf('CREATE OR REPLACE FUNCTION public.claim_pending_deposit_confirmations');
  const end = registrationMigration.indexOf('REVOKE ALL ON FUNCTION public.claim_pending_deposit_confirmations', start);
  assert.ok(start >= 0 && end > start);
  const claim = registrationMigration.slice(start, end);
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim, /confirmation_worker_id = p_owner_token/);
  assert.match(claim, /confirmation_lease_expires_at/);
  assert.match(claim, /least\(100, greatest\(1, coalesce\(p_limit, 10\)\)\)/);
  assert.match(claim, /least\(900, greatest\(30, coalesce\(p_lease_seconds, 300\)\)\)/);
});

test('deposit leases can only be released by their owning worker token', () => {
  const start = registrationMigration.indexOf('CREATE OR REPLACE FUNCTION public.release_pending_deposit_confirmation_claim');
  const end = registrationMigration.indexOf('REVOKE ALL ON FUNCTION public.release_pending_deposit_confirmation_claim', start);
  assert.ok(start >= 0 && end > start);
  const release = registrationMigration.slice(start, end);
  assert.match(release, /confirmation_worker_id = p_owner_token/);
  assert.match(release, /SET confirmation_worker_id = NULL/);
  assert.match(release, /confirmation_lease_expires_at = NULL/);
});

test('leased credit wrapper validates current lease and exact transaction-output identity before canonical credit', () => {
  const start = registrationMigration.indexOf('CREATE OR REPLACE FUNCTION public.process_deposit_atomic_with_lease');
  const end = registrationMigration.indexOf('REVOKE ALL ON FUNCTION public.process_deposit_atomic_with_lease', start);
  assert.ok(start >= 0 && end > start);
  const credit = registrationMigration.slice(start, end);
  assert.match(credit, /v_deposit\.status <> 'PENDING'/);
  assert.match(credit, /confirmation_worker_id IS DISTINCT FROM p_lease_token/);
  assert.match(credit, /confirmation_lease_expires_at IS NULL/);
  assert.match(credit, /confirmation_lease_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(credit, /v_deposit\.tx_hash IS DISTINCT FROM p_tx_hash/);
  assert.match(credit, /v_deposit\.output_index IS DISTINCT FROM p_output_index/);
  assert.match(credit, /v_deposit\.amount IS DISTINCT FROM p_amount/);
  assert.match(credit, /v_saved_address IS DISTINCT FROM v_requested_address/);
  assert.match(credit, /v_result := public\.process_deposit_atomic\(/);
  assert.match(credit, /'CONFIRMED', 'ALREADY_CREDITED'/);
});

test('worker uses the database lease contract and always releases unconsumed claims', () => {
  assert.match(worker, /claim_pending_deposit_confirmations/);
  assert.match(worker, /p_limit: 10/);
  assert.match(worker, /p_lease_seconds: 300/);
  assert.match(worker, /release_pending_deposit_confirmation_claim/);
  assert.match(worker, /finally \{\s*await releaseDepositClaim\(deposit\.id\);/);
  assert.match(worker, /process_deposit_atomic_with_lease/);
  assert.match(worker, /p_confirmations: currentConfirmations/);
  assert.match(worker, /if \(claimError\)[\s\S]*?result\.failedCount\+\+[\s\S]*?return result;/);
});

test('worker accepts only canonical confirmed or already-credited RPC response shapes', () => {
  const start = worker.indexOf('const isCredited =');
  const end = worker.indexOf('if (isCredited)', start);
  assert.ok(start >= 0 && end > start);
  const guard = worker.slice(start, end);
  assert.match(guard, /parsedRes\?\.success === true/);
  assert.match(guard, /parsedRes\?\.status === 'CONFIRMED'/);
  assert.match(guard, /parsedRes\?\.credited === true/);
  assert.match(guard, /parsedRes\?\.already_credited === false/);
  assert.match(guard, /parsedRes\?\.status === 'ALREADY_CREDITED'/);
  assert.match(guard, /parsedRes\?\.credited === false/);
  assert.match(guard, /parsedRes\?\.already_credited === true/);
});

test('deposit confirmation SECURITY DEFINER functions are not exposed to browser roles', () => {
  for (const name of [
    'register_pending_deposit',
    'claim_pending_deposit_confirmations',
    'release_pending_deposit_confirmation_claim',
    'process_deposit_atomic_with_lease',
  ]) {
    const pattern = new RegExp('REVOKE ALL ON FUNCTION public\\.' + name + '\\(');
    assert.match(registrationMigration, pattern, name + ' must revoke public execution');
  }
  assert.match(registrationMigration, /TO service_role, postgres/);
  assert.match(registrationMigration, /SET search_path TO pg_catalog/);
});

test('worker coalesces concurrent in-process invocations and records fatal exceptions', () => {
  assert.match(worker, /let activeWorkerRun: Promise<ConfirmationWorkerResult> \| null = null/);
  assert.match(worker, /if \(activeWorkerRun\) return activeWorkerRun/);
  assert.match(worker, /activeWorkerRun = executeConfirmationsWorker\(\)\.finally\(\(\) => \{/);
  assert.match(worker, /catch \(err: any\) \{\s*console\.error\('Fatal error in runConfirmationsWorker:', err\);\s*result\.failedCount\+\+;/);
});

console.log('PASS: canonical deposit registration, claim/release leases, independent evidence and credit RPC source contracts');
console.log('NOTE: source-contract checks do not replace a controlled integration run against a disposable schema-matched database.');
