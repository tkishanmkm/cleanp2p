# Paxones Stage 25 — Ledger reconciliation safety containment

Date: 2026-10-26. Local source change only.

## Finding

The wallet balance API explicitly treats `wallet_assets` as its primary source and falls back through `balances`, `user_balances`, `user_wallets`, and profile fields. Other code also treats `wallet_assets` as the spendable source, while the nightly reconciliation route iterates `user_wallets` and compares its balance against a partial event sum of deposits, withdrawals, and transfers. The formula omits or may misclassify other movements (including escrow, fees, reversals, and migration-era events) and the route automatically freezes a wallet when it sees a discrepancy.

Given the already-confirmed overlapping wallet models and production/local schema drift, this discrepancy is not sufficient proof of a financial inconsistency. Automatic freezing on that basis could restrict legitimate users.

## Change made

Replaced `src/app/api/cron/reconcile-ledger/route.ts` with a fail-closed interlock:

- Keeps timing-safe CRON_SECRET / WORKER_SECRET authorization (development fallback remains development-only).
- Authenticated POST and GET requests return HTTP 503 with `LEDGER_RECONCILIATION_UNAVAILABLE`.
- No wallet balances are read or changed, no wallets are frozen, and no audit writes are attempted by this endpoint.
- GET no longer delegates to a financial reconciliation side-effect routine.

This temporarily disables automated reconciliation. It does not replace it with a validated reconciliation system.

## Verification

Added `tests/ledger-reconciliation-fail-closed.test.mjs` to assert the route remains disabled and contains no auto-freeze writes. Run together with existing focused safety tests before release.

## Required follow-up

1. Establish one authoritative balance source for each supported asset and map every balance-changing operation to it.
2. Build an event-complete accounting equation from durable ledger entries, including deposits, withdrawals, P2P escrow locks/releases/refunds, fees, transfers, reversals, and admin adjustments.
3. Make reconciliation read-only first; report discrepancies without freezing or mutating accounts.
4. Test against a schema-faithful disposable database and representative synthetic transaction histories, including retries and partial failures.
5. Introduce an explicit, reviewed policy for freezes, with thresholds, audit, idempotency, and manual override; do not freeze solely from an incomplete event sum.

## Safety

No production SQL was executed, no wallet or account was changed, and no commit, push, or deployment occurred. This local change means cron reconciliation now returns 503 until a correct replacement is verified.
