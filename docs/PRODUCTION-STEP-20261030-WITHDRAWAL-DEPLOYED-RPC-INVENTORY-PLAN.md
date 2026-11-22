# Paxones Production Audit — Withdrawal RPC Inventory Plan (2026-10-30)

## Scope
Step 171 follows the local migration and route compatibility review. This report documents what can and cannot be established without a read-only connection to the target PostgreSQL catalogs. No database connection or SQL execution was attempted in this step.

## Confirmed from checked-in source

### Refund function and route
- `20261024100000_withdrawal_refund_rpc_forward_hardening.sql` drops the older two-, five-, and six-argument overloads and creates the hardened six-argument `process_failed_withdrawal(uuid,text,numeric,text,boolean,boolean)`.
- `20261026141000_fail_closed_withdrawal_refunds.sql` is a guard-only migration: it verifies the hardened six-argument function exists and rejects a legacy five-argument overload. The unsafe historical five-argument implementation is commented out and should not execute.
- `src/app/api/withdraw/refund/route.ts` calls `process_failed_withdrawal` with named `p_withdrawal_id` and `p_error_reason` only. The remaining parameters rely on defaults from the six-argument signature. This is only unambiguous if no competing callable overload with matching defaults exists.
- The refund route authenticates a worker secret, checks the RPC error, and requires a positive success result before reporting success. The route does not itself prove refund eligibility; the database function is authoritative.

### Worker fencing
- `20261028140000_withdrawal_worker_database_fencing.sql` adds owner-token signatures for queue claim and broadcast recording.
- It revokes service-role execution of the legacy unfenced helper signatures and grants `postgres` execution for internal helper calls, while granting service role execution to the owner-token signatures.
- This is a source-level grant declaration, not proof that production ACLs currently match it.

### Main outstanding production facts
Previously recorded read-only production observations are historical and were not re-queried in this step. They indicate the live deployment differs from checked-in migration expectations in withdrawal idempotency objects and the `onchain_withdrawals.idempotency_key` requirement. These observations still require current catalog confirmation.

## Read-only catalog inventory required before remediation
Run only with authorized read-only credentials against the explicitly selected environment. Do not run `supabase db push`, `migration up`, or any mutating SQL as part of inventory.

1. Enumerate all functions in `public` whose names match `%withdrawal%` or `%idempotency%` using `pg_proc`, `pg_namespace`, and `pg_get_function_identity_arguments(oid)`.
2. Capture argument names/defaults, return type, `prosecdef`, `proconfig`, owner, and full `pg_get_functiondef(oid)` output.
3. Capture effective grants for `PUBLIC`, `anon`, `authenticated`, `service_role`, and `postgres`; distinguish explicit grants from inherited role membership.
4. Enumerate `onchain_withdrawals`, `withdrawals`, `wallet_assets`, `ledger_entries`, and `withdrawal_worker_leases` columns, nullability, defaults, constraints, and indexes.
5. Read the migration ledger and compare installed versions with the local chain; do not infer that a migration was applied solely from a function's apparent body.
6. Store a sanitized catalog snapshot with secrets and personal data excluded; compare against the intended signatures and grants in version control.

## Deployment gates
- The six-argument hardened refund function must exist; a callable five-argument legacy overload must not remain.
- Only the intended owner-token queue/broadcast signatures may be executable by the worker role; unfenced helpers should remain internal to `postgres`.
- Request idempotency wrapper, replay lookup, backing table, and underlying insert schema must be consistent as a set.
- All migrations must replay on a disposable database seeded with a production-shaped schema, with every preflight and rollback behavior tested.
- A failed, ambiguous, or unverified chain broadcast must never release locked funds.
- No production withdrawal test should be performed with real funds; use an isolated environment and mocked chain/provider.

## Safety and status
- No database queried or modified in this step.
- No migration applied; no withdrawal attempted.
- No commit, push, or deployment.
- No GitHub Actions minutes used.
- Existing working-tree changes preserved.

**Status: Local source inventory plan completed. Current deployed RPC signatures and ACLs remain unverified; withdrawal production readiness remains blocked.**