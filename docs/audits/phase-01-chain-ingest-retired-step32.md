# Step 32 — Internal Chain Ingest Retirement

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Audit finding

A repository-tree review uncovered an additional live source path not listed in the earlier partial caller map: `src/app/api/internal/chain-ingest/route.ts`. Before this step, its POST handler accepted a shared-secret header plus caller-supplied `txid`, recipient, asset, amount, network, output index, block height, and confirmation count, then called the privileged `process_deposit_atomic` RPC. The secret authenticated the submitter but did not independently prove the submitted chain event. This bypassed the fail-closed public webhook/worker posture.

## Fix applied to the draft branch

- Replaced the handler with an unconditional HTTP 410 retirement response.
- The response identifies `CHAIN_INGEST_RETIRED`, states deposits are paused, and uses `Cache-Control: no-store`.
- Removed all Supabase imports, request-body parsing, secrets, and RPC calls from the endpoint.
- Added `tests/chain-ingest-retired.test.ts` with 7 static source assertions.
- Registered `npm run test:chain-ingest-retired` in `package.json`.

## Verification and limits

The source change and test registration were committed to the existing draft branch. The test itself has **not** been executed because a local dependency/runtime run has not been available in this workflow. Typecheck, lint, and build remain unrun.

This is still not an exhaustive inventory of every caller in the repository or in external schedulers/environments. A follow-up scan must continue across all application files and SQL/trigger/function dependencies, and any further direct caller-supplied credit route must be retired or migrated to verifier-owned evidence before deposits resume.

## Safety

No production SQL, grants, financial rows, configuration, merge, or deployment changed. This fix intentionally keeps deposit crediting paused. The branch/PR is draft and not production-ready.
