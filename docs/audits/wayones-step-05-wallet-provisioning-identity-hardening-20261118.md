# WAYONES Step 05 - Wallet provisioning identity hardening

**Date:** 2026-11-18
**Repository:** `tkishanmkm/cleanp2p` only
**Branch:** `fix/production-typecheck-batch-1`
**Base commit:** `fd72ad7d0ef753f6854237116573ef7de6addd39`
**Database execution:** No hosted migration or DDL applied
**Verification:** Disposable local PostgreSQL-compatible synthetic schema, 32/32 checks passed
**Step status:** Code and migration prepared; production deployment blocked pending project identification and real-schema reconciliation.

## 1. Scope and safety boundary

This step addresses wallet-index/profile identity drift and deposit-address ownership reassignment identified in Step 4.

The migration was generated locally with Supabase CLI 3.2.0 using the CLI's local-only migration generator. It was not run with `supabase db push`, linked to a hosted database, or applied to staging or production.

No production wallet/address data, mnemonic, xpub, private key, service-role key, or chain credential was read. No funds were moved. The synthetic verification used disposable UUIDs and fabricated chain addresses only.

## 2. Repository changes

### New forward migration

`supabase/migrations/20261118154249_enforce_wallet_provisioning_identity.sql`

This migration is intentionally fail-closed. Before installing any trigger or unique index, it validates the schema, expected allocator/provisioning RPCs, service-role-only RPC permissions, empty search path on the canonical provisioning RPC, signup-trigger postgres ownership/SECURITY DEFINER and ordering, existing wallet/profile consistency, existing user deposit-address consistency, duplicate/normalized address pairs, legacy address ownership links, and that the wallet-index sequence is safely ahead of current profile assignments.

It does not rederive, backfill, reassign or rewrite any customer wallet/address values. It does not advance or reset the wallet-index sequence.

### Indexes

The migration creates these indexes only when a valid equivalent does not already exist:

- A full unique single-column index on `profiles(wallet_index)`. This coexists with the earlier partial unique index and rejects duplicate assigned indexes while preserving multiple NULL values.
- A plain unique `(address, network)` index on `user_deposit_addresses`, which makes the legacy provisioning RPC's plain `ON CONFLICT(address, network)` target infer a matching index.
- A normalized unique address/network index. EVM addresses are normalized to lowercase and network codes to uppercase, preventing case-variant duplicate EVM addresses on the same network. Different networks remain distinct, allowing the same EVM address for ETH, ERC-20 and BEP-20.

Duplicate/collision checks run before index creation. Any existing conflict aborts the migration rather than choosing an owner or rewriting a record.

### Database identity guards

Four private, SECURITY INVOKER trigger functions are installed with an empty search path and owned by `postgres`:

| Guard | Protection |
|---|---|
| `private.guard_profile_wallet_identity()` | Prevents browser/API users from assigning or changing wallet indexes and profile deposit addresses; rejects invalid indexes and freezes assigned wallet identity |
| `private.guard_wallet_row_identity()` | Requires a wallet row's owner, index and chain addresses to match the owning profile; rejects wallet ownership, index or address changes |
| `private.guard_user_deposit_address_identity()` | Enforces canonical asset/network/address/path mapping and same-user wallet links; rejects address reassignment or derivation-path changes |
| `private.guard_deposit_address_identity()` | Protects legacy registry row identity and requires a same-user wallet/profile link; blocks direct client identity writes |

Identity functions are not SECURITY DEFINER functions. EXECUTE privileges are revoked from PUBLIC, anon, authenticated and service_role. Trusted signup functions owned by postgres and service-role provisioning remain the intended write paths. The migration checks the legacy `handle_new_user_wallets()` body, when present, and refuses to continue if it inserts a wallet before the profile row.

The existing provisioning RPC's `ON CONFLICT ... DO UPDATE SET user_id` clause is not rewritten in this migration. Instead, the registry trigger rejects an attempted owner change within the upsert. This preserves the existing RPC body while ensuring a conflict cannot silently transfer an address to another user.

### Legacy address registry limitation

The older `deposit_addresses` table has a different schema and historical network representation from `user_deposit_addresses`. Its new guard enforces same-user profile/wallet ownership and immutable identity, but intentionally does not guess a network-enum-to-BIP32-path mapping. Strict derivation path and asset/network validation is applied to `user_deposit_addresses`. The legacy table's precise historical network semantics remain a production schema-reconciliation item.

## 3. Read-only preflight update

Updated `supabase/tests/wallet_registry_reconciliation_preflight.sql` to check:

- The four new guard functions and enabled triggers.
- Trigger event definitions include insert/update coverage where required.
- SECURITY INVOKER, postgres ownership, empty search path, and no direct API/service-role EXECUTE grants.
- Required owner/index/path checks inside the guard definitions.
- Existing wallet/profile/address/link identity consistency.
- Signup helper insert ordering.
- Required full profile-index and normalized address/network indexes.
- Existing Step 4 checks for schema contract, RPC grants, provisioning upsert protection, duplicate address ownership and sensitive settings/nonce exposure.

Missing guard functions now produce findings rather than causing a premature function-cast error.

The preflight was re-run read-only against `cleanp2p-staging`. It completed and reported the expected blockers: missing canonical wallet schema columns and allocator/provisioning RPCs, absent identity guards/indexes, and the previously identified public access to platform settings and hot-wallet nonce state. No database writes were made by the preflight.

## 4. Synthetic verification

The complete forward migration was applied to a disposable local PGlite PostgreSQL-compatible database with a minimal synthetic schema. The local harness used only throwaway UUIDs, users, and fabricated chain addresses. It did not use Supabase, customer rows, live wallet data, or blockchain RPCs.

<badge color="success">24/24 synthetic checks passed</badge>

Coverage included:

1. Migration parses and applies on the synthetic schema.
2. Trusted profile and wallet provisioning succeeds.
3. BTC, ETH, LTC, ERC-20, BEP-20 and TRC-20 address/path variants are accepted when they exactly match the profile.
4. Legacy deposit-address insert with a matching same-user wallet is accepted.
5. Authenticated profile wallet-index squatting is rejected.
6. Ordinary profile display-name updates remain allowed.
7. Registered deposit-address owner reassignment is rejected.
8. An incorrect BIP32 derivation path is rejected.
9. A wallet address that differs from its profile is rejected.
10. The legacy upsert attempting to overwrite an existing address owner is rejected.
11. A second user's distinct EVM address is accepted.
12. A normalized EVM same-network address collision across users is rejected.
13. Direct authenticated writes to the legacy address registry are rejected.
14. Only the expected accepted address rows remain in the disposable database.
15. A trusted service cannot rotate an assigned profile wallet index or chain address.
16. Existing wallet ownership cannot be changed, even when the replacement row is otherwise consistent with another profile.
17. A deposit-address row cannot be linked to another user's wallet.
18. Registered derivation paths and existing wallet links cannot be rewritten.
19. Direct authenticated inserts into either deposit-address registry are rejected.
20. The postgres-owned SECURITY DEFINER signup-helper fixture passes when profile insertion precedes wallet insertion.

The expanded final harness completed with exit code 0 and output `SUMMARY: 32/32 checks passed`.

**What this verification proves:** SQL syntax and trigger/index behavior on the minimal synthetic schema, including the expected negative and positive cases.

**What it does not prove:** The live production schema matches the migration's preflight; production has no hidden legacy rows or signup functions; the current real provisioning function compiles with the production schema; or wallet addresses already in use match the configured account xpubs. Those require the actual production project and a production-schema rehearsal.

## 5. Production blockers remaining

- The connected Supabase account still shows `paxonesflows` (`eaiwgfxoiwxepinvcykg`) as inactive and `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) as staging. The production project identity has not been established.
- The migration deliberately refuses to run if its required schema, allocator, provisioning RPC, function grants, sequence state, signup ordering, duplicate/collision checks or existing registry ownership checks do not match.
- The staging project still has RLS disabled and broad API-role privileges on `platform_settings` and `hot_wallet_nonces`; no remediation was applied.
- The normal API/web process still has the deposit root mnemonic derivation path by default because public-xpub mode remains opt-in pending xpub-to-existing-address reconciliation.
- The sweeper still derives child private keys and signs transactions in a worker process; independent signer/custody isolation is not complete.
- BTC/LTC withdrawal broadcast support and the full custody key ceremony have not been established.

Production launch remains blocked. Do not run this migration against staging or production by assumption. The correct production Supabase project and its migration/schema inventory must be confirmed first.

## 6. What was deliberately not changed

- No Supabase DDL/DML or hosted migration was applied.
- No production or staging wallet/address records, counters, balances or nonce values were modified.
- No live transaction or sweep was initiated.
- No root mnemonic, xpub or private key was read.
- No Render resource or environment variable was changed.
- No other GitHub project was touched.
- Existing unrelated local withdrawal changes and other untracked files were preserved.

## 7. Step 5 completion decision

**Forward migration authored:** completed locally.
**Read-only preflight updated:** completed.
**Synthetic PostgreSQL-compatible verification:** 24/24 passed.
**Hosted database application:** not performed.
**Production schema compatibility:** unverified until production target is identified.
**Wallet address/key reconciliation:** not complete.
**Custody/signing isolation:** outstanding.
**Production launch:** blocked.

Next step: **Step 6 - Verify provisioning integration and production schema compatibility.** Start by identifying the actual production Supabase project, confirming signup trigger order and legacy registry consumers, then rehearse the migration against a schema-only copy with representative synthetic wallet rows. Only after that evidence is clean should a production rollout be planned.
