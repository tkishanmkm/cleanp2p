# Step 35F — Database deposit-credit trust-boundary design audit

Date: 2026-10-14
Branch: `fix/retire-unverified-deposit-entrypoints`
Scope: proposal migration `20261001000000_canonical_process_deposit_atomic_part6k7.sql`, prior verifier-isolation and attestation design reports, and the known live production role/extension audit.

## Findings from the RPC implementation

1. `public.process_deposit_atomic(..., p_confirmations, p_provider)` is a `SECURITY DEFINER` financial function. It routes the supplied destination to a user deposit address, validates network/asset/contract formats, applies row locks and idempotency checks, updates balances, writes a ledger entry, and credits when the supplied effective confirmations meet the configured threshold.
2. The function computes:
   `GREATEST(COALESCE(p_confirmations, 0), COALESCE(v_existing_onchain.confirmations, 0))`
   and uses that value to decide credit eligibility. It does not independently fetch a chain receipt/block, validate a UTXO, or verify an independently issued attestation.
3. `p_provider` is recorded as metadata; it is not an authentication or evidence check. A caller can label a request as a trusted worker without proving the origin of the request.
4. The existing HMAC helper is not an adequate boundary if the signing secret is readable by the same ordinary `service_role` credential that can invoke the credit RPC. The previous live audit reported `service_role` access to Vault secret objects. Do not treat Vault by itself as key isolation.
5. The proposal migration has no attestation/evidence parameter or nonce validation. Its atomic ledger and duplicate protections are valuable, but they do not prove that a real on-chain transfer happened.

## Safe design decision

**Do not change or revoke the live credit RPC yet.** A blanket EXECUTE revoke can stop legitimate deposits, while a new HMAC check is ineffective if the caller that can invoke the RPC can also mint valid MACs. The current staging project has no schema/migration baseline and is not yet suitable for validating a replacement financial routine.

Preferred candidate for implementation and testing:

- A separate deposit verifier workload owns the only signing credential; ordinary web routes and the ordinary `service_role` environment must not have it.
- The verifier independently confirms chain-specific canonical evidence, recipient ownership, asset/contract, raw amount, transaction/log or UTXO index, block identity, confirmation threshold, and reorg policy.
- It emits a short-lived, one-use attestation bound to a canonical deposit identity and immutable transaction fields.
- The database credit boundary validates the attestation using a verification key or credential unavailable to ordinary callers, atomically consumes a unique replay key, independently checks deposit-address ownership and network rules, and performs the existing balance/ledger mutation in one transaction.
- The database rejects calls lacking a valid attestation; it must never infer trust from `p_provider` or caller-supplied `p_confirmations` alone.
- Ordinary `service_role` must not be able to mint attestations, read the private signing key, assume the verifier identity, or bypass the attestation boundary. Prove this with negative tests, not only grants inspection.

Before choosing a concrete SQL cryptographic API, validate a maintained signature-verification implementation supported by the actual Supabase PostgreSQL environment. The earlier audit found `pgcrypto` installed, `pgsodium` available but not installed, and no verified database-native isolated verification boundary. Do not invent a `pgsodium` API or install extensions directly in production.

## Required test matrix

- Missing, expired, altered, or incorrectly signed attestation.
- Attestation minted by an ordinary application/service-role credential.
- Replay and concurrent duplicate attestation consumption.
- Wrong user/address, chain, asset, token contract, amount, transaction hash, log/vout index, block hash, or confirmations.
- Pending-to-confirmed transition, reorg, replaced/dropped transaction, provider outage, and chain-specific verifier outage.
- Atomic rollback of balance/ledger/status changes.
- Signing-key rotation and emergency revocation.
- Legacy rows and inconsistent split-table state.
- Regression checks proving that all retired routes stay retired and unsupported chains fail closed.

## Step outcome

- Read-only audit/design decision completed.
- No production SQL, permissions, secrets, migrations, or deployments changed.
- No tests/build run; this connector workflow does not provide a checked-out repository runtime, and staging is currently schema-empty.
- The implementation fix is intentionally blocked pending a schema-faithful staging baseline and an independently isolated verifier credential. This avoids shipping a false security boundary or interrupting deposits without a tested replacement.

## Status

Database credit trust boundary: **unresolved / release blocker**.
Deposits: **not production-ready**.
