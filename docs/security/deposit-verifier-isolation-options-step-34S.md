# Step 34S — Deposit verifier isolation options

Status: read-only live role/crypto capability audit. No role, grant, extension, secret, branch, database, or deployment changes.

## Live database observations

- The only public `process_deposit_atomic` signature previously found is SECURITY DEFINER; EXECUTE is false for `anon` and `authenticated`, true for `service_role`.
- Live role catalog includes `service_role` (BYPASSRLS, no login) and `postgres` (CREATEROLE, CREATEDB, BYPASSRLS). These are not evidence of a dedicated verifier identity or isolated signing key.
- `pgcrypto` is installed in schema `extensions`; the catalog search found HMAC functions and Vault encryption helpers, but no general-purpose signature verification function in the searched `pgsodium`, `extensions`, and `vault` schemas.
- `pgsodium` appears in the available extensions list but is not installed. Do not assume its functions, API, or key-isolation properties without separate supported-platform validation.
- No Supabase development branches exist in the project at the time checked.

## Security conclusion

No currently verified database-native trust boundary is available from the evidence gathered. HMAC verification using a secret readable by `service_role` does not protect against compromise of that credential. Adding a custom database role alone is not sufficient if the application can assume it or use the same credential to submit arbitrary attestations.

## Options to evaluate in isolated staging

1. **Dedicated verifier service/credential:** chain-verifier workload has a separate credential that ordinary application routes and jobs cannot access. The DB credit interface must not be callable with the ordinary service-role credential. Demonstrate this with negative privilege tests and secret-access review.
2. **Asymmetric attestation verification:** verifier holds private signing key; database or a strictly isolated credit service verifies with public key. First confirm a supported, maintained signature-verification implementation and test vectors on the actual Supabase platform. Do not assume a missing extension API.
3. **External credit broker:** a narrowly scoped service validates a one-time signed attestation and performs the atomic credit operation through a credential unavailable to the ordinary application. Keep the broker inaccessible to user input and protect its credential independently.

Do not select an option solely because it is easiest to code. Threat-model compromised Next.js/server routes, leaked service-role key, forged provider callbacks, replay, key rotation, outages, and chain reorganizations.

## Preconditions before implementation

- Establish an isolated Supabase staging branch/project and verify no production credentials, provider endpoints, or wallets can be affected.
- Confirm the supported signing/verification mechanism and how the database credit interface is protected from ordinary service-role calls.
- Keep old deposit ingestion paths disabled only with a verified replacement and explicit operational plan; a blanket 410 can leave real deposits uncredited.
- Test valid/invalid attestations, expiry, replay, concurrent duplicate transactions, wrong user/address/network/asset/contract/raw amount, insufficient confirmations, reorg, atomic rollback, and key rotation.
- Run tests and capture evidence before production rollout.

## Result

Step 34S establishes viable architecture candidates, not a completed fix. No staging environment has been created and no candidate has passed integration tests. Deposits remain NOT READY for production.
