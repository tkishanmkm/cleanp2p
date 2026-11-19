# WAYONES Wallet Audit — Step 06
**Title:** Production wallet provisioning integration and allocator convergence  
**Date:** 2026-11-19  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase project:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Scope:** Wallet creation, profile wallet index allocation, signup trigger dispatch, authenticated provisioning endpoint  
**On-chain transactions:** None  
**Customer balance/address mutations:** None  
**Tier impact:** No new paid projects, database branches, workers, or add-ons created

## 1. Environment and safety

The active target was confirmed as the `paxonesflows` Supabase project. The staging project was not used for this step. The local source directory is `C:\Users\theki\cleanp2p`; all GitHub changes for this step are isolated on `fix/step-06-wallet-provisioning-integration`, based on `7d6c5db44b8a93bef0d1f1865f987fa1c6d267ee`.

Production catalog inspection found zero rows in `auth.users` and zero rows in `public.profiles`. There are four older `public.deposit_addresses` records, each carrying derivation index 327. These rows were not changed or deleted. No wallet balances, private keys, mnemonic, xpubs, Vault secret values, or customer financial data were read. No wallet was created and no blockchain transaction was initiated.

## 2. W06-01 — Signup and profile creation use two wallet-index allocators

**Severity:** High  
**Finding:** The Auth signup trigger `public.handle_new_user()` allocates `profiles.wallet_index` directly from `public.user_wallet_index_seq`. A profile BEFORE INSERT trigger `handle_new_user_wallet_init()` calls `claim_next_wallet_index()` when the incoming index is NULL, and that function used `public.wallet_index_seq`. In addition, `profiles.wallet_index` had a column default using `wallet_index_seq`; on omitted values the default could populate the column before the BEFORE trigger, bypassing the trigger allocator.

Read-only sequence state at inspection:
- `user_wallet_index_seq`: last value 339, next value 340.
- `wallet_index_seq`: last value 336.
- Highest observed older derivation index: 327.

**Code/SQL correction prepared:** migration `20261119171711_step_06_unify_wallet_index_allocator.sql` has strict preconditions for the exact production function owners, SECURITY DEFINER flags, empty search path, function grants, active trigger, profile unique index and sequence state. It removes the legacy column default and redirects `claim_next_wallet_index()` to the already-active `user_wallet_index_seq`, with positive int4 validation. The profile BEFORE trigger now fails closed on invalid indexes. It does not reset either sequence, reassign an existing index, or alter existing address rows.

## 3. W06-02 — Database trigger service bearer did not match the HTTP route

**Severity:** Critical to automatic signup provisioning  
**Finding:** `trigger_provision_user_wallets()` reads Vault secret `wallet_provisioning_bearer` and sends it as `Authorization: Bearer <secret>` to `/api/auth/provision-wallets`, with a target `userId` in the request body. If the Vault secret is missing, the trigger emits a warning and returns successfully without provisioning. The secret-presence check returned false; only the boolean was inspected, never the value.

The application route previously treated every bearer as a Supabase user JWT and required its authenticated user ID to equal the target ID. The database's dedicated service credential is not a Supabase user JWT. Therefore adding a Vault value alone would not make the trigger call succeed.

**Code correction:** the feature branch now verifies a dedicated, server-only `WALLET_PROVISIONING_BEARER` credential using Node's constant-time comparison, with a minimum of 32 UTF-8 bytes. It is a separate branch from normal Supabase user authentication. Service requests must include a valid UUID target. Normal signed-in users remain limited to their own verified Supabase user ID. The route logs neither credential values nor derived addresses and returns no-store responses.

**Still required before automatic trigger provisioning can work:** configure the exact same high-entropy secret in Supabase Vault under `wallet_provisioning_bearer` and as a server-only application environment variable `WALLET_PROVISIONING_BEARER`. Never add it to source control, `.env.example` with a value, a `NEXT_PUBLIC_` variable, or logs.

## 4. W06-03 — OAuth callback dropped the user session token

**Severity:** High  
**Finding:** OAuth callback used a server-to-server fetch to the provisioning endpoint but did not forward the browser cookie or Authorization header. The receiving endpoint therefore had no user identity to authenticate.

**Code correction:** the OAuth callback now forwards the access token returned by `exchangeCodeForSession` as a Bearer token, verifies the HTTP response status, and logs only the status/error type. It does not log the token or response body.

## 5. Production schema compatibility decision

Production schema review confirmed the repository's prepared migrations `20261118154249_enforce_wallet_provisioning_identity.sql` and `20261118165000_mirror_wallet_provisioning_to_legacy_registry.sql` assume a different wallet table contract than this live project. For example, this production database stores four chain rows in `wallets`, has separate `wallet_assets` and `user_wallets` ledgers, and has no `wallet_provisioning` table or `wallet_id` column in `user_deposit_addresses`. Those prepared migrations were not applied.

## 6. Code files on this feature branch

- `src/app/api/auth/provision-wallets/route.ts`
- `src/lib/wallet/provisioning-auth.ts`
- `src/app/api/auth/callback/route.ts`
- `tests/wallet-provisioning-auth.test.ts`
- `.env.example`
- `supabase/migrations/20261119171711_step_06_unify_wallet_index_allocator.sql`

The helper unit test file is added but has not been executed in this pass. No app deployment has been performed.

## 7. Completion criteria

| Item | Status |
|---|---|
| Production schema and trigger inspection | Complete |
| Dual allocator root cause identified | Complete |
| Service-bearer vs user-JWT mismatch identified | Complete |
| Dedicated service bearer validation implemented in branch | Code prepared |
| OAuth callback auth forwarding implemented in branch | Code prepared |
| Guarded single-sequence migration authored | Prepared |
| Production DDL execution and postcondition verification | Pending |
| Supabase Vault credential configured | Pending |
| Hosted app environment credential configured | Pending |
| Feature branch review / merge / deployment | Pending |
| End-to-end provisioning confirmation | Pending; no customer/test account created |

**Step 06 is not marked fully complete.** The code and SQL remediation are prepared; automatic provisioning remains blocked until the same service credential is configured in Vault and the hosted application environment, and the branch is deployed and verified. No credentials are included in this document.
