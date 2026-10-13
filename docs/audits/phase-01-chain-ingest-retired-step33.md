# Step 33 — Internal Chain Ingest Retirement

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Audit finding

A repository-tree review uncovered an additional path not included in the earlier partial caller map: `src/app/api/internal/chain-ingest/route.ts`. Before this step, its POST handler accepted a shared-secret header plus caller-supplied transaction ID, recipient, asset, amount, network, output index, block height, and confirmation count, then called the privileged `process_deposit_atomic` RPC. A shared secret authenticates the submitter; it does not independently prove the chain event or its exact amount and recipient.

## Fix applied on the draft branch

- Replaced the handler with an unconditional HTTP 410 retirement response.
- The response identifies `CHAIN_INGEST_RETIRED`, states deposits are paused, and sets `Cache-Control: no-store`.
- Removed Supabase imports, request-body parsing, secret handling, and all RPC calls from the endpoint.
- Added `tests/chain-ingest-retired.test.ts` with 7 static source assertions.
- Registered `npm run test:chain-ingest-retired` in `package.json`.

## Verification and limits

The code/test changes were committed to the existing draft branch. The test itself has **not** been executed in a local runtime. Typecheck, lint, and build remain unrun.

This does not establish an exhaustive inventory of every repository caller, SQL trigger/function dependency, external scheduler, or deployed environment. Continue scanning all source and database dependencies; do not resume deposit credits until a verifier-owned evidence boundary is implemented and tested.

## Safety

No production SQL, grants, financial rows, configuration, merge, or deployment changed. Deposit crediting remains paused. The draft branch is not production-ready.
