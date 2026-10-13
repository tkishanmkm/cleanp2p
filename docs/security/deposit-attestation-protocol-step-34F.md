# Step 34F — Candidate attestation protocol helper

Status: proposal-branch code and test cases added; tests have not been executed in a checkout or staging database. No live SQL, grants, secrets, or deployments were changed.

## Files added

- `src/security/depositAttestation.ts` — fixed-field-order, newline-delimited v1 payload canonicalization, HMAC-SHA-256 generation, expiration checks, and timing-safe MAC comparison.
- `tests/deposit-attestation.test.ts` — seven unit-test cases covering valid MAC, modified amount, wrong secret, expiry, future-issued payload, ambiguous newline/decimal amount, short secret, and malformed MAC.

## Critical boundary

This helper is a protocol candidate only. It does not verify blockchain evidence, persist replay nonces, verify database address ownership, or make the database credit function safe. It must not be wired into production deposit crediting until a database routine independently validates the MAC and atomically enforces ownership, replay protection, uniqueness, amount, and chain rules.

The helper's HMAC secret must never be available to ordinary request handlers or the ordinary `service_role` credential. Current live audit evidence shows `service_role` has SELECT grants on Vault secret objects; therefore, do not use Vault as the assumed isolated key boundary without a reviewed grants/dependency redesign. No real secret is included in source; the unit test uses a test-only string.

## Required follow-up before merge

1. Run `npx tsx --test tests/deposit-attestation.test.ts` in a clean checkout with dependencies installed.
2. Review the protocol with the database implementation in mind and ensure TypeScript and SQL produce identical canonical bytes for all supported networks/assets.
3. Add explicit address normalization and chain-specific field validation at the trusted verifier boundary.
4. Implement the secret storage and database validation path in an isolated staging project; test that ordinary service_role cannot read the key or mint MACs.
5. Add nonce/transaction-output uniqueness and concurrency tests against the database.
6. Do not merge, deploy, or enable this helper for real deposit crediting until these checks pass.

## Current status

The source and test files were read back from the proposal branch. Unit tests were not run because this connector workflow did not provide a checked-out repository/test runtime. No claim of passing tests is made. The production deposit-credit RPC remains unchanged and remains a release blocker.
