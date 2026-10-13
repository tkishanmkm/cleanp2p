# Step 34B — Deposit verification boundary proposal

Status: design-only. No database permissions or production services changed.

## Current finding

`public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)` accepts caller-supplied confirmation counts and uses them when deciding whether to credit. EXECUTE is intended to be service-role-only, but a service-role key is a powerful bearer credential and is not itself proof that blockchain verification occurred.

The three legacy HTTP entry points are retired on this proposal branch, and legacy scanner credit calls are blocked in the deposit-worker proposal branch. These changes are not deployed.

## Required architecture

1. **Independent verifier**: A server-side component obtains the transaction, receipt/output, canonical block, and chain tip from configured trusted RPC providers. It validates network identity, successful execution, destination ownership, asset/contract, exact base-unit amount, transaction/output/log index, and confirmation depth.
2. **Signed attestation**: The verifier produces a versioned canonical payload containing chain/network, transaction hash, event/output index, block number/hash, destination, asset/contract, exact raw amount, verifier version, issued-at and expiry. Sign with a dedicated secret unavailable to ordinary request handlers and database clients. Do not use a caller-provided provider string as proof.
3. **Database validation**: A narrowly scoped SECURITY DEFINER function validates the signature using a secret available only to the function owner, rejects expired or malformed attestations, checks the address-to-user mapping and network/asset rules, and records the attestation identity atomically with the credit ledger entry.
4. **Replay protection**: Enforce a unique key over normalized network + transaction hash + output/log index, and a unique attestation nonce/id. Repeated submissions must return the original idempotent result without a second credit.
5. **Least privilege**: No client role can execute the attestation/credit function. The regular service-role key must not be sufficient to mint a valid attestation. Keep secret-reading tables/functions inaccessible to API roles.
6. **Reorganizations**: Require canonical block-hash checks and define a risk policy for post-credit reorgs; do not silently rewrite credited deposits.
7. **Observability**: Record verifier version, RPC sources, verification timestamps, rejection reason, and correlation ID without logging secrets.

## Required tests before restoring deposit processing

- Invalid/missing signature and malformed payload are rejected.
- Confirmation count cannot be raised by request input.
- Wrong chain, destination, owner, asset, contract, amount, block hash, and output/log index are rejected.
- Replayed attestation cannot credit twice.
- Expired attestation and unsupported network are rejected.
- Reorg or inconsistent RPC providers fail closed.
- Simultaneous duplicate submissions create exactly one ledger credit.
- RLS and grants prevent anon/authenticated access and prevent the ordinary service-role caller from forging verifier attestations.
- Full integration test confirms balances, deposits, onchain_deposits, and ledger_entries remain consistent.

## Migration policy

Do not apply a blanket REVOKE of service_role EXECUTE as a final fix: it would disable all deposit crediting, including a future verified worker, and could leave funds pending indefinitely. The correct migration should atomically install the attestation contract and grant execution only to the validated trusted path. Until then, deploy the endpoint retirement only with an explicit operational decision and monitoring plan.

## Open implementation dependency

Select the concrete signing arrangement and secret storage after verifying the project's enabled Supabase Vault/pgcrypto capabilities and the actual deployment runtime. Do not hardcode signing secrets in migrations or source control.
