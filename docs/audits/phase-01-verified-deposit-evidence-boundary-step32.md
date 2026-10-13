# Step 32 — Verified Deposit Evidence Boundary Design

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Status: design/audit only; no migration or runtime credit implementation added.

## Goal

Ensure no database balance is credited from a caller's claimed transaction hash, amount, address, asset, network, or confirmation count. A credit must be derived from evidence produced by a trusted chain verifier and consumed once in the same database transaction as the ledger/balance updates.

## Current containment verified in branch

- `src/jobs/depositIngestion.ts` returns zero detected/credited and does not call deposit-credit RPCs.
- `src/app/api/workers/deposit-worker/route.ts` responds with `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, HTTP 503.
- `src/app/api/cron/indexer/route.ts` similarly reports paused status and HTTP 503.
- `tests/deposit-worker-reports-paused.test.ts` contains source assertions for paused responses and absence of the canonical credit RPC call. These assertions have not been executed in this environment.

## Search result limitation

GitHub code search for each known legacy RPC name returned no results, but the connector's code search covers the default branch, not reliably the current draft branch. This cannot establish that callers are absent. The repository tree endpoint was too large to retrieve completely through the current connector response. Therefore this step does not certify a complete caller inventory.

## Required evidence record (design, not deployed schema)

A verifier-controlled record should include, at minimum:

- Stable evidence UUID and unique event identity: chain/network ID + normalized transaction hash + output/log index (or equivalent chain-native event locator).
- Canonical block hash and block height; successful execution status where applicable.
- Exact destination address, sender if relevant, asset identifier and canonical token contract where applicable.
- Exact integer base-unit amount and decimals; avoid floating-point conversion as authority.
- Verifier/version/provider metadata and observed-at timestamp.
- Finality state and enough block ancestry data to detect a reorg; evidence must be invalidatable before credit and credited events must have a compensating/reconciliation strategy if finality assumptions fail.
- State machine with narrowly permitted transitions such as observed -> verified -> consumed, and a separate invalid/reorged state. Only the verifier service role may create or promote evidence; the browser and generic API roles must not write evidence.

## Credit API contract

The future credit RPC should accept only an evidence UUID (and possibly a non-authoritative idempotency request ID). It must not accept caller-supplied user ID, wallet ID, amount, asset, recipient, confirmations, network, transaction hash, or output/log index as credit facts.

Inside one database transaction, it must:
1. Lock the evidence row with `FOR UPDATE`.
2. Reject absent, unverified, consumed, invalidated, or stale evidence.
3. Derive recipient ownership and wallet/asset mapping from stored verified fields and the canonical deposit-address registry; reject ambiguous mappings.
4. Enforce a unique event key at the database layer, using network/chain ID + normalized tx hash + event index. Hash-only idempotency is insufficient across networks and token logs.
5. Insert the deposit and immutable ledger entry, update the wallet balance exactly once, and mark evidence consumed atomically.
6. Return a non-sensitive idempotent result for retries; any mismatch or partial pre-existing state must fail closed and raise an operational alert rather than silently changing event identity.
7. Keep authorization restricted to the verifier/service role, with fixed `search_path`, minimal grants, and no PUBLIC/anon/authenticated execution.

## Chain-specific verifier acceptance tests

- Wrong network/chain ID; wrong recipient; wrong token contract; wrong asset.
- Forged or rounded amount; zero/negative amount; decimal/base-unit conversion boundaries.
- Failed EVM receipt; missing/duplicate log; BTC/LTC wrong output index; TRON wrong contract/event.
- Transaction present but not canonical, insufficient finality, and simulated reorg before/after credit.
- Repeated evidence UUID, same event replay, same tx hash on different chains, and concurrent calls for one event.
- User/wallet substitution, unregistered destination, ambiguous address mapping, and revoked/disabled wallet.
- Verifier credential compromise boundary and attempts by anon/authenticated roles to insert or promote evidence.
- Ledger/balance inconsistency and injected failure at every transaction step.

## Rollout gates

1. Complete a branch-local repository search over all source files and SQL, plus SQL catalog dependency inspection and a separate review of Edge Functions, external schedulers, and deployment configuration.
2. Build verifier adapters and evidence table in an isolated staging project first; never infer production correctness from source assertions alone.
3. Migrate each identified caller to evidence IDs and add integration tests against a disposable database with synthetic test events.
4. Revoke legacy function grants and remove unused overloads only after caller mapping and staging validation are complete.
5. Confirm provider callbacks and user-facing deposit status communicate the paused state accurately; do not silently claim successful indexing.
6. Run focused tests, full test suite, typecheck, lint and build; review migration plan and rollback/reconciliation procedure.
7. Verify deployed function bodies and effective grants after an explicitly approved deployment.

## Scope / safety

No database schema, function, grant, financial row, application runtime, or secret was changed in this step. No merge or deployment occurred. The design is not an implementation and does not make deposits production-ready.
