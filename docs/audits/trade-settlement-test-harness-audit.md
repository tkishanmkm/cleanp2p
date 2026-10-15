# Trade settlement test-harness audit (2026-10-15)

## Scope

Read-only review of the test scripts on branch `fix/ads-fail-closed-owner-check` and comparison with the inspected live Supabase schema. No tests were executed because the integration test is mutating and no isolated staging project was verified.

## Findings

### P0 — Existing P2P integration test targets a different wallet schema

File: `tests/p2p-trade-flow.test.ts`

The setup upserts `wallet_assets` with fields such as `wallet_id`, `asset_code`, `available`, `locked_escrow`, and `locked_withdrawal`. The inspected live `public.wallet_assets` schema instead has `user_id`, `asset_symbol`, `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, and `in_withdrawal`. The test's wallet-assets setup is therefore not compatible with the live legacy schema and cannot be treated as validation of the legacy escrow RPC.

The test does correctly fail closed unless `P2P_TEST_SUPABASE_URL`, `P2P_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `P2P_TEST_ALLOW_MUTATIONS=true` are explicitly supplied. Preserve that guard.

### P0 — Security verification script has unsafe target defaults

File: `tests/security-verification.test.ts`

The script defaults its Supabase URL/key to `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and defaults the app target to `http://localhost:3000`. This makes it possible to run a security test against an unintended database or a live app if environment variables are populated. Its initial withdrawal-count baseline is read from the selected database. Before running it, require explicit test-only target variables and a dedicated test project, and verify no production URL/key can be selected.

### P1 — Current test scripts do not validate the new fee-accounting migration

The current `test:p2p` script covers a different wallet schema, and no fee-migration-specific test command is declared in `package.json`. The staging checklist therefore remains a manual test plan, not an executable or passed test suite.

## Required follow-up

1. Add a dedicated legacy-schema fee-accounting integration test suite with explicit staging-only environment variables and a fail-closed guard.
2. Validate the staging project identity before any mutation; do not infer safety from the presence of a URL.
3. Cover successful fee posting, zero/negative fees, idempotent retry, mismatched/missing fee rows, invalid UUID participants, concurrency, rollback, and authorization.
4. Run only against a disposable staging clone; capture test output and the deployed function definition.
5. Separately harden `tests/security-verification.test.ts` to require an explicit test URL and refuse known production targets before running any attack requests.

## Status

- Repository inspection: complete.
- Live schema comparison: sufficient to identify the wallet column mismatch.
- Test execution: not performed.
- Migration applied to staging/production: not verified / not performed by this audit.
- Production readiness: not established.
