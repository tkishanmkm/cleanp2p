# Paxones Production Audit — Withdrawal Insert Contract Mismatch (2026-10-26)

## Severity: Critical release blocker

Read-only production catalog inspection found that `public.onchain_withdrawals.idempotency_key` is `NOT NULL` and has no column default. The live `public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)` function inserts into `public.onchain_withdrawals` but its INSERT column list and VALUES do not include `idempotency_key`.

Observed live function MD5: `64c72eef3e65e2c9c3b419f886f41c60`.

The same function's insert into `public.withdrawals` supplies an internal key `'w_' || v_withdrawal_id::TEXT`, but that does not satisfy the separate `onchain_withdrawals.idempotency_key` constraint. Its ledger insert uses a separate `wlock_...` idempotency key. The live `onchain_withdrawals_idempotency_key_uidx` unique index also exists.

### Expected impact

On a normal PostgreSQL INSERT, omitting a NOT NULL column with no default raises a not-null violation. Therefore the current live request function is expected to fail at its `onchain_withdrawals` INSERT and roll back the entire function transaction, including the preceding wallet reservation/withdrawals insert. This is a strong catalog-and-body-derived finding; a production withdrawal attempt was not made to confirm it because that would mutate financial state.

This is separate from the already-confirmed missing client idempotency table and RPCs. Even requests without a client idempotency key use `request_withdrawal` and are expected to hit the same missing-column failure.

## Required safe remediation

1. Reconcile exact production migration history and recover the authoritative function/schema migration that introduced `onchain_withdrawals.idempotency_key`.
2. Decide the correct semantic value for the paired `onchain_withdrawals.idempotency_key` (likely a deterministic per-withdrawal internal key), ensuring it is unique and consistent with `withdrawals`/ledger idempotency semantics. Do not blindly set a broad default or reuse a key across rows.
3. Patch the canonical function INSERT explicitly, then validate both table writes, wallet liability reservation, ledger row, and paired state in a schema-faithful disposable database.
4. Add regression tests that compare the production schema contract to the canonical function's INSERT columns and verify missing required columns cannot escape static checks.
5. Reconcile the client idempotency wrapper/replay lookup and test duplicate submissions and lost responses. Do not remove fail-closed behavior.
6. Only after isolated tests and migration provenance are verified, deploy through the approved migration path and re-query function hash/schema/grants. Do not hot-edit production or apply a speculative migration.

## Verification performed

- Read-only production catalog: `onchain_withdrawals.idempotency_key` is NOT NULL, default NULL.
- Read-only production catalog: unique index `onchain_withdrawals_idempotency_key_uidx` exists.
- Read-only live function definition: the canonical request function inserts into `onchain_withdrawals` without supplying the key.
- Previously selected local static regression batch: 22 passed, 0 failed; those tests do not cover this exact live-schema/function mismatch.

## Safety

No production writes or test withdrawals were performed. No SQL applied, commits, pushes, or deployments made. Local existing changes preserved.
