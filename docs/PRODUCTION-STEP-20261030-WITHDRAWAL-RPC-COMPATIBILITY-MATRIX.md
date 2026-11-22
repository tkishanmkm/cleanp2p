# Paxones Production Audit — Withdrawal RPC Compatibility Matrix (2026-10-30)

## Scope and result
Mapped local withdrawal RPC definitions across migration history and checked active route call sites plus focused static regression suites. This is repository-only analysis; it did not query or modify any database.

## Key compatibility findings

### 1. Function signature drift / potential overloads
Local history contains materially different signatures for withdrawal functions:
- `request_withdrawal` begins in the initial schema with a different argument contract from the later user/network/address/amount/fee/asset RPC; later migrations repeatedly redefine the later contract.
- `process_failed_withdrawal` appears with a six-argument contract in `20260928020000_withdrawal_hardened_rpcs.sql`, then later migrations redefine a five-argument variant (including `20260928040000_withdrawal_security_boundary_hardening.sql`, `20260929000000_withdrawal_double_payout_and_state_hardening.sql`, and `20261026141000_fail_closed_withdrawal_refunds.sql`).
- `claim_pending_withdrawals` changes from a limit-only signature to an owner-token-plus-limit signature in `20261028140000_withdrawal_worker_database_fencing.sql`.
- Broadcast RPCs change from no-owner-token forms to owner-token forms in the worker-fencing migration.

In PostgreSQL, `CREATE OR REPLACE FUNCTION` replaces only the function with the same identity signature. Changing argument types/count can leave the old overload installed unless explicitly dropped. The repository scan alone does not prove which overloads remain in any environment. This is a high-priority migration review item because stale service-role-callable overloads may retain weaker behavior even when a newer overload is hardened.

### 2. Request idempotency prerequisites remain unresolved
The local app's idempotent request path depends on `request_withdrawal_idempotent(...)`, `lookup_withdrawal_idempotency_replay(...)`, and `withdrawal_idempotency_keys`. Earlier read-only production findings recorded that all three were absent in production. The base request RPC also has a separately documented mismatch with the observed production `onchain_withdrawals.idempotency_key` constraint.

### 3. Refund caller contract must be exact
The API refund route calls `process_failed_withdrawal`; migration history has multiple arities and semantics for the verified-unbroadcast flag. The latest local forward-hardening candidate explicitly rejects the legacy unbroadcast argument and requires chain-confirmed revert evidence for broadcasted transactions. The deployed signature, body, and grants are not currently verified.

### 4. Active route call sites found
- `src/app/api/admin/withdrawals/approve/route.ts` calls `approve_withdrawal`.
- `src/app/api/admin/withdrawals/review/route.ts` calls `approve_withdrawal` and `admin_reject_withdrawal`.
- `src/app/api/withdraw/refund/route.ts` calls `process_failed_withdrawal`.
- The canonical worker is intended to use the database-fenced claim/broadcast RPCs; alternate dispatch endpoints are disabled by local source contracts.

The call-site scan did not find all service-level RPC calls, so this is not a complete exhaustive call graph.

## Static verification
Ran 15 focused test files covering idempotency contracts, insert-contract repair guard, paired-row broadcast locks, worker fencing, refund safety, approval hardening, admin rejection, legacy endpoint containment, and migration filename validation.

**Result: 36 tests passed, 0 failed.**

The migration preflight separately scanned 164 files and found valid unique filename prefixes. These are static tests; no SQL was executed and no overload inventory was collected from PostgreSQL catalogs in this step.

## Required remediation plan (not executed)
1. Using read-only access, inventory every deployed `pg_proc` identity/signature, `proargnames`, `proargdefaults`, `prosecdef`, `proconfig`, owner, and effective EXECUTE grants for all withdrawal-related functions.
2. Compare exact function bodies/checksums with local intended canonical versions.
3. For every signature change, explicitly decide whether old overloads must be revoked and dropped; verify every drop has a safe replacement, correct grants, dependency handling, and rollback plan. Do not blindly drop functions.
4. Reconcile the production-only `onchain_withdrawals.idempotency_key` schema change and missing client idempotency objects before repairing request creation.
5. Run the full migration chain in a disposable PostgreSQL environment, then test each intended signature, caller permission, concurrent request, replay, approval, broadcast, ambiguous outcome, confirmed revert, and exactly-once refund.
6. Re-inventory the resulting catalog and assert that no legacy mutating overload remains executable by `PUBLIC`, `anon`, `authenticated`, or any unintended role.

## Safety
- No production database queries or writes in this step.
- No migrations applied.
- No withdrawal submitted.
- No commit, push, or deployment.
- No GitHub Actions minutes used.
- Existing working-tree changes preserved.

**Status: Static compatibility matrix complete. RPC overload inventory and production withdrawal readiness remain UNVERIFIED / BLOCKED.**