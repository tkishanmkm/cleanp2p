# Step 34N — Safe replacement deposit-credit boundary design

Status: design only. No production SQL, credentials, keys, balances, or deployments changed.

## Why the current HMAC proposal cannot be integrated as-is

The candidate TypeScript helper can canonicalize fields and generate/verify HMAC-SHA-256, but it does not establish a trusted boundary. Live audit evidence shows the ordinary Supabase `service_role` can read Vault secret views and execute `process_deposit_atomic`. If the same credential can obtain the HMAC secret or call a credit RPC with caller-chosen confirmations, the signature can be forged and the vulnerable credit path remains reachable.

Do not wire `src/security/depositAttestation.ts` into the live worker or add an attestation table that assumes the current `service_role` is trustworthy.

## Requirements for the replacement

1. **Unforgeable verifier evidence:** only a hardened chain verifier may create attestations. The ordinary web/API service credential must not have access to the signing key.
2. **Database-side enforcement:** the final credit operation must reject any call lacking valid verifier evidence, and must derive/validate the credited amount, destination, asset/network, transaction identity, block identity, and confirmation threshold from that evidence rather than trusting standalone arguments.
3. **Replay and concurrency:** preserve the live unique indexes on `deposits`, `onchain_deposits`, and deposit ledger references; consume the attestation/nonce and credit the wallet in the same database transaction.
4. **No bypass path:** old credit RPC overloads, legacy workers, webhooks, and listener routes must not remain callable in ways that bypass verification. Do not revoke the existing worker's execution path until a replacement is deployed and smoke-tested.
5. **Safe key lifecycle:** key rotation, expiry, clock skew, audit logging, incident revocation, and secret access must be tested.
6. **Staging verification:** tests must cover forged/modified attestations, expiry, replay, parallel submissions, wrong user/address/asset/network/amount, insufficient confirmations, reorg/canonical block mismatch, rollback, and successful deposits across each supported chain family.

## Architecture decision gate

Before coding a database migration, determine whether this project can provide a separate, least-privilege database credential for deposit crediting and a cryptographic verification method supported by the deployed PostgreSQL extensions. Do not assume `pgcrypto` offers a general-purpose signature-verification primitive, and do not assume Vault is isolated while `service_role` can read its secret views.

If a suitable asymmetric verification primitive and key isolation cannot be proven, use a separately isolated crediting service/database credential design reviewed against Supabase's role and connection model. A mere Edge Function wrapper that uses the same service-role key is not a trust boundary.

## Current status

- Live normalized transaction identity unique indexes: verified in Step 34M.
- Candidate TypeScript HMAC helper and tests: present on proposal branch, tests not executed.
- Database-side attestation verification: not implemented.
- Trustworthy key isolation: not established.
- Replacement deposit credit path: not implemented or staged.
- Production deposit crediting: remains a release blocker.

## Next step

Audit deployed PostgreSQL capabilities, grants, and existing routines for a verifiable signature approach and a least-privilege execution path. Then implement only in an isolated staging migration, run adversarial database tests, and verify a legitimate pending-to-credited deposit before proposing any production rollout.

No live changes were made in this step.
