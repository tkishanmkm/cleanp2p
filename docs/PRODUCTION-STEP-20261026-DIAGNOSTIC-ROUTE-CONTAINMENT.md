# Paxones Stage 22 — Public diagnostic route containment

Date: 2026-10-26. Scope: local source changes only; no production deployment.

## Confirmed issues

1. `src/app/api/check-db-records/route.ts` previously exposed a GET endpoint without authentication. It embedded a specific user UUID, transaction hash, and deposit address, then returned profile, wallet, deposit, and ledger query results plus environment configuration flags.
2. `src/app/api/verify-deposit-recovery/route.ts` previously exposed a GET endpoint without authentication. It embedded the same customer/deposit identifiers and called `runDepositIngestion()` twice, so an unauthenticated GET could trigger financial ingestion side effects as well as disclose queried records.
3. `src/app/api/admin/adjust-balance/route.ts` directly updates `wallet_assets`, then separately inserts a ledger record. Supabase query errors are returned in `{ error }` rather than normally thrown; the current `try/catch` blocks do not check the returned `error` fields. Thus ledger, transaction, and audit write failures can be swallowed after a balance update. This is a separate unresolved high-risk atomicity issue; it was not changed in this stage because a correct fix requires a verified atomic server-side RPC and reconciled schema contract.
4. `src/lib/security/reconciliation.ts` expects a wallet/asset/delta ledger schema incompatible with the observed production table. It fails closed on the ledger query error, but the reconciliation is not operational against the currently observed schema.

## Local containment changes

- Replaced both diagnostic GET handlers with generic `404 Not found` responses.
- Removed hard-coded user IDs, transaction hash, address, data queries, environment diagnostics, and ingestion side effects from both handlers.
- Added `tests/retired-diagnostic-routes.test.mjs` to prevent reintroducing those unsafe behaviors.

## Verification

`node --test tests/retired-diagnostic-routes.test.mjs`: **1 passed, 0 failed**.

`git diff --check` for the changed route and test files: **exit 0** (only Windows line-ending notices).

## Limitations and next actions

- This is a local-only change. It does not protect production until reviewed, committed, and deployed through the approved release process.
- Any required diagnostic/recovery function should be rebuilt as an authenticated admin-only or service-only POST workflow with explicit authorization, dry-run/preflight mode, idempotency, and audit trail; never revive the public GET behavior.
- Next priority is to replace the non-atomic admin balance adjustment with a server-side atomic RPC after resolving the production-vs-local wallet and ledger schema drift. Do not attempt to fix by simply making ledger inserts throw after the balance has already been changed in a separate request.

No production data or schema was changed; no financial RPC was called; no commit, push, or deployment occurred.
