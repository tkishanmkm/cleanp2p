# Paxones Production Audit — Withdrawal Idempotency Live Drift (2026-10-26)

## Verified production facts (read-only)

A read-only query against production project `eaiwgfxoiwxepinvcykg` returned:

- `public.request_withdrawal(p_user_id uuid, p_network text, p_to_address text, p_amount numeric, p_fee numeric, p_asset text, p_usd_equivalent numeric)` exists and is SECURITY DEFINER. EXECUTE: service_role only; anon/authenticated denied.
- `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)` exists and is SECURITY DEFINER. EXECUTE: service_role only; anon/authenticated denied. This is the five-argument legacy signature, not the local six-argument hardening candidate.
- `public.request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)` does not exist in production.
- `public.lookup_withdrawal_idempotency_replay(uuid,text,text,text,numeric,text)` does not exist in production.
- `public.withdrawal_idempotency_keys` does not exist in production.
- Production migration ledger has 81 rows.

## Impact

Local `src/lib/services/withdrawalService.ts` first calls `lookup_withdrawal_idempotency_replay` when a request includes an idempotency key. If the function is missing, the service returns `WITHDRAWAL_REPLAY_LOOKUP_UNAVAILABLE` and fails closed before attempting a new withdrawal. If a request reaches the keyed creation branch, it calls the also-missing `request_withdrawal_idempotent` RPC. Therefore keyed withdrawal requests are not currently compatible with the observed production database state and can fail before reserving funds. Do not disable idempotency or silently fall back to the non-idempotent RPC as a workaround; that could permit duplicate financial reservations after ambiguous network failures.

## Local implementation found

- `20261019180000_add_idempotent_withdrawal_wrapper.sql` creates the user-scoped idempotency table and service-role-only wrapper.
- `20261020200000_withdrawal_idempotency_replay_lookup.sql` creates the read-only replay lookup.
- `tests/withdrawal-idempotency-migration.test.ts` asserts static source contracts but explicitly does not replace isolated PostgreSQL replay/concurrency testing.
- Existing production/local migration history is divergent; these migrations must not be applied blindly or out of order.

## Regression tests

Re-ran selected static contracts: **22 passed, 0 failed** across withdrawal idempotency, refund and approval hardening, route safety, deposit ingress/confirmation, and financial write guards. No live mutation tests were run.

## Required next actions

1. Recover/reconcile production migration history and schema dependencies.
2. Build a schema-faithful disposable test database and test concurrent same-key submissions, same-key/different-intent conflicts, lost-response retries, and different users reusing the same key.
3. Validate wrapper behavior with the current production `request_withdrawal` signature and verify table/function privileges plus transaction atomicity.
4. Review all active clients/routes to establish whether the idempotency key is always sent; regardless, fix the database/app contract before launch.
5. Separately compare the live five-argument refund function body and grants to the candidate six-argument implementation before planning any migration.

## Safety

Read-only production catalog queries only. No production SQL was applied; no commits, pushes, deployments, or unrelated working-tree changes were made.
