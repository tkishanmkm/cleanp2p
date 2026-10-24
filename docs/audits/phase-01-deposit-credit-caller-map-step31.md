# Step 31 — Legacy Deposit Credit Caller Map

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: read-only source inspection of known deposit routes, workers, and historical migrations, paired with Step 30's deployed SQL function definitions. No SQL or application runtime was executed.

## Summary

The active deposit ingestion and webhook paths are fail-closed in this draft branch. Several deployed SECURITY DEFINER functions remain callable by `service_role` and accept caller-supplied facts. Source search did not establish a complete caller inventory: GitHub code search returned no matches for these RPC names, and search is indexed against the default branch rather than reliably against this draft branch. Therefore this is a verified partial map, not proof that all callers have been found.

## Caller map

| Caller / artifact | Current observed behavior | Action / risk |
|---|---|---|
| `src/app/api/webhooks/blockcypher/route.ts` | POST returns 410 `DEPOSIT_VERIFICATION_REQUIRED`; no RPC call. | Disabled on draft branch. Provider migration required before launch. |
| `src/app/api/webhooks/litecoin/route.ts` | POST returns 410 `DEPOSIT_VERIFICATION_REQUIRED`; no RPC call. | Disabled on draft branch. |
| `src/app/api/webhooks/alchemy/route.ts` | POST returns 410 `DEPOSIT_VERIFICATION_REQUIRED`; no RPC call. | Disabled on draft branch. |
| `src/app/api/webhooks/deposit/route.ts` | Previously retired in Step 27; not refetched in this step. | Confirmed from Step 27 audit notes; re-check before final release. |
| `src/app/api/workers/deposit-worker/route.ts` | Authenticated worker calls `runDepositIngestion()`; current job implementation returns zero credits and does not call credit RPCs. Response text still says “via canonical process_deposit_atomic,” which is stale/misleading. | Update message to say deposit crediting is paused; test auth and response behavior. |
| `src/app/api/cron/indexer/route.ts` | Authenticated route calls `runDepositIngestion()`; current job returns zero detected/credited. | No direct RPC in route. Do not treat HTTP 200 as successful indexing; clarify paused status in response. |
| `src/jobs/depositIngestion.ts` | `runDepositIngestion()` returns zero credited, `getMonitoredAddresses()` returns empty sets, pending refresh returns zero; no credit RPC calls. | Fail-closed containment active. |
| `src/app/api/workers/confirmations/route.ts` | Authenticated route calls `runConfirmationsWorker()`. | Job does diagnostics only. |
| `src/app/api/cron/confirmations/route.ts` | Re-exports worker route. | Same auth/diagnostic behavior. |
| `src/jobs/confirmationsWorker.ts` | Reads pending deposit metadata and makes chain-depth/status probes, but never calls a credit RPC. | Diagnostic depth is not exact-event proof. Worker still queries pending rows, but this is not a financial-row query performed for this audit. |
| `src/app/api/workers/deposit-listener/route.ts` | Retired with HTTP 410 in Step 24. | Disabled on draft branch. |
| `src/app/api/verify-deposit-recovery/route.ts` | Retired with HTTP 410 in Step 29. | Removes prior unauthenticated diagnostic/ingestion side effect. |
| `supabase/migrations/20260910000001_add_process_user_deposit_rpc.sql` | Historical migration defines SECURITY DEFINER overload that directly credits wallet assets, inserts deposits/onchain deposits/processed-deposits/ledger, and hardcodes status CONFIRMED with confirmations 12. It grants EXECUTE to authenticated, anon, service_role in that migration. | Dangerous if an environment applies this migration without subsequent hardening. Deployed effective privileges inspected in Step 30 showed anon/authenticated false for the matching overload. |
| `supabase/migrations/20260924000000_canonical_deposit_rpc_v2.sql` | Defines `process_deposit_atomic`, which accepts caller-supplied event fields including confirmations. | Canonical naming/atomicity do not establish trust; do not resume calls until evidence-backed boundary exists. |

## Known risky RPCs still requiring caller inventory

- `public.credit_confirmed_deposit(varchar, integer, varchar, uuid, varchar, numeric)`
- `public.credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer)`
- `public.credit_onchain_deposit(text, text, numeric, text, text)`
- `public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer)`
- `public.process_confirmed_deposit(uuid)`
- `public.process_incoming_deposit(text, text, text, numeric, text, integer)`
- Every `public.process_user_deposit` overload, including SECURITY INVOKER overload
- `public.process_deposit_atomic(...)` as identified in Step 28

## Important uncertainty

The following have not been exhaustively verified in this step:
- All source files on the draft branch, because code search did not return reliable branch-scoped results.
- Dynamic RPC names, wrappers, SQL triggers/functions, Supabase Edge Functions, external schedulers, deployed serverless configuration and alternate environments.
- Whether every legacy function is referenced by a caller outside this repository.
- Test execution, typecheck, lint or production build.

A no-match GitHub search result is not evidence that no caller exists. Before any retirement migration, inspect the complete branch tree and run local repository-wide searches for each RPC name, then inspect database function dependencies and external scheduler/configuration references.

## Recommended remediation sequence (no changes made here)

1. Complete exhaustive caller inventory across repository, migrations, SQL dependencies, Edge Functions and schedulers.
2. Correct the stale deposit-worker success message and ensure all diagnostic endpoints clearly report deposits are paused.
3. Create verifier-owned evidence records that bind chain/network, canonical block, exact transaction output/log index, successful receipt, recipient, asset/contract and exact amount.
4. Design a new credit function that takes only a unique evidence identifier, locks it, verifies unconsumed state and atomically credits from stored verified fields with event-level idempotency.
5. Revoke or replace legacy functions only after every caller has been migrated and the migration is tested against a staging clone.
6. Run focused adversarial tests, full test suite, typecheck, lint and build. Verify actual deployed privileges and definitions afterward.

## Safety status

No production SQL, grants, financial rows, config, merge or deployment changed. Automated deposits remain paused in this draft branch. Do not claim production readiness.
