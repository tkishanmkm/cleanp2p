# Step 34Q — Deposit-credit isolation decision

Status: read-only architecture decision; report committed to the proposal branch. No production SQL, grants, secrets, balances, project branches, or deployments changed.

## Live RPC permission check

A live read-only query returned exactly one public routine named `process_deposit_atomic`:

- Signature: `public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`
- `SECURITY DEFINER`: true
- EXECUTE for `anon`: false
- EXECUTE for `authenticated`: false
- EXECUTE for `service_role`: true

This means normal anon/authenticated roles cannot call it directly, but any compromised workload holding the service-role credential can call the routine with a forged `p_confirmations` value. The database routine itself still derives confirmation status from the supplied integer and does not independently verify a signed attestation.

## Environment and staging readiness

- Supabase project is active on PostgreSQL 17.6.
- No Supabase development branches currently exist.
- `pgcrypto` and `supabase_vault` are installed; `pgsodium` is available but not installed.
- The live migration history contains wallet hardening and RPC restriction migrations but does not prove the deposit-credit replacement is installed.
- Live deposit-related tables were previously observed empty. Confirm whether this is an expected staging/test project before any live deposit enablement.

A separate Supabase branch/project could provide an isolation environment, but none was created in this step. Creating one may incur cost and should be a separately approved operation. A branch should not be treated as staging unless its schema, secrets, provider endpoints, and test wallets are safely isolated from production.

## Decision

Do not attempt to solve this by simply revoking `service_role` EXECUTE: the legitimate pending-confirmation worker currently uses that credential, and revocation could stop deposits without replacing the path. Do not add an HMAC key to Vault under the current access model, and do not wrap the RPC in an Edge Function that uses the same service-role credential.

The replacement must satisfy all of these before production:
1. Ordinary application/service-role credentials cannot forge or submit credit attestations.
2. A separate verifier/crediting identity validates chain inclusion, canonical block/reorg status, token contract or native asset, destination ownership, raw amount, output/log index, and required confirmations.
3. Database credit is atomic with replay/nonce consumption, ledger insert, and canonical transaction identity constraints.
4. Old callable paths cannot bypass the replacement, but legitimate pending deposits retain a tested migration path.
5. Adversarial tests cover forged confirmations, invalid signature, expiry, replay, parallel duplicate submissions, wrong owner/address/asset/network/amount, reorg, rollback, and valid deposits for each supported chain.
6. Staging tests and deployment rollback procedures pass before production rollout.

## Next step

Build a staging-only proof of concept for an isolated verifier identity and database-enforced credit operation. First establish a safe test environment; do not apply a production migration or alter live grants while no replacement is tested.
