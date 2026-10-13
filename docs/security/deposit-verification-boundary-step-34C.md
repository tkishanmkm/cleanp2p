# Step 34C — Runtime and privilege audit

Status: audit-only; no live SQL, grants, secrets, or deployments were changed.

## Verified in the linked Supabase project

- `pgcrypto` is installed in schema `extensions`.
- Supabase Vault is installed; `vault.secrets` and `vault.decrypted_secrets` exist.
- `public.process_deposit_atomic` is SECURITY DEFINER.
- Effective EXECUTE checks currently report: anon=false, authenticated=false, service_role=true for `process_deposit_atomic`.
- `service_role` has SELECT privileges on both `vault.secrets` and `vault.decrypted_secrets` according to `information_schema.role_table_grants`.
- No repository matches were found for direct references to `vault.secrets` or `vault.decrypted_secrets` in the searched default-branch code.

## Security consequence

Vault and pgcrypto are present, but the current grants mean a signing key placed in Vault must NOT be assumed isolated from the ordinary Supabase service-role credential. The ordinary service role can execute the current deposit-credit RPC and appears to have SELECT access to Vault secret objects. A design that merely stores an HMAC key in Vault and lets service-role code call the credit RPC would not establish the required separation if the same service-role credential can read the key.

## Safe implementation options to evaluate

1. Use a dedicated verifier identity/credential that can mint attestations but is not available to normal API handlers; ensure the database can validate the attestation without exposing its signing key to the service-role role.
2. Alternatively, move the verification-and-credit boundary behind a separate narrowly privileged database role/connection or trusted service that cannot be impersonated with the regular service-role key.
3. Before using Vault for this purpose, review the existing `service_role` grants on Vault objects and every dependency. Revoke only after a dependency audit and staged validation; do not change live grants as part of this audit.
4. Prefer an asymmetric signature model where the verifier holds the private signing key and the database validates with a public key, if the available PostgreSQL crypto support and canonical payload encoding can be safely tested. This avoids storing the private signing key in the database. Do not implement an unreviewed custom signature scheme.
5. Do not grant the general service role the ability to insert arbitrary “verified” attestations. A database table plus RLS alone is not a trust boundary against a role with bypass-RLS or broad table privileges.

## Implementation gate

Before writing a crediting migration, establish a tested signing format, key ownership/rotation process, verifier deployment secrets, canonical serialization, and atomic nonce/transaction uniqueness constraints. Test with the actual Supabase role grants and a real staging deployment. The current function's confirmation argument remains caller-influenced; no fix has been applied.

## Current status

No production data, permissions, secrets, or functions were modified. This document is a proposal artifact only. The endpoint-retirement proposal remains unmerged and undeployed.
