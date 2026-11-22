# Paxones Stage 23 — Admin balance adjustment fail-closed interlock

Date: 2026-10-26. Local source change only.

## Change made

Replaced `src/app/api/admin/adjust-balance/route.ts` with a fail-closed interlock. It still runs `verifyServerAdmin(req)` and returns the normal authorization response for unauthorized callers. Authorized callers receive HTTP 503 with code `ADMIN_BALANCE_ADJUSTMENT_UNAVAILABLE` until a schema-verified atomic ledger operation is available.

This deliberately disables manual admin balance changes rather than risk changing the wallet without durable matching ledger/audit records. It removes the old route's independent wallet, ledger, transaction, audit, and notification writes. Admin balance adjustment UI/actions will therefore be unavailable until the operation is safely rebuilt.

## Why

The production `ledger_entries` schema observed in the prior read-only audit does not match the local canonical schema. The old route performed multiple independent writes and did not inspect Supabase result errors for several ledger/audit writes. A database-side transaction is needed; sequential REST calls cannot provide atomic rollback across those requests.

## Verification

- `node --test tests/admin-balance-adjustment-fail-closed.test.mjs tests/retired-diagnostic-routes.test.mjs`: **2 passed, 0 failed**.
- `git diff --check` on the modified route and new test: exit 0 (Windows line-ending notice only).
- Added `tests/admin-balance-adjustment-fail-closed.test.mjs` to prevent accidental re-enabling of the non-atomic route.

## Required follow-up

1. Reconcile production and local `wallet_assets`, `wallets`, `assets`, `ledger_entries`, and `admin_audit_logs` definitions and constraints.
2. Define an idempotent server-side RPC that authorizes the trusted actor, locks the wallet, performs a bounded add/subtract, writes canonical ledger and audit entries in one transaction, and rolls back on any required failure.
3. Test concurrency, insufficient funds, duplicate idempotency keys, invalid assets, unauthorized actors, and rollback in a schema-faithful isolated PostgreSQL database.
4. Only after these pass, restore the endpoint to call the RPC and update the admin UI with the explicit unavailable state.

## Safety

No production SQL was executed, no user balance was changed, and no commit, push, or deployment occurred. This is an intentional local safety interlock and requires review before release.
