# Withdrawal Queue Creation and Pairing Audit — 2026-10-20

## Status
**Source review complete for the creation/claim paths found. PostgreSQL replay and production approval remain blocked.** This report supersedes the earlier draft's incomplete conclusions about the queue schema.

## Effective migration sequence matters
- `20260903000002_withdrawal_rpcs.sql` defines a legacy `request_withdrawal` that creates `onchain_withdrawals`, then attempts to insert the companion `withdrawals` row and ledger entry inside exception-swallowing blocks. If this legacy definition were effective, those writes could fail silently while the RPC still returns an ID.
- `20260928020000_withdrawal_hardened_rpcs.sql` later drops legacy withdrawal RPC overloads and defines a hardened `request_withdrawal`. It creates one UUID, locks/debits the wallet asset, inserts both `withdrawals` and `onchain_withdrawals` with that same ID, and writes the ledger entry without swallowing insertion errors. In PostgreSQL, an unhandled error in this function should roll back the function's transaction statement. This later definition is the safer source-level design.
- The same later migration redefines `claim_pending_withdrawals` as `RETURNS SETOF public.onchain_withdrawals`, claiming rows from `onchain_withdrawals` where status is `PENDING`, setting them to `PROCESSING`, and returning the full row. That matches the worker's use of `id`, `asset_symbol`, `network`, `amount`, and `to_address`. Therefore the old `20260910000001_add_process_user_deposit_rpc.sql` claim function's `withdrawals.asset_symbol`/`withdrawals.network` mismatch is not enough on its own to conclude the final schema is broken; later migrations appear intended to replace it.
- The later migration revokes public/anon access to the claim RPC and grants it to `service_role` and `postgres`. A later restrictive migration also exists in the current working tree; effective grants still need replay verification.

## Remaining concerns
1. **The source alone does not prove which definitions/grants are deployed.** The connected DB was not queried and migrations were not replayed against PostgreSQL. Any already-applied DB may differ from the current migration files, especially because some historical migrations were edited after their original date.
2. **Creation idempotency needs careful review.** The hardened request function generates a new ID and uses a derived idempotency key (`w_<UUID>`); that is not a client-supplied idempotency key. Verify duplicate client submissions cannot create two withdrawals, lock funds twice, or create multiple payouts.
3. **Worker crash window remains.** The queue claim moves an onchain row to `PROCESSING` before the network send and before the transaction hash is durably stored. A crash around broadcast can leave uncertain state. Do not automatically reset/requeue/refund/rebroadcast without chain reconciliation.
4. **Schema compatibility still needs a clean replay.** The hardened function references both `asset_symbol`/`asset_code` and `network`/`network_code` in `withdrawals`; verify those columns and constraints exist in the final schema and that status casing/check constraints align with every RPC and worker.

## Required next steps
1. Replay every migration in order into a disposable PostgreSQL database and inspect the final function definitions, columns, constraints, triggers, and EXECUTE grants.
2. Add/verify client idempotency input to withdrawal creation, enforced transactionally by a unique key scoped to the authenticated user; a retry must return the original withdrawal ID without another balance or ledger mutation.
3. Add isolated integration tests for rollback atomicity, duplicate requests, insufficient funds, shared ID pairing, ledger uniqueness, concurrent requests/claims, and crash/ambiguous-broadcast reconciliation.
4. Design durable pre-broadcast intent/correlation so a worker crash can be reconciled against the chain before any retry or refund.
5. Review the migration diff and obtain explicit authorization before applying any change to a connected database.

## Validation
- Static withdrawal reconciliation candidate test: PASS (reported from prior step).
- Static withdrawal idempotency contract test: PASS (reported from prior step).
- PostgreSQL compilation, full migration replay, concurrency tests, and live schema inspection: NOT RUN.
- No connected database changes, push, merge, or deployment performed.
