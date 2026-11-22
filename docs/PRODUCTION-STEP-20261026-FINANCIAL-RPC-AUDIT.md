# Paxones Production Audit — Wallet, Deposit and Withdrawal RPCs (2026-10-26)

## Scope
Read-only production catalog/function inspection plus local source and static regression tests. No production mutation was performed.

## Findings

### 1. High-priority production/local withdrawal refund drift
The live production catalog exposes `public.process_failed_withdrawal` with the legacy five-argument identity signature `(uuid, text, numeric, text, boolean)`. The local forward-hardening migration `20261024100000_withdrawal_refund_rpc_forward_hardening.sql` replaces legacy overloads with a six-argument function `(uuid, text, numeric, text, boolean, boolean)` and adds paired-row locks, strict pre-broadcast/verified-revert checks, locked-liability invariants, refund-ledger idempotency, and terminal-state reconciliation.

The live production definition hash observed for the five-argument function is `2e4fc4171a76b121e2ff0e9760a821a1`. The local candidate has not been proven deployed. Treat refund behavior as a release blocker until exact migration history and function body are reconciled and tested. Do not apply the migration blindly because production/local migration history is already divergent.

### 2. Withdrawal approval RPC is service-role-only, but its actor ID is a trusted parameter
Production `approve_withdrawal(uuid, uuid)` has EXECUTE granted to `service_role` and denied to `anon`/`authenticated`. Its body checks that the supplied `p_admin_id` exists in `app_admins` or admin-marked `profiles`, locks the withdrawal row, validates the pending state, updates paired withdrawal rows, and inserts an audit record. The database function does not itself bind that ID to `auth.uid()`; safety therefore depends on the service-role API route correctly authenticating the administrator and supplying the verified ID. Local route tests cover this contract, but production runtime tests remain outstanding.

### 3. Deposit crediting is restricted to trusted execution roles
`process_deposit_atomic` is SECURITY DEFINER and has EXECUTE granted to `service_role`, not `anon` or `authenticated`. It validates required inputs, positive amount, transaction hash/output index, confirmation count and network/asset mapping. Local ingress tests assert that scanner/webhook payloads cannot directly assert confirmations or bypass token-log-index evidence. These are useful safeguards, but actual chain-confirmation behavior and idempotent duplicate handling still require isolated DB/chain-fixture tests.

Several legacy credit functions (`credit_deposit_atomic`, `credit_onchain_deposit`, `process_deposit`, `process_incoming_deposit`, `process_user_deposit` overloads) are not executable by anon/authenticated/service_role in the live catalog. Keep them disabled unless exact owners, dependencies and intended retirement are established; do not restore grants speculatively.

### 4. Canonical withdrawal idempotency needs live verification
Local `withdrawalService.ts` uses `request_withdrawal_idempotent` for requests with an idempotency key and fails closed if replay lookup fails. Local migration `20261019180000_add_idempotent_withdrawal_wrapper.sql` defines a service-role-only wrapper and replay table. The production RPC catalog output did not show this wrapper, while the local service calls it. Verify its live existence, signature, grant, and paired replay lookup RPC before launch. If absent, keyed withdrawals may fail closed rather than create duplicate withdrawals; confirm via live catalog and route integration test.

### 5. Candidate withdrawal minimum/security migration is not production-validated
Local `20261026120000_harden_withdrawal_rpc_restrictions_and_minimum.sql` patches `request_withdrawal` only when exact expected code markers match, adds restriction/suspension checks, requires authoritative USD valuation and a $5 minimum, and sets an empty search path. It is a candidate, not evidence of production state. Validate against a schema-faithful disposable DB before any deployment.

## Local test run
Passed: **22 tests, 0 failures** across static tests for refund hardening, approval hardening, idempotency contracts, financial write guards, refund/admin route safety, and deposit ingress/confirmation trust.

A separate run that included `tests/canonical-deposit-cutover.test.ts` was blocked by its explicit safety preflight because no disposable test DB environment is configured (`PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, `PAXONES_TEST_DB_ALLOW_MUTATIONS=1`). This test was not run against production; do not supply production credentials to bypass the guard.

## Release blockers / next actions
1. Reconcile exact production-applied migration versions and function definitions before any DDL.
2. Verify production `request_withdrawal_idempotent` and replay lookup RPC existence, signature and service-role grants.
3. Recover and compare the exact live refund function body against the six-argument candidate, then test duplicate refund, broadcast ambiguity, paired-row mismatch and insufficient locked liability in an isolated DB.
4. Exercise approval and refund route authorization using non-admin and admin test identities; verify audit actor attribution.
5. Validate deposit duplicate transaction/output handling and chain-confirmation evidence in isolated tests.

## Safety
Production queries were read-only. No SQL was applied, no commits/pushes/deployments were made, and existing working-tree changes were preserved.
