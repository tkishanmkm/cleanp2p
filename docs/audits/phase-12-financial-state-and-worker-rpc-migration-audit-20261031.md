# Phase 12 — Financial state, deposit ingress, and withdrawal worker audit (2026-10-31)

## Result

Completed a local-only audit of production wallet/deposit/withdrawal/ledger RPC catalogs and table contracts, and compared them with the current application routes/workers and pending SQL migrations. Production and staging were not modified.

## Production findings

### Deposit ingress and credit

- The live process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text) RPC exists and is executable by service_role. It is the canonical credit path used by the confirmation worker after independent chain verification.
- Its idempotency lock is keyed by normalized network, transaction hash, and output index. The live deposits schema also has a unique canonical transaction/output index and a unique deposit-ledger reference index.
- The current scanner/ingress code calls register_pending_deposit, but that function is absent from the live production catalog. The corresponding local candidate is 20261024120000_deposit_pending_registration_hardening.sql, which creates a pending-only registration RPC. This is a production migration-chain gap, not a reason to bypass the pending/confirmation separation.
- The confirmation worker verifies the exact transaction/output/event, destination, asset/contract, and required confirmations before calling the credit RPC. It has process-local single-flight protection; cross-process duplicate credit is additionally guarded by the atomic credit RPC. Cross-process scanner coordination remains a separate operational item.

### Withdrawal worker RPC drift

Production currently exposes the older withdrawal claim/lock contract:
- claim_pending_withdrawals(integer) — no owner-token argument.
- legacy acquire_withdrawal_worker_lock / release_withdrawal_worker_lock.
- no live acquire_withdrawal_worker_lease(uuid,integer), renew_withdrawal_worker_lease(uuid,integer), release_withdrawal_worker_lease(uuid).
- no live fenced claim_pending_withdrawals(uuid,integer), record_withdrawal_broadcast(uuid,text,uuid), or record_ambiguous_withdrawal_broadcast(uuid,text,text,uuid).

The current worker and the local candidate chain require the owner-token lease and database-fenced broadcast calls. The corresponding local candidates include 20261025045656_withdrawal_worker_owner_lease.sql and 20261028140000_withdrawal_worker_database_fencing.sql, followed by legacy-claim containment. Production's current RPC catalog is behind those application contracts. The retired alternate worker endpoint remains disabled locally.

### Withdrawal refund argument mismatch

The live production process_failed_withdrawal(uuid,text,numeric,text,boolean) function exposes only p_is_verified_unbroadcast. Its legacy body treats that flag as permission to refund even when a transaction hash is present, so this is not an acceptable long-term distinction between a pre-broadcast failure and an on-chain revert. The pending hardened local migration 20261024100000_withdrawal_refund_rpc_forward_hardening.sql replaces the legacy overload with a six-argument function containing separate p_is_verified_revert and p_is_verified_unbroadcast flags. It rejects any caller-supplied unbroadcast flag, and the verified-revert path requires the persisted transaction hash, paired withdrawal hash consistency, and a broadcast-capable state.

The worker is therefore aligned to the hardened six-argument target API and sends p_is_verified_revert: true only from the explicit TRON failed-receipt and EVM receipt-status-zero branches. It must NOT be deployed against the current five-argument production function. The hardened six-argument migration and the preflight guard 20261026141000_fail_closed_withdrawal_refunds.sql must be applied/rehearsed before the worker code is deployed or re-enabled.

Added tests/withdrawal-worker-refund-rpc-arguments.test.mjs and updated the older withdrawal-idempotency migration test to check the hardened six-argument contract.

### Critical withdrawals/ledger schema mismatch

The live production withdrawals table is the older shape. It has legacy chain, token_symbol, to_address, asset_symbol, network, and related fields, but lacks wallet_id and idempotency_key, which the current canonical reservation function writes.

The live ledger_entries table has legacy required user_id, amount, and type fields and a check constraint that only permits deposit, withdrawal, withdrawal_pending, transfer, or fee. It does not have the canonical wallet_id, asset_code, delta_available, delta_locked, available_after, locked_after, entry_type, ref_table, ref_id, or idempotency_key fields expected by current financial RPCs.

Production has the older request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) service-role-only RPC. The application now calls the idempotent wrapper/replay contract, which delegates to that canonical reservation function. Without the missing columns, the underlying reservation/ledger inserts are not compatible with the live table shape. This is a hard production release blocker until the schema is reconciled and rehearsed.

## Local changes

### Refund RPC argument

Restored p_is_verified_revert for the two explicit on-chain revert calls in src/jobs/withdrawalWorker.ts. The explicit failed TRON receipt branch and EVM status-zero branch remain the only callers. The code targets the hardened six-argument RPC and must wait for that migration before deployment.

### Withdrawal/ledger compatibility migration candidate

Added supabase/migrations/20261031115820_reconcile_legacy_withdrawal_ledger_schema.sql and tests/withdrawal-ledger-legacy-schema-bridge.test.mjs.

The candidate:
- preflights for the expected wallet, withdrawals, and ledger tables;
- accepts either the older production ledger contract or the canonical base schema;
- adds nullable canonical wallet/idempotency and double-entry ledger fields without backfilling historical financial rows;
- adds deferred NOT VALID wallet foreign keys when needed;
- adds single-column unique idempotency indexes if equivalent ones do not exist;
- adds a withdrawal BEFORE INSERT adapter to map canonical network/asset/destination aliases into old required columns;
- adds a ledger BEFORE INSERT adapter to translate canonical entry types to values accepted by the legacy type check, populate the legacy required amount/type fields, and fail closed on an unrecognized canonical type.

This is a compatibility candidate only. It has not been executed by PostgreSQL or replayed on a schema-faithful disposable database. Its trigger semantics, constraint interactions, and all old/new writer combinations must be tested against a copy of the production schema before deployment. Do not apply it directly to production.

### Idempotency test alignment

The prior withdrawal-idempotency-migration.test.ts expected an in-memory pendingWithdrawalKeys map that no longer exists. Updated it to verify the current persistent retry-key store:
- SHA-256-derived user/intent storage key, without storing raw intent details as the storage key;
- persistence and read-back verification before submission;
- reuse after ambiguous failure;
- no second optimistic debit on retry;
- clear only after definitive API success and only when the stored key still equals the expected key;
- Web Locks coordination where supported.

## Validation

- Financial-focused regression tests: 29 passed, 0 failed.
- npm run typecheck: passed.
- Migration preflight: 176 migration files, 176 unique valid version prefixes.
- git diff --check: passed; only the existing Git LF-to-CRLF normalization warnings were emitted.
- The schema bridge was validated statically only. No native PostgreSQL execution was possible because staging has no schema-faithful migration baseline.

## Release blockers / next actions

1. Reconstruct a schema-faithful staging baseline from the live catalog before replaying pending migrations. Production migration ledger remains behind the current code's worker and idempotent-withdrawal RPC contract.
2. Rehearse the compatibility bridge on an isolated schema copy with insert tests for both old and canonical withdrawal/ledger writers, all ledger entry-type mappings, unique replay behavior, refund/completion lock ordering, and foreign-key checks.
3. Rehearse the complete pending migration chain through the owner-token fencing and idempotency wrapper migrations.
4. Run concurrency tests for duplicate deposit registration/credit, same-key withdrawal replay, multiple worker owners, lease expiry, and post-broadcast settlement persistence.
5. Only then prepare an explicitly approved production rollout.

No production or staging SQL/DDL/DML was executed. No commit, push, merge, deployment, GitHub Actions workflow, or paid resource was created.