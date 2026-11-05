# Paxones Stage 24 — Admin balance RPC contract and schema blockers

Date: 2026-10-26. Read-only production schema inspection plus local design work. No database writes.

## Production contracts observed

The live Supabase table metadata was inspected for `wallet_assets`, `wallets`, `assets`, `ledger_entries`, `wallet_transactions`, `admin_audit_logs`, and `profiles`.

- `wallet_assets` uses `id`, `user_id`, `asset_symbol`, `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, and `in_withdrawal`. The table metadata does not show a unique constraint on `(user_id, asset_symbol)`. The balance and some lock columns are nullable. This means a safe RPC must explicitly detect duplicate matching asset rows and reject rather than arbitrarily update one; an atomic unique constraint decision requires duplicate-data preflight first.
- `ledger_entries.type` has a check constraint allowing only `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`. There is no accepted `admin_add` or `admin_subtract` type. The old route's `admin_add` / `admin_subtract` values are incompatible with this constraint.
- `wallet_transactions.tx_type` allows only `DEPOSIT`, `WITHDRAWAL`, `ESCROW_LOCK`, and `ESCROW_RELEASE`; `status` allows only `PENDING`, `CONFIRMED`, and `FAILED`. The old route's `credit` / `debit` transaction types are incompatible with the observed constraint. The table requires `wallet_id` referencing `public.user_wallets`, which is not the same table as the `public.wallets` used by `wallet_assets`-adjacent withdrawal logic.
- `admin_audit_logs` has `admin_id`, `admin_email`, `action`, `target_id`, `target_user_id`, and `details`, with an FK from `admin_id` to `profiles.id`. This supports an audit row, but does not solve atomicity by itself.
- `profiles` includes `role`, `is_admin`, and `is_admin_account`, but the RPC must not trust a caller-supplied admin UUID. It must derive the actor from `auth.uid()` for authenticated invocations or use service-role execution restricted to trusted backend code.

## Design decision

Do **not** create or deploy the RPC yet. The live schema contains multiple overlapping wallet models (`wallet_assets`, `wallets`, `user_wallets`, and `wallet_balances`) and incompatible transaction/ledger constraints. A speculative RPC could adjust a different balance than the one the UI or financial settlement system treats as authoritative.

## Atomic RPC acceptance contract

Before implementation, owners must explicitly designate the authoritative balance model. Then the RPC should:

1. Accept target user UUID, normalized asset symbol, `add`/`subtract`, positive numeric amount, a mandatory reason, and a client-generated idempotency key.
2. Determine the actor from the authenticated JWT (`auth.uid()`) and validate admin status from the authoritative admin policy; a service-role bypass is only allowed for trusted backend execution, never caller-supplied identity.
3. Lock the target profile and authoritative balance row in a documented global lock order.
4. Reject missing or duplicate target asset rows; do not silently create a wallet/asset until the provisioning contract and foreign keys are resolved.
5. Use database-side arithmetic, reject insufficient available balance and invalid/disabled assets, and enforce an explicit maximum adjustment policy.
6. Write the balance mutation, a compatible durable ledger entry, the audit event, and an idempotency result in the same PostgreSQL transaction. Any required write failure must raise and roll back all changes.
7. Return the stored result for a repeated identical idempotency key; reject reuse with a different payload fingerprint.
8. Be executable only by the intended trusted role(s), with `PUBLIC` and `anon` explicitly revoked. Validate whether `authenticated` execution is appropriate only after checking the database-side admin gate.

## Required preflight and tests

- Inventory actual duplicate rows for `(user_id, asset_symbol)` without exposing customer data in logs; decide a remediation plan before adding uniqueness.
- Identify whether the UI, deposits, withdrawals, escrow, and reconciliation treat `wallet_assets.balance`, `wallets.available_balance`, `user_wallets`, or `wallet_balances` as authoritative.
- Resolve a ledger event representation allowed by the live constraints without weakening constraints blindly.
- Test concurrent additions/subtractions, insufficient balance, duplicate idempotency keys, mismatched payload reuse, missing/duplicate asset rows, disabled assets, unauthorized users, audit insert failure rollback, ledger insert failure rollback, and retry after ambiguous client timeout in a disposable schema-faithful PostgreSQL database.
- Verify app types, routes, UI error handling, and all affected financial RPCs against the final contract before re-enabling the route.

## Current containment

The local API route `src/app/api/admin/adjust-balance/route.ts` now verifies admin authorization and returns HTTP 503 with `ADMIN_BALANCE_ADJUSTMENT_UNAVAILABLE` without performing financial writes. This intentionally keeps the dangerous multi-request write sequence disabled until a real atomic RPC is proven.

## Verification and release status

The local tests `tests/admin-balance-adjustment-fail-closed.test.mjs` and `tests/retired-diagnostic-routes.test.mjs` passed together (2 passed, 0 failed). No production data or schema was changed. No migration was applied, no financial RPC was invoked, and no commit, push, or deployment occurred.
