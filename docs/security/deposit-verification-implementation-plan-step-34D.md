# Step 34D — Deposit attestation implementation plan

Status: design only. No SQL, grants, secrets, routes, or deployed functions were changed.

## Architecture decision

Use a dedicated trusted chain-verifier service to independently verify a deposit and produce a versioned HMAC-SHA-256 attestation. The database must verify that attestation inside the same transaction that records/credits the deposit. The HMAC key must be available only to the verifier runtime and a tightly scoped database-owned verifier routine; it must not be readable by `anon`, `authenticated`, or `service_role`.

This is a candidate implementation, not approved production code. A final implementation must confirm the database can validate the exact canonical byte representation safely and that the key is not accessible through another function, view, grant, or role-membership path.

## Why not use asymmetric signatures immediately?

The linked database has `pgcrypto`, but the audit has not established a supported, reviewed public-key signature-verification implementation that can be used in PostgreSQL for this exact protocol. Do not invent custom ECDSA/Ed25519 verification or assume `pgcrypto` provides it. If a reviewed extension or external verification boundary is chosen instead, document and test it before deployment.

## Attestation payload

Use a deterministic, versioned payload with explicit UTF-8 encoding and strict field validation. Minimum fields:

- protocol/version and unique nonce/attestation ID
- chain/network identifier and asset symbol
- transaction hash and output/log index
- canonical block number and block hash
- normalized destination address and owning user/address record identity
- token contract or native-asset identifier
- raw integer amount in base units (never a floating-point amount)
- observed chain tip / computed confirmation count and verifier build/version
- issued-at and expiry timestamps

The database must reconstruct the canonical payload from validated input fields and compare the HMAC using constant-time comparison where available. Do not sign arbitrary caller-provided JSON without canonical serialization. Do not accept a caller-supplied provider name or confirmation count as proof.

## Trusted verifier requirements

- Fetch the transaction, receipt/output, block, and current tip from configured chain providers; validate receipt success and canonical block identity.
- Validate network/chain ID, known token contract, destination, output/log index, raw amount, and confirmation depth.
- Verify the destination belongs to the expected user/address record using server-controlled database data.
- Do not issue attestations for unsupported networks, unknown contracts, stale/unconfirmed transactions, malformed fields, or reorged blocks.
- Keep the HMAC key only in the verifier's secret store. Do not put it in Git, SQL migrations, client-visible environment variables, logs, or ordinary API handlers.
- Restrict invocation of the verifier to the internal worker path; an exposed endpoint must not sign caller claims or become a signing oracle.

## Database enforcement requirements

- Modify the existing credit path so no caller can credit a deposit using only a supplied amount, provider string, transaction hash, or confirmation count.
- Validate the HMAC and expiry before writing any credit.
- Atomically enforce uniqueness on network + transaction hash + output/log index (with normalized values) and nonce/attestation ID.
- Verify address ownership, asset/network pairing, contract, exact raw amount, and any existing deposit record consistency in the same transaction.
- Preserve legitimate idempotent retries; reject conflicting replays and identity mismatches.
- Keep direct legacy credit paths disabled only after the replacement verifier and atomic RPC pass staging tests.
- Reassess `service_role` access to Vault. Current audit found SELECT grants on Vault secret objects, so a Vault-backed design is unsafe until those grants and all dependent functions are audited and safely narrowed. Do not revoke live grants as an isolated action.

## Rollout gates

1. Add unit tests for canonical serialization, HMAC valid/invalid cases, expiry, wrong network/destination/asset/contract/amount/index/block, and malformed payloads.
2. Add database integration tests for duplicate concurrency, idempotency, legacy record mismatch, unauthorized roles, replay, and atomic rollback.
3. Test reorg handling and provider disagreement on staging chains.
4. Confirm secrets are configured in the verifier runtime and inaccessible to normal app routes and database API roles.
5. Confirm no existing legitimate deposit path is broken; monitor pending and credited deposit counts before enabling.
6. Only then prepare a separate migration/PR. Do not deploy or enable production crediting without explicit rollout approval.

## Current evidence and limitations

- `pgcrypto` and Supabase Vault are installed.
- `public.process_deposit_atomic` is SECURITY DEFINER; effective EXECUTE checks showed anon=false, authenticated=false, service_role=true.
- Vault table grants include SELECT for service_role; exact dependent routines and role-membership paths still need review.
- Active `exec-sql` Edge Function is version 8, `verify_jwt=true`, and its current code returns HTTP 410 without executing SQL.
- The current Next.js worker uses `SUPABASE_SERVICE_ROLE_KEY` and calls the existing RPC after verification. It does not yet create/submit a cryptographic attestation.
- The repository's fetched `supabase/config.toml` path was not found, and no `.github/workflows` directory was found at the checked path. This does not prove there is no other deployment configuration.

No live SQL or production deployment changes were made by this step.
