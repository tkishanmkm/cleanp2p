import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const service = read('src/lib/services/withdrawalService.ts');
const idempotencyStore = read('src/lib/withdrawal-idempotency-store.ts');
const walletContext = read('src/context/wallet-context.tsx');
const withdrawRoute = read('src/app/api/withdraw/route.ts');
const walletWithdrawRoute = read('src/app/api/wallet/withdraw/route.ts');
const withdrawalRequestRoute = read('src/app/api/withdrawals/request/route.ts');
const bannedRoute = read('src/app/api/user/banned-withdrawal/route.ts');
const replayMigration = read('supabase/migrations/20261105260000_withdrawal_replay_before_market_checks.sql');
const withdrawalContractMigration = read('supabase/migrations/20261102195301_repair_withdrawal_end_to_end_contract.sql');
const withdrawalAdminMigration = read('supabase/migrations/20261120223000_step_12_harden_withdrawal_admin_actor_identity.sql');
const approveRoute = read('src/app/api/admin/withdrawals/approve/route.ts');
const reviewRoute = read('src/app/api/admin/withdrawals/review/route.ts');
const legacyDispatchRoute = read('src/app/api/withdrawals/dispatch/route.ts');
const legacyProcessRoute = read('src/app/api/internal/withdrawals/process/route.ts');
const scheduledDispatchRoute = read('src/app/api/cron/withdrawals/dispatch/route.ts');
const workerBatchRoute = read('src/app/api/workers/withdrawals/route.ts');
const withdrawalWorker = read('src/jobs/withdrawalWorker.ts');

test('normal customer withdrawal routes converge on the canonical service and carry the retry key', () => {
  for (const route of [withdrawRoute, walletWithdrawRoute, withdrawalRequestRoute]) {
    assert.match(route, /executeCanonicalWithdrawal\(/);
    assert.match(route, /x-idempotency-key/);
    assert.match(route, /idempotencyKey:/);
    assert.match(route, /MAX_WITHDRAWAL_REQUEST_BYTES/);
  }

  assert.match(service, /process\.env\.ENABLE_WITHDRAWALS !== 'true'/);
  assert.match(service, /input\.idempotencyKey/);
  assert.match(service, /get_withdrawal_idempotency_replay/);
  assert.match(service, /request_withdrawal_idempotent/);
  assert.match(service, /is_banned|isBanned/);
  assert.match(service, /is_suspended|isSuspended/);
  assert.match(service, /is_restricted|isRestricted/);
  assert.match(service, /is_on_hold|isOnHold/);
  assert.match(service, /kyc_status|kycStatus/);
  assert.match(service, /totpCode/);
  assert.match(service, /withdrawal_fee_multiplier/);
  assert.match(service, /daily_withdrawal_limit_usd/);
  assert.match(service, /SUPPORTED_ASSETS/);
  assert.match(service, /SUPPORTED_NETWORKS/);
});

test('withdrawal retry keys are intent-scoped, persisted before submission and only cleared after success', () => {
  assert.match(idempotencyStore, /intentHash\(userId, fingerprint\)/);
  assert.match(idempotencyStore, /crypto\.randomUUID\(\)/);
  assert.match(idempotencyStore, /navigator\.locks\.request/);
  assert.match(idempotencyStore, /Unable to persist withdrawal retry state/);
  assert.match(idempotencyStore, /Clear only after a definitive successful response/);

  assert.match(walletContext, /getOrCreatePendingWithdrawalKeyDetails\(userId, withdrawalFingerprint\)/);
  assert.match(walletContext, /'x-idempotency-key': idempotencyKey/);
  assert.match(walletContext, /Keep the key when the outcome is not definitively acknowledged/);
  assert.match(walletContext, /clearPendingWithdrawalKey\(userId, withdrawalFingerprint, idempotencyKey\)/);
});

test('the idempotent reservation RPC and replay lookup use the same stable request fingerprint', () => {
  assert.match(withdrawalContractMigration, /CREATE OR REPLACE FUNCTION public\.request_withdrawal_idempotent/);
  assert.match(withdrawalContractMigration, /Service role required for withdrawal idempotency/);
  assert.match(withdrawalContractMigration, /financial_idempotency_keys/);
  assert.match(withdrawalContractMigration, /withdrawal_request/);
  assert.match(withdrawalContractMigration, /FOR UPDATE/);
  assert.match(withdrawalContractMigration, /request_hash/);

  assert.match(replayMigration, /CREATE OR REPLACE FUNCTION public\.get_withdrawal_idempotency_replay/);
  assert.match(replayMigration, /RETURNS JSONB/);
  assert.match(replayMigration, /SET search_path = ''/);
  assert.match(replayMigration, /Service role required for withdrawal replay lookup/);
  assert.match(replayMigration, /RETURN pg_catalog\.jsonb_build_object\('found', FALSE\)/);
  assert.match(replayMigration, /'found', TRUE/);
  assert.match(replayMigration, /'response', v_existing\.response_payload/);
  assert.match(replayMigration, /REVOKE ALL ON FUNCTION public\.get_withdrawal_idempotency_replay/);
  assert.match(replayMigration, /TO service_role, postgres/);
});

test('banned-account final withdrawal stays closed until a dedicated audited recovery workflow exists', () => {
  assert.match(bannedRoute, /auth\.getUser\(\)/);
  assert.match(bannedRoute, /is_banned/);
  assert.match(bannedRoute, /account_status/);
  assert.match(bannedRoute, /BANNED_FINAL_WITHDRAWAL_UNAVAILABLE/);
  assert.match(bannedRoute, /status: 503/);
  assert.match(bannedRoute, /wallet balance has not been changed/);
  assert.doesNotMatch(bannedRoute, /executeCanonicalWithdrawal/);
  assert.doesNotMatch(bannedRoute, /\.from\('wallet_assets'\)/);
  assert.doesNotMatch(bannedRoute, /\.rpc\(/);
  assert.doesNotMatch(bannedRoute, /broadcast|signTransaction|sendTransaction/);
});

test('admin approval and rejection stay full-admin-only and require confirmed RPC outcomes', () => {
  assert.match(approveRoute, /verifyServerAdmin\(req\)/);
  assert.match(approveRoute, /auth\.supportAdmin === true/);
  assert.match(approveRoute, /isWithdrawalIdValid/);
  assert.match(approveRoute, /rpc\('approve_withdrawal'/);
  assert.match(approveRoute, /parsedResult\.success !== true/);
  assert.doesNotMatch(approveRoute, /err\.message/);

  assert.match(reviewRoute, /verifyServerAdmin\(req\)/);
  assert.match(reviewRoute, /auth\.supportAdmin === true/);
  assert.match(reviewRoute, /rpc\('approve_withdrawal'/);
  assert.match(reviewRoute, /rpc\('reject_withdrawal_pending_approval'/);
  assert.match(reviewRoute, /rpcData\.success !== true/);
  assert.match(reviewRoute, /refundData\.success !== true/);
});

test('withdrawal approval/refund SQL binds the actor to an active full-admin identity', () => {
  assert.match(withdrawalAdminMigration, /CREATE FUNCTION public\.is_active_withdrawal_admin_actor/);
  assert.match(withdrawalAdminMigration, /public\.verify_admin_login\(p_user_id, NULL\)/);
  assert.match(withdrawalAdminMigration, /lower\(coalesce\(p\.status::text, ''\)\) = 'active'/);
  assert.match(withdrawalAdminMigration, /p\.is_banned/);
  assert.match(withdrawalAdminMigration, /p\.is_suspended/);
  assert.match(withdrawalAdminMigration, /p\.is_restricted/);
  assert.match(withdrawalAdminMigration, /p\.is_on_hold/);
  assert.match(withdrawalAdminMigration, /p\.is_emergency_frozen/);
  assert.match(withdrawalAdminMigration, /p\.is_minor_restricted/);
  assert.match(withdrawalAdminMigration, /v_is_admin := public\.is_active_withdrawal_admin_actor\(p_admin_id\)/);
  assert.match(withdrawalAdminMigration, /v_admin := public\.is_active_withdrawal_admin_actor\(p_admin_id\)/);
  assert.match(withdrawalAdminMigration, /v_acl_after IS DISTINCT FROM v_acl_before/);
  assert.match(withdrawalAdminMigration, /admin_audit_logs/);
  assert.match(withdrawalAdminMigration, /TO postgres/);
});

test('legacy direct-broadcast routes stay retired; scheduled workers use the canonical lease-aware worker', () => {
  assert.match(legacyDispatchRoute, /LEGACY_WITHDRAWAL_DISPATCH_DISABLED/);
  assert.match(legacyDispatchRoute, /status: 410/);
  assert.match(legacyProcessRoute, /LEGACY_WITHDRAWAL_PROCESSOR_DISABLED/);
  assert.match(legacyProcessRoute, /status: 410/);
  assert.match(scheduledDispatchRoute, /processPendingWithdrawals\(\)/);
  assert.match(scheduledDispatchRoute, /verifyWorkerAuth/);
  assert.match(workerBatchRoute, /verifyWorkerAuth/);
  assert.match(workerBatchRoute, /processAllPendingWithdrawals/);
  assert.match(withdrawalWorker, /Math\.min\(maxBatch, 100\)/);
});
