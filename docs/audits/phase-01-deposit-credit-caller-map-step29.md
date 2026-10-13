# Step 29 — Deposit Credit Caller Mapping and Public Diagnostic Exposure

Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Supabase project: eaiwgfxoiwxepinvcykg

## Result
Caller mapping is improved but incomplete. Deposits are not production-ready. The direct webhook routes, legacy listener, generic wallet deposit endpoint, ingestion job, and confirmation worker are retired or fail-closed in this draft. One additional unauthenticated diagnostic endpoint was found and retired.

## Critical finding fixed in draft
Before this step, src/app/api/verify-deposit-recovery/route.ts exposed an unauthenticated GET endpoint that ran deposit ingestion, queried deposits/on-chain deposits, wallets, wallet assets, and ledger entries through an admin client, and returned the records. It hard-coded a user UUID, transaction hash, destination and token contract. It is now HTTP 410 with Cache-Control: no-store. This was both a financial-metadata exposure and an ingestion side effect. Added tests/deposit-recovery-diagnostic-retired.test.ts and npm script test:deposit-recovery-diagnostic-retired. Tests have not been run.

## Reviewed application caller map

| Path | Current draft status | Notes |
|---|---|---|
| src/app/api/webhooks/blockcypher/route.ts | Retired, 410 | No direct credit RPC |
| src/app/api/webhooks/litecoin/route.ts | Retired, 410 | No direct credit RPC |
| src/app/api/webhooks/alchemy/route.ts | Retired, 410 | No direct credit RPC |
| src/app/api/webhooks/deposit/route.ts and webhooks/deposits alias | Retired, 410 | Alias re-exports retired route |
| src/app/api/wallet/deposit/route.ts | Retired, 410 | Caller-supplied deposit endpoint disabled |
| src/app/api/workers/deposit-listener/route.ts | Retired, 410 | Legacy listener disabled |
| src/jobs/depositIngestion.ts | Fail-closed | No active polling or credits |
| src/jobs/confirmationsWorker.ts | Fail-closed | No credit RPC call |
| src/app/api/workers/deposit-worker/route.ts | Authenticated wrapper | Calls fail-closed ingestion |
| src/app/api/cron/indexer/route.ts | Authenticated wrapper | Calls fail-closed ingestion |
| src/app/api/workers/confirmations/route.ts | Authenticated wrapper | Calls fail-closed worker |
| src/app/api/verify-deposit-recovery/route.ts | Newly retired, 410 | Previously returned admin-client financial metadata |

This is not a complete inventory of every dynamic RPC call, trigger, deployed Edge Function, external scheduler, or every environment.

## Database and migration findings

1. The inspected deployed catalog shows deposit-credit functions executable by service_role, but not anon, authenticated, or PUBLIC. This is a useful direct API restriction, not a complete trust boundary: vulnerable server routes or compromised service-role credentials can still invoke the functions.
2. Migration 20260910000001_add_process_user_deposit_rpc.sql creates a SECURITY DEFINER overload accepting user, address, asset, chain, amount and transaction hash, and grants it to authenticated, anon and service_role. Its body credits balances and creates deposit/ledger records from those supplied fields without independent chain proof. A later hardening migration revokes execution on the corresponding overload. The deployed effective privileges currently show no anon/authenticated execution, but the earlier migration remains unsafe for environments that do not apply later hardening.
3. The canonical deposit migration revokes execute from PUBLIC, anon and authenticated and grants service_role/postgres. The function still trusts caller-supplied confirmation counts and transaction facts.
4. Other SECURITY DEFINER credit functions and process_user_deposit overloads remain to be reviewed function-by-function and caller-by-caller.

## Remaining work
1. Inventory every live function overload, exact ACL, source caller, trigger, scheduled job, Edge Function and deployment environment.
2. Audit the bodies of credit_deposit_atomic, credit_onchain_deposit, ingest_and_credit_deposit, process_confirmed_deposit, process_incoming_deposit, credit_confirmed_deposit and every process_user_deposit overload.
3. Require a verifier-created evidence record bound to network, tx hash, output/log index, canonical block, recipient, asset/contract, integer base-unit amount and confirmation/finality evidence. Credit must consume and validate it atomically; supplied confirmation counts must not authorize credit.
4. Retire unsafe legacy functions only after caller mapping. Add isolated staging tests for forged evidence, replay, reorg and concurrency.
5. Run source tests, typecheck, lint, build and staging tests.

## Safety
No production SQL, grants, configuration, financial rows, merge or deployment changed. Tests/typecheck/lint/build have not run.
