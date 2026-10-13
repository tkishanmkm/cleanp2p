# Step 34E — Pre-implementation audit and test gate

Status: audit and test planning only. No live SQL, grants, secrets, or deployments were changed.

## Exact database permission evidence

The live `information_schema.routine_privileges` query for `public.process_deposit_atomic` returned explicit EXECUTE rows for:
- `postgres`
- `service_role`
- `supabase_auth_admin`

A prior effective privilege check reported `anon=false`, `authenticated=false`, and `service_role=true`. Do not blanket-revoke the service-role grant before a replacement credit path exists and passes staging tests.

The first dependency query attempted to find view/rule dependencies and returned no rows. That is not a complete function dependency inventory: PL/pgSQL body references are not necessarily represented by `pg_depend` in a way that query can enumerate. The function body and every caller still require explicit review.

## Source evidence on the proposal branch

- `src/jobs/depositIngestion.ts` blob SHA: `ec062310c6f0dbaef1f73b78d2f704e6ec4061db`.
- Eight legacy scanner credit call sites use `rejectUnverifiedScannerCredit`, which returns a controlled error instead of invoking the credit RPC.
- The pending-confirmation worker still invokes `process_deposit_atomic` with `p_confirmations` and `p_provider='confirmations_worker'`. Its chain checks are stronger than the legacy paths, but the database still cannot distinguish an independently verified result from a caller-provided value.
- The worker requires `SUPABASE_SERVICE_ROLE_KEY`. A service-role credential is a database privilege, not cryptographic evidence that a deposit was verified.
- The repository's existing `tests/security-verification.test.ts` is an environment-dependent penetration script for withdrawal routes, not a unit/integration suite for deposit attestations. `tsconfig.json` excludes tests from the regular TypeScript include list.

## Current operational risk

The fail-closed scanner stubs intentionally stop the eight legacy paths from crediting deposits until they have canonical verification. This may leave newly detected deposits pending/uncredited. The legacy API routes on this proposal branch also return HTTP 410. These changes are not merged or deployed; do not merge/deploy without a verified replacement and a reviewed customer-deposit recovery plan.

## Test plan required before changing the credit RPC

### Verifier unit tests
- Valid attestation accepted; invalid HMAC/signature rejected.
- Payload canonicalization stable across equivalent input representations.
- Reject missing/extra malformed fields, wrong protocol version, invalid raw amount, negative/zero amount, and noncanonical address/tx hash.
- Reject expired/future-issued attestations and unknown verifier version.
- Reject wrong chain/network, asset, contract, destination, owner/address identity, tx hash, block hash/number, output/log index, or confirmation threshold.
- Ensure secrets never appear in logs/errors and are not exposed to normal app routes.

### Database integration tests (isolated staging project)
- Ordinary `service_role` cannot mint arbitrary verified attestations or bypass validation.
- `anon` and `authenticated` cannot call the credit RPC.
- A valid trusted attestation credits exactly once and is idempotent on retry.
- Same transaction output/log index replay is rejected, including two concurrent requests.
- Reuse of nonce/attestation ID is rejected.
- Conflicting existing `deposits`, `onchain_deposits`, or ledger rows fail closed without partial writes.
- Invalid attestation leaves wallet balance, ledger, and deposit state unchanged.
- Reorged/noncanonical block is rejected according to an explicit reorg policy.
- Key rotation/expiry behavior works without losing already accepted records.

## Implementation decision

Do not add a placeholder attestation table or modify the RPC yet. The exact cryptographic verification mechanism and trusted key boundary must be validated first. The audit found `pgcrypto` installed, but did not establish a reviewed public-key verification implementation for the desired protocol. Supabase Vault exists, but `service_role` has SELECT grants on Vault secret objects, so a Vault HMAC key is not isolated from that credential without a wider grants/dependency redesign.

Next safe step: select and prove the cryptographic protocol in an isolated staging environment, then implement the verifier and database enforcement together. No production changes were made in this step.
