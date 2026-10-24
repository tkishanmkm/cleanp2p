# Step 32 — Paused Indexer Response and Database Caller Follow-up

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Fix completed

Updated `src/app/api/cron/indexer/route.ts` so an authenticated cron request no longer returns `success: true`, “Multi-chain indexer executed successfully,” and HTTP 200 while the ingestion job intentionally detects/credits zero deposits. It now reports:
- `success: false`
- `code: DEPOSIT_CREDITING_PAUSED`
- `depositsPaused: true`
- a clear message that indexing/crediting is paused pending independent chain verification
- HTTP 503

Added five source assertions to `tests/deposit-worker-reports-paused.test.ts` for the cron indexer response. The existing test already checks the deposit worker's paused response.

Commits:
- `55c96b90c69e10c355e042d5a4b7d1a39498e614` — accurate paused indexer response
- `0af1161fc5bf7f007cc133fa7be69411b0a5731f` — regression assertions

Tests were not executed in this environment. These are source assertions only until run in CI/local environment.

## Additional read-only database caller inspection

Queried deployed PostgreSQL routine definitions in the Supabase project (catalog only; no financial rows). Found the risky routine definitions previously described in Step 30, including SECURITY DEFINER implementations of:
- `credit_confirmed_deposit`
- `credit_deposit_atomic`
- `credit_onchain_deposit`
- `ingest_and_credit_deposit`
- `process_confirmed_deposit`
- `process_deposit_atomic`
- `process_incoming_deposit`
- several `process_user_deposit` overloads, including one SECURITY INVOKER overload with balance-update logic

A catalog text search for *other database functions* whose stored definitions explicitly mention these RPC names returned no rows. This does **not** prove there are no callers: PostgreSQL function-body text matching misses dynamic SQL, application RPC calls, external schedulers, and indirect paths. No trigger/Edge Function/external scheduler inventory is claimed complete.

## Repository inventory boundary

Enumerated the draft branch Git tree (1,267 entries, not truncated) and identified deposit API routes, jobs, Supabase migrations, and tests. GitHub code-search results for the unsafe RPC names returned no matches, but that endpoint searches the default branch and is not reliable for the draft branch; these empty results are not proof of no caller. A complete content scan of every branch blob and all external schedulers remains outstanding.

## Remaining blocking work

1. Perform a complete local content scan of all source and migration files on the exact draft head, then review trigger definitions, Edge Functions, cron config, and external scheduler configuration.
2. Design and test verifier-owned evidence storage tied to exact chain/network, canonical block, tx hash, output/log index, successful receipt, recipient, asset/contract, and amount.
3. Implement a credit RPC that accepts only a unique evidence ID and consumes it atomically; no caller-supplied confirmations or financial facts.
4. Migrate legitimate callers and only then plan legacy function ACL changes in a reviewed migration.
5. Run the focused tests and the full test/typecheck/lint/build suite.

## Safety

No production SQL, grants, financial rows, secrets/config, merge, or deployment changed. Deposit crediting remains paused in this draft branch. The platform is not yet production-ready.
