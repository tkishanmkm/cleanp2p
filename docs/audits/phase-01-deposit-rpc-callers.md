# Step 21 — Deposit RPC caller and execution-boundary audit

Repository: `tkishanmkm/cleanp2p`
Reviewed branch: `fix/phase-01-fail-closed-deposit-webhooks`
Production project: `eaiwgfxoiwxepinvcykg`

## Summary
The application has multiple code paths invoking `process_deposit_atomic`, including provider webhooks, scheduled/worker ingestion, a pending-confirmations worker, and a legacy deposit listener. This makes it unsafe to fix only one route or rely on webhook authentication as the sole boundary.

## Caller inventory from source review

| Caller | Observed behavior | Risk / required check |
|---|---|---|
| `src/app/api/webhooks/alchemy/route.ts` | Calls the RPC with `p_confirmations: 0` | Safer than trusting webhook depth, but the RPC still receives unverified destination/amount/event details and must not credit from caller-supplied facts. |
| `src/app/api/webhooks/blockcypher/route.ts` | Passes provider-reported confirmations (clamped to nonnegative integer) | Provider confirmation count is not independent proof. Must enqueue/record a candidate or invoke a trusted verifier, not authorize credit. |
| `src/app/api/webhooks/litecoin/route.ts` | Passes provider-reported confirmations and stores the same count | Same trust issue; threshold and event must be verified independently. |
| `src/jobs/depositIngestion.ts` | Multiple EVM/TRON/BTC/LTC scan paths call the RPC; BTC path uses hardcoded 2 for provider-confirmed transactions; earlier source review found LTC uses 6 | Every chain path must verify exact transaction/output/event and actual depth. Align LTC to 12 independently verified confirmations. |
| `src/jobs/confirmationsWorker.ts` | Rechecks pending deposits and calls the RPC with a current confirmation value | Must revalidate exact destination, amount, asset/contract, output/log index and canonical inclusion, including reorgs. |
| `src/app/api/workers/deposit-listener/route.ts` | Legacy worker calls RPC with hardcoded `p_confirmations: 12` | High risk: a constant is not proof of 12 confirmations. Trace authentication, scheduling, and whether this legacy route is still reachable before disabling it. |
| `src/app/api/workers/deposit-worker/route.ts` | Authenticated wrapper triggers ingestion worker | Verify worker auth secret handling, endpoint exposure and scheduler callers. |
| `src/app/api/workers/confirmations/route.ts` / `src/app/api/cron/confirmations/route.ts` | Authenticated wrapper and cron alias for pending confirmation worker | Verify all aliases use the same strong worker authentication and avoid duplicate scheduling. |

## Execution grants — not verified
A read-only query to inspect the deployed function ACL was attempted through the Supabase connector, but its safety checks blocked the query. Therefore I cannot state whether `anon`, `authenticated`, `service_role`, or `PUBLIC` can execute the function. This is an explicit unresolved item, not a presumed finding.

Before changing permissions, inspect the exact deployed routine ACL in Supabase SQL Editor using a catalog-only query, or use the function's dashboard privileges. Do not revoke grants blindly: workers using the service-role client may require execution while browser/client roles should not be able to call a privileged deposit-credit RPC directly.

## Required remediation sequence
1. Verify the exact production EXECUTE ACL and enumerate all callers using catalog-only/dashboard inspection.
2. Mark the legacy deposit listener as potentially reachable until its callers and schedule are confirmed; do not remove it based on a name alone.
3. Replace the RPC contract with a trusted server-side verification record/reference and strict idempotency on network + transaction hash + output/log index.
4. Make webhooks enqueue candidates only. Webhook HMAC/shared-secret authentication authenticates the sender, not the on-chain event or confirmation depth.
5. Unify scanners and confirmation workers around one verifier per chain, with exact event/output checks and reorg handling.
6. Test all callers and denial cases in isolated staging; run tests, typecheck, lint and build before release.

## Safety
No production SQL changes, grants changes, staging writes, financial-row queries, merge or deployment were performed. This is a repository source-level caller map plus an attempted, blocked ACL inspection. Deposits are not production-ready until the grant boundary and independent verification are fixed and tested.
