# WAYONES Production Audit — Step 13
**Title:** Wallet index allocation, HD derivation, address registry ownership and provisioning entry points  
**Date:** 2026-11-21  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Render service:** `nextoness` — suspended by owner; no wake/deploy/config action  
**Tier constraint:** Free-tier resources only  
**Scope:** wallet index sequences and allocators, signup profile trigger, canonical provisioning RPC, HD derivation, deposit-address lookup APIs, admin index repair route, legacy queue route, sequence ACLs, Vault auto-provisioning credential, schema and RLS alignment  
**Financial / custody activity:** Read-only production inspection. No address was derived for a live customer, and no profile, wallet, address, sequence, credential or deposit record was changed.

## Executive status

**Step 13 source remediation is prepared; production provisioning is not ready for sign-off.**

The current production database contains four active-looking rows in the legacy `deposit_addresses` table, but all four are orphaned: no matching auth user, profile, canonical address record or wallet exists. The rows are preserved, not deleted or reused.

The monotonic wallet index sequence remains ahead of every historical address index: `user_wallet_index_seq=339` (next value 340), while the highest legacy address derivation index is 327. There are no current auth users or profiles.

The canonical Postgres-owned atomic provisioning RPC exists and has a strong identity/collision contract. However:
- both wallet-index sequences grant direct USAGE/SELECT/UPDATE to `anon` and `authenticated`;
- `handle_new_user()`, the SECURITY DEFINER auth signup trigger, still has `search_path=public, auth, pg_temp`;
- the database Vault secret `wallet_provisioning_bearer` is absent, so the post-profile automatic HTTP provisioning trigger skips dispatch;
- the admin batch index allocator RPC used by the admin repair route is missing;
- the old internal queue provisioning endpoint expects a table not present in production;
- the local-only `20261118165000_mirror_wallet_provisioning_to_legacy_registry.sql` migration has preflight dependencies that do not match the live schema and must not be applied without rewriting/reviewing it.

## Live production evidence (read-only)

### Live row counts and index watermarks

| Item | Live result |
|---|---:|
| `auth.users` rows | 0 |
| `profiles` rows | 0 |
| Profiles missing wallet index | 0 |
| `wallets` rows | 0 |
| `user_deposit_addresses` rows | 0 |
| `deposit_addresses` rows | 4 |
| Legacy addresses without a matching profile | 4 |
| Legacy addresses without a matching auth user | 4 |
| Legacy address rows without derivation index/path | 0 |
| Distinct legacy address values | 4 |
| Maximum legacy address derivation index | 327 |
| `address_derivation_counters` rows | 0 |
| `user_wallet_index_seq` | 339 (called; next allocation 340) |
| `wallet_index_seq` (legacy) | 336 (called; next allocation 337) |

All four legacy address rows are active and comprise one BTC/bitcoin, one ETH/ethereum, one LTC/litecoin and one USDT/TRC20 record. Their user IDs do not map to a current `auth.users` or `profiles` row; there is no matching wallet or canonical registry row. They were not inspected by revealing their raw addresses/IDs in this report, and none was modified.

### Critical sequence ACL exposure

Both `public.user_wallet_index_seq` and `public.wallet_index_seq` are Postgres-owned. The live ACL on each contains `postgres=rwU`, `service_role=rwU`, `anon=rwU`, and `authenticated=rwU`. Therefore anon/authenticated currently have direct:
- `USAGE` — can consume a sequence value with `nextval`;
- `SELECT` — can inspect sequence state;
- `UPDATE` — can call `setval`.

This bypasses the service-only `claim_next_wallet_index()` RPC boundary and is a Critical direct identity-allocation exposure. No client sequence call was attempted.

### Core RPCs, triggers and grants

| Function / object | Live posture |
|---|---|
| `claim_next_wallet_index()` | Postgres-owned SECURITY DEFINER, empty search_path, service_role-only EXECUTE |
| `handle_new_user_wallet_init()` | Postgres-owned SECURITY DEFINER, empty search_path; BEFORE INSERT `profiles` trigger |
| `handle_new_user()` | Postgres-owned SECURITY DEFINER, `search_path=public, auth, pg_temp`; auth.users AFTER INSERT trigger |
| `provision_user_wallets_atomic(uuid,integer,text,text,text,text)` | Postgres-owned SECURITY DEFINER, empty search_path, service_role-only EXECUTE |
| `assign_missing_profile_wallet_indexes()` | Missing |
| `wallet_provisioning` queue table | Missing |

The canonical allocator `claim_next_wallet_index()` calls `nextval('public.user_wallet_index_seq')`. The auth signup function `handle_new_user()` also calls that same canonical sequence, inserts a profile with its assigned value, and the profile BEFORE INSERT trigger only claims an index if the new profile's value is NULL. This is one monotonic allocation path; it does not consume a second index for normal signup.

The admin endpoint `/api/admin/wallet-index/assign` uses `assign_missing_profile_wallet_indexes()`. It already fails closed with HTTP 503 when the RPC is missing; it has no client-side sequence fallback. With zero profiles, there is no current profile backlog, but the admin repair function must be restored/reconciled before any legacy index-backfill operation is needed.

## W13-01 — Direct browser access to wallet index sequences
**Severity: Critical — sequence consumption and reset possible outside the allocator RPC**

Production grants `anon` and `authenticated` USAGE, SELECT and UPDATE on both the canonical and legacy wallet index sequences. A client can therefore call `nextval` directly (consuming an index) or `setval` (changing the sequence watermark) without invoking the service-only allocation function.

Added guarded migration:
`20261121100000_step_13_restrict_wallet_index_sequence_access.sql`

It:
- requires both sequences to exist and be Postgres-owned;
- verifies the reviewed service_role sequence permissions are present before changing ACLs;
- captures both existing `last_value` watermarks;
- revokes all sequence privileges from `PUBLIC`, `anon` and `authenticated`;
- verifies browser roles have no USAGE, SELECT or UPDATE on either sequence;
- verifies service_role and Postgres retain USAGE, SELECT and UPDATE;
- re-reads both sequence watermarks and aborts if either changed.

The migration never calls `nextval`, `setval`, `RESTART` or any wallet allocation function. It has not been applied.

## W13-02 — SECURITY DEFINER auth signup function has a writable search_path
**Severity: High — function shadowing surface**

The live `public.handle_new_user()` function is Postgres-owned and SECURITY DEFINER, but is configured with `search_path=public, auth, pg_temp`. It executes unqualified built-ins/helpers such as `nextval`, `COALESCE`, `TRIM`, `regexp_replace`, and table/function references in a privileged auth-signup trigger.

Added guarded migration:
`20261120230000_step_13_harden_signup_wallet_index_trigger_search_path.sql`

It requires the exact known owner, SECURITY DEFINER mode, path, source markers and one enabled AFTER INSERT trigger on `auth.users`. It changes only the function's search_path to empty, then checks the function body, owner, security mode, ACL and trigger binding remain unchanged. This migration is source-only; the trigger has not been modified in production.

## W13-03 — Automatic signup provisioning skips because the Vault bearer is missing
**Severity: High — delayed deposit-address visibility after signup**

The live `trigger_provision_user_wallets()` function runs after profile insertion and reads Vault secret `wallet_provisioning_bearer`. A separate read-only check confirmed the secret is absent. The trigger logs a warning and returns NEW without dispatching the HTTP request.

This does not prevent the auth/profile trigger from assigning a wallet index, and it does not prevent a signed-in user from later invoking the canonical on-demand address route. It does mean automatic HTTP provisioning immediately after signup is not occurring.

The server route `/api/auth/provision-wallets` requires the dedicated high-entropy `WALLET_PROVISIONING_BEARER` (minimum 32 bytes, constant-time equality) for the database-trigger path; normal user JWT/cookie requests can provision only the currently authenticated user's own wallet. The secret values were not read or printed.

The Render service for this repository is `nextoness`, on the `main` branch, and currently suspended by the owner. The available service-details response does not expose environment-variable keys/values, so the presence of `WALLET_PROVISIONING_BEARER`, `DEPOSIT_HD_MNEMONIC`, or all four public xpubs could not be verified there. No Render environment variable was changed, and the service was not resumed.

## W13-04 — Canonical atomic provisioning is present and identity-bound
**Severity: Reviewed — strong database contract; not exercised with live users**

Production `provision_user_wallets_atomic`:
- is Postgres-owned SECURITY DEFINER with empty search_path;
- is executable only by service_role;
- locks the user profile and sorted addresses;
- requires the supplied positive derivation index to equal `profiles.wallet_index`;
- rejects existing profile mirror conflicts;
- rejects address collisions against other users across profiles, wallets, canonical address records and legacy address records;
- locks/checks existing chain-wallet and registry rows and fails closed on any mismatch;
- persists profile mirror addresses in the same transaction.

The live RPC intentionally stores:
- four chain wallet rows in `wallets` (EVM, TRON, BTC, LTC);
- three canonical address rows in `user_deposit_addresses` (BTC, EVM/ETH, TRC20);
- four compatibility rows in `deposit_addresses` (BTC, ETH/EVM, LTC, USDT/TRC20).

There are six logical address choices returned to the frontend. ERC20/BEP20 share the EVM address and are resolved by the live deposit-credit RPC through the EVM wallet row. LTC resolves through the LTC wallet row. BTC/ETH use canonical user-deposit rows and TRC20 uses the TRC20 canonical row. This three-row canonical + four-wallet layout is an intentional production lookup contract, not a six-row missing registry.

The Step 13 engine now:
- rejects malformed/non-UUID user identities before service-role access;
- requires the already allocated positive profile index (no index 0 or client fallback);
- derives the same six logical address values via mnemonic mode or opt-in public xpub mode;
- calls `provision_user_wallets_atomic`;
- verifies the RPC's `success`, `user_id`, `wallet_index` and all four returned chain addresses match the derived result before returning addresses to the caller.

No current user exists to exercise the RPC, so no new address was derived or provisioned.

## W13-05 — Legacy deposit address APIs could serve stale registry rows first
**Severity: High — address response could bypass current canonical derivation/ownership checks**

The old `/api/wallets/deposit-address` path queried `deposit_addresses` before calling the canonical HD engine and could return a legacy active row without first confirming the profile index/canonical registry. Four such rows are now confirmed orphaned.

Source changes:
- `src/app/api/wallets/deposit-address/route.ts` now authenticates the user and always resolves from the assigned profile index plus atomic provisioning RPC. It validates exact asset/network combinations, returns the correct address for BTC/LTC/ETH/USDT ERC20/BEP20/TRC20, uses no-store responses, enforces a body-size cap and returns generic internal errors.
- `src/app/api/wallets/provision-address/route.ts` is now a compatibility alias to the canonical deposit-address route.
- `src/app/api/wallet/deposit-addresses/route.ts` and `src/app/api/wallet/deposit-address/route.ts` use the canonical engine and generic error responses.
- `src/lib/hd-derivation-engine.ts` no longer claims six physical rows are stored in `user_deposit_addresses`; its documentation reflects the live canonical registry/wallet/legacy compatibility layout.

The four orphaned legacy records are preserved. They are not used as address fallback, migrated, re-assigned or deleted.

## W13-06 — Legacy shared-key provisioning queue route expected a missing table
**Severity: High — over-broad service key and dead queue integration**

The old `/api/internal/provision` accepted `CHAIN_INGEST_SECRET` / `PROVISION_SERVICE_KEY` for arbitrary-user address provisioning and attempted to poll `public.wallet_provisioning`. The table does not exist in production, and no in-repository caller was found. The live profile trigger already targets `/api/auth/provision-wallets` with the dedicated `wallet_provisioning_bearer`.

Source change: `src/app/api/internal/provision/route.ts` is retired with HTTP 410 and a machine-readable error. User-facing authenticated APIs and the database-trigger bearer route remain separate.

## W13-07 — Admin batch allocator RPC is absent
**Severity: Medium — existing null-index backfill unavailable**

`/api/admin/wallet-index/assign` calls `assign_missing_profile_wallet_indexes()`, which is absent in the live database. The endpoint already responds 503 and has no client-side sequence fallback. The relevant source migration `20261108080000_unify_wallet_index_allocation.sql` is not recorded in production history.

There are currently zero profiles, so no current profile requires backfill. Do not enable a batch allocator until the correct production schema/migration chain is reconciled and its locking/uniqueness contract is revalidated.

## W13-08 — Wallet table grants exceed the RLS write policy
**Severity: Medium — least-privilege hardening**

RLS is enabled on `wallets`; its reviewed policies include owner-scoped SELECT and service-role ALL. No anon/authenticated mutation policy was present. However anon and authenticated still have INSERT/UPDATE/DELETE table grants on `wallets`, which should be revoked to match service-mediated financial identity writes. The source DML-hardening migration from Step 11 is not yet applied in production.

Other reviewed registry tables reject browser DML; their owner read policies are scoped to `auth.uid()`.

## W13-09 — Local registry mirror migration is incompatible with live schema
**Severity: Critical — do not apply the local migration**

A local-only untracked file exists on the PC:
`supabase/migrations/20261118165000_mirror_wallet_provisioning_to_legacy_registry.sql`.

Its preflight requires columns not present in production, including:
- `wallets.wallet_index`, `wallets.evm_address`, `wallets.tron_address`, `wallets.btc_address`, `wallets.ltc_address`, `wallets.status`;
- `user_deposit_addresses.wallet_id`, `user_deposit_addresses.updated_at`;
- `deposit_addresses.wallet_id`;
- `wallet_assets.available`.

The live production schema has different column names and relationships. The migration would refuse to proceed in its current form. It was read locally only, remains untracked/untouched, and was not copied into the Step 13 branch or applied. Any future mirror/registry rewrite must be rebuilt against a read-only live schema snapshot and replayed in an isolated database first.

## Source changes prepared in Step 13

- `src/lib/hd-derivation-engine.ts`: UUID, index and exact RPC commit-result verification; corrected registry semantics documentation.
- `src/app/api/wallets/deposit-address/route.ts`: canonical lookup only; no legacy-first fallback.
- `src/app/api/wallets/provision-address/route.ts`: canonical compatibility alias.
- `src/app/api/wallet/deposit-addresses/route.ts` and `src/app/api/wallet/deposit-address/route.ts`: sanitized error responses.
- `src/app/api/internal/provision/route.ts`: retired legacy shared-key queue endpoint.
- `supabase/migrations/20261120230000_step_13_harden_signup_wallet_index_trigger_search_path.sql`: guarded signup trigger search_path hardening.
- `supabase/migrations/20261121100000_step_13_restrict_wallet_index_sequence_access.sql`: guarded sequence ACL hardening with before/after watermark checks.
- `tests/step-13-wallet-address-provisioning-integrity.test.ts`: static assertions for derivation, route identity, bearer auth, index allocator, trigger search_path and sequence grants.

## Local PC and Render handling

- Local PC worktree was inspected read-only. It is on `fix/step-06-wallet-provisioning-integration` and contains many unrelated modified/untracked wallet/deposit/withdrawal/security migrations and files.
- The local working tree was not reset, cleaned, stashed, committed, overwritten or switched.
- The local-only mirror migration remained untouched and untracked.
- Render service `nextoness` is suspended by the owner. No resume, deploy, env change, Blueprint sync or paid resource was attempted.
- Vault secret `wallet_provisioning_bearer` is absent. No secret was created or copied.

## Verification and limitations

- Production checks were read-only and aggregate-only where account records were involved.
- Confirmed four orphan legacy addresses, zero current auth users/profiles/wallets/canonical addresses, monotonic sequence watermarks, public sequence ACL exposure, missing batch allocator, absent Vault bearer and current schema mismatch of the local-only mirror migration.
- Source static tests were added but **not executed** (code/SQL-first sequence preserved).
- No new address derivation, profile creation, sequence call, address migration, wallet creation, deposit, sweep, transfer, withdrawal, blockchain broadcast, production DDL, secret change, deployment or paid resource was performed.
- Render env keys/values could not be inspected through returned service details; no claim is made that xpub/mnemonic env vars are present or absent.

## Recommended order before production changes

1. Reconcile production migration history against the actual deployed schema; keep the incompatible local mirror migration out of the sequence.
2. Review/apply Step 13 sequence ACL migration `20261121100000_step_13_restrict_wallet_index_sequence_access.sql` in a controlled maintenance window. Verify anon/authenticated sequence access is false and the two watermarks remain unchanged.
3. Apply Step 13 signup search_path migration `20261120230000_step_13_harden_signup_wallet_index_trigger_search_path.sql` only after reviewing the guarded preflight against current function source.
4. Revoke direct browser DML grants on `wallets` via the corrected financial-table ACL migration from Step 11; preserve authenticated owner SELECT and service_role DML.
5. Reconcile the missing admin index batch allocator only if a real profile backlog exists.
6. Provision the dedicated high-entropy Vault bearer and matching server-side env variable through an approved secret-management workflow; do not reveal/log either value.
7. Resume Render only after environment-key presence is verified and an authorized deployment window exists. The service is currently intentionally suspended.
8. Use an isolated database and disposable test identities to validate signup allocation, idempotent provisioning, address collisions, xpub/mnemonic equivalence and the live deposit-ownership mapping before considering production sign-off.

## Step 13 completion status

| Item | Status |
|---|---|
| Live schema/columns/indexes/RLS/triggers inspected | Complete |
| Orphan legacy address ownership audit | Complete — 4 orphan records preserved |
| Sequence watermarks and allocator path inspected | Complete — canonical next index 340 |
| Canonical provision RPC contract inspected | Complete — service-role-only, identity/collision checks |
| Customer address APIs aligned to canonical registry | Source prepared |
| Legacy internal provisioning route retired | Source prepared |
| Engine validates atomic commit response | Source prepared |
| Signup SECURITY DEFINER search_path hardening | SQL prepared; not applied |
| Wallet sequence ACL hardening | SQL prepared; not applied |
| Vault provisioning secret | Missing in production; no change |
| Admin batch allocator RPC | Missing; no profiles currently require it |
| Wallet table least-privilege grants | Source migration pending deployment |
| Incompatible local mirror migration reconciled | Not done; do not apply local file |
| Static regression tests | Added; not executed |
| Isolated database and live signup/provision test | Pending |
| Production DDL, Render resume or deploy | Not performed |

**Step 13 is not signed off.** Critical sequence ACLs remain over-broad, signup SECURITY DEFINER search_path remains non-empty, the provisioning Vault secret is absent, the admin batch allocator is missing, and local mirror migration source is schema-incompatible. Production remains **NOT READY**.
