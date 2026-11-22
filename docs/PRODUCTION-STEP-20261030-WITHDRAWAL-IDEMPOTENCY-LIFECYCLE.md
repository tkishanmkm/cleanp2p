# Paxones Production Audit — Withdrawal Idempotency Lifecycle (2026-10-30)

## Scope
Static inspection of the canonical withdrawal service and local SQL migration candidates. This does not prove deployed database state or PostgreSQL concurrency behavior.

## Confirmed from source
- The service performs `lookup_withdrawal_idempotency_replay` before later mutable checks, allowing a valid retry to be recognized early.
- The application submits new reservations through `request_withdrawal_idempotent`; no direct `supabaseAdmin.rpc('request_withdrawal', ...)` call was found in the inspected service.
- The wrapper validates the key format, locks the user's profile row, looks up the `(user_id, idempotency_key)` record, rejects a reused key with a different request fingerprint, and calls the canonical `request_withdrawal` function before inserting the saved response.
- The replay lookup and reservation wrapper use the same intent fingerprint components: normalized network, trimmed destination, amount, and normalized asset.
- The on-chain insert repair migration is fail-closed: it checks the expected function signature, the required NOT NULL idempotency column, and the expected function body shape before executing a patched definition.

## Tests
- `tests/withdrawal-idempotency-lifecycle-audit.test.mjs`: 6 passed, 0 failed.
- Related migration, on-chain insert-contract, and RPC call-graph tests: 7 passed, 0 failed.
- `git diff --check` for the new test: passed.

## Risks not cleared
- Static checks cannot prove same-key concurrent requests serialize correctly in the actual deployed schema, nor that rollback covers both reservation and idempotency-record insertion under all failure cases.
- The app and SQL depend on the live database having the expected idempotency table, unique key, RPC definitions, grants, and `onchain_withdrawals.idempotency_key` contract.
- Supabase credentials/DB URL are not configured in the local environment; no live catalog verification was performed.
- No schema-matched disposable PostgreSQL migration replay or concurrency test has been run.

## Safety
No production database query or mutation, migration application, real withdrawal, commit, push, deployment, or GitHub Actions minutes used. Existing working-tree changes preserved.

**Status: Source-level idempotency contract audit passed; production verification remains blocked on database catalog and isolated concurrency tests.**