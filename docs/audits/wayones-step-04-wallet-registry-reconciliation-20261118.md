# WAYONES Step 04 - Wallet registry reconciliation

**Date:** 2026-11-18
**Repository:** `tkishanmkm/cleanp2p` only
**Branch:** `fix/production-typecheck-batch-1`
**Base commit:** `c15a3e7c48b0fd9b48738df3abb21c8605dc1dd6`
**Database work:** Read-only catalog, grant, schema and aggregate checks only
**On-chain activity:** None
**Step status:** Staging inventory completed; production reconciliation blocked by project identity and schema mismatch.

## 1. Scope and safety boundary

This step inspected the connected Supabase project list, the local Supabase link metadata, wallet registry tables, columns, indexes, row counts, RLS status, table privileges, wallet/index RPC signatures and one legacy nonce allocator function definition.

No customer addresses, wallet identifiers, customer records, mnemonic values, xpub values, private keys, RPC credentials or service-role keys were read. Only schema metadata, table counts, chain counter values, grants and function definitions were inspected. No production database was identified. No DDL, DML, migration, wallet assignment, deployment or blockchain transaction was executed.

## 2. Environment identity

The connected Supabase account contains two projects:

| Project | Ref | Current state | Finding |
|---|---|---|---|
| `paxonesflows` | `eaiwgfxoiwxepinvcykg` | INACTIVE | This is the project ref in the local `supabase/.temp/project-ref`. It is unavailable for database verification while inactive. Its production role is not proven. |
| `cleanp2p-staging` | `tazvjyrdondcrdrkggqe` | ACTIVE_HEALTHY | The only connected project available for read-only database inspection. It is explicitly named staging and cannot be treated as production. |

Supabase returned no migration records for the staging project. Its inspected catalog contains no `supabase_migrations.schema_migrations` table (nor a public schema_migrations table). Therefore the current deployed schema cannot be tied to the repository's migration sequence through the connected migration history.

**Decision:** Do not apply migrations or change wallet address derivation on either project until the production Supabase project is identified and its schema/migration history is verified.

## 3. Staging wallet registry inventory

### Aggregate counts

The following exact row counts were read from `cleanp2p-staging`; no row contents or address values were returned.

| Table | Rows |
|---|---:|
| profiles | 0 |
| wallets | 0 |
| wallet_assets | 0 |
| deposit_addresses | 0 |
| user_deposit_addresses | 0 |
| wallet_provisioning | 0 |
| platform_wallets | 0 |
| deposits | 0 |
| onchain_deposits | 0 |
| address_derivation_counters | 4 |

The four `address_derivation_counters` records are BTC, EVM, LTC and TRON, each with `next_index = 1`. These are per-chain counters, not the repository's global `profiles.wallet_index` allocator.

There are no customer wallet/address records in this staging database to reconcile. No production addresses were available for compatibility or duplicate-owner analysis.

### Schema mismatch against the canonical repository provisioning contract

The staging schema is not the schema expected by `src/lib/hd-derivation-engine.ts` and the repository's `provision_user_wallets_atomic` migration.

| Object | Staging schema | Required by current repository path |
|---|---|---|
| `profiles` | No `wallet_index` and no EVM/TRON/BTC/LTC deposit-address columns | Global `wallet_index` and the four chain address fields |
| `user_wallet_index_seq` | Missing | Used by the global wallet-index allocator |
| `claim_next_wallet_index()` | Missing | Required allocation RPC |
| `assign_missing_profile_wallet_indexes()` | Missing | Required repair/allocation RPC |
| `provision_user_wallets_atomic(...)` | Missing | Called by the canonical address-provisioning engine |
| `wallets` | Only id, user_id, status, provisioning_status and timestamps | Canonical RPC expects wallet index and EVM/TRON/BTC/LTC address fields |
| `user_deposit_addresses` | Has user_id, wallet_id, address, network, asset_symbol and derivation_index | Canonical RPC expects chain, asset_code, network_code and derivation_path as well |
| `wallet_assets` | Has wallet_id, asset_code, available, locked_escrow and locked_withdrawal | Canonical RPC migration expects user_id, asset_symbol, balance, locked_balance, in_escrow and in_withdrawal columns |

The new `wallet_registry_reconciliation_preflight.sql` was executed read-only on staging. It failed as intended, reporting the missing canonical columns, missing wallet-index sequence and RPCs, and security-control failures below. This proves the staging schema cannot currently serve as a verification target for the repository's canonical provisioning flow.

### Index inventory

- `profiles` has only primary-key and username unique indexes; there is no wallet-index uniqueness index because the column is absent.
- `wallets.user_id` is unique in staging.
- `user_deposit_addresses` has a unique `(address, network)` index.
- `deposit_addresses.address` has a global unique index.
- `wallet_provisioning.idempotency_key` is unique.

The global `deposit_addresses.address` uniqueness rule requires review against the intended EVM address reuse model. One EVM address is used by ETH, USDT ERC-20 and USDT BEP-20; a single global address key can conflict with a registry design that stores separate rows for multiple networks. This is recorded as a schema design review item, not asserted as a confirmed production data defect.

## 4. Critical staging security findings

<badge color="danger">Critical - staging only, production status unknown</badge>

### W04-01 - Sensitive platform settings table is publicly writable

On `cleanp2p-staging`:

- RLS is disabled on `public.platform_settings`.
- `anon` and `authenticated` have effective SELECT, INSERT, UPDATE and DELETE privileges.
- The table contains withdrawal governance fields including the global withdrawal kill switch, withdrawal enablement and withdrawal thresholds.

This allows unauthenticated API-key holders or authenticated users to alter platform governance settings directly on the staging project. The exact effect on production is unknown because production has not been identified.

### W04-02 - Hot-wallet nonce state is publicly writable

On `cleanp2p-staging`:

- RLS is disabled on `public.hot_wallet_nonces`.
- `anon` and `authenticated` have effective SELECT, INSERT, UPDATE and DELETE privileges.
- The legacy `public.allocate_hot_wallet_nonce(text,text,bigint)` function is SECURITY DEFINER, owned by postgres, and executable by `anon` and `authenticated`.
- Its configured search path is `public, pg_temp`.
- Its body accepts caller-supplied network, hot-wallet address and pending nonce values, then creates or updates shared nonce state. No caller authentication or registered-hot-wallet authorization check appears in the inspected function body.

This is a direct nonce-poisoning / transaction-availability risk on the staging project. A caller could manipulate nonce coordination and the stored wallet-address field, potentially causing signing or broadcast failures. Direct table DML is also independently granted to the public API roles.

Supabase's security advisor independently flagged both RLS-disabled tables as critical. See the [Supabase Row Level Security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

**No RLS or grant remediation was applied.** The advisor warns that enabling RLS without suitable policies can block intended service access. The correct production target is also unknown. A forward migration must first establish the actual server access patterns and retain service-role/owner operation while denying direct client access.

## 5. Repository migration defects identified

### W04-03 - Wallet-index preflight contradicted the migration's partial unique index

The migration `20260925000014_fix_profile_and_wallet_index_provisioning.sql` creates the canonical partial unique index:

`profiles(wallet_index) WHERE wallet_index IS NOT NULL`.

The existing `wallet_index_allocation_preflight.sql` rejected every partial index and only accepted a full unique index. That meant it could reject the index shape actually created by the repository migration.

**Fix made in this step:** the preflight now accepts either a valid single-column full unique constraint/index or the canonical partial unique index with exactly `WHERE wallet_index IS NOT NULL`. It still rejects composite, expression, invalid, unready or differently filtered indexes.

### W04-04 - Provisioning RPC can reassign an existing address owner

The function definition in `20261001040000_final_production_consistency_hardening.sql` contains:

`ON CONFLICT (address, network) DO UPDATE SET user_id = EXCLUDED.user_id`.

A conflict on an already-registered address/network can therefore change the owner instead of failing closed. A wallet-index collision, wrong key configuration or registry conflict could silently reassign an existing deposit address to another user.

**Severity:** High. This requires a forward SQL correction that preserves existing ownership and rejects a conflict when the existing owner or derivation identity differs. The old migration was not edited and no database function was replaced in this step.

### W04-05 - Provisioning conflict target may not match the canonical address index

The repository migration `20260924000000_canonical_deposit_rpc_v2.sql` drops the simple `(address, network)` constraint and creates a normalized expression unique index over the EVM-normalized address and uppercase network.

The later `provision_user_wallets_atomic` function uses the plain `ON CONFLICT (address, network)` target. A normalized expression index is not an inference match for that plain conflict target. No subsequent repository migration adding the corresponding simple two-column unique index was found in the inspected migration set.

Unless an external/manual simple unique index exists in the actual target database, this provisioning upsert can fail at runtime because PostgreSQL cannot infer a matching unique constraint for that conflict target.

The new read-only registry preflight checks for this mismatch. The correct forward fix must use a conflict target compatible with the canonical normalized index and must not overwrite ownership.

### W04-06 - Wallet-index argument is not checked against an already-assigned profile index

The same provisioning RPC updates `profiles.wallet_index` with `COALESCE(wallet_index, p_wallet_index)`, but the function does not first reject a non-null profile index that differs from `p_wallet_index`. It can leave the profile's original index in place while writing registry records derived from the supplied index. This can split the user's authoritative profile index from the addresses persisted by the RPC.

A forward correction should lock/read the profile row, require exact equality when a wallet index is already assigned, and reject mismatches before writing any wallet/address rows.

## 6. Code/tests changed in Step 4

1. Updated `supabase/tests/wallet_index_allocation_preflight.sql` to accept the canonical partial unique index while preserving single-column, validity, readiness and allowed-predicate checks.
2. Added `supabase/tests/wallet_registry_reconciliation_preflight.sql`, a read-only database preflight that checks:
   - canonical wallet/profile/table columns;
   - wallet-index sequence and allocator/provisioning RPC presence;
   - unique index shape;
   - server-only RPC grants;
   - address ownership conflicts;
   - provisioning owner-reassignment logic;
   - ON CONFLICT target/index compatibility;
   - RLS and anon/authenticated access on platform settings and nonce state.

The new preflight was executed against `cleanp2p-staging` and correctly failed with the schema and security findings. A separate read-only SQL expression check confirmed the owner-overwrite and conflict-target detectors both recognize the unsafe migration pattern.

## 7. What was deliberately not changed

- No Supabase DDL or DML was applied to staging or production.
- No wallet-index sequences or counters were changed.
- No customer address, wallet, or balance record was read or updated.
- No master mnemonic, xpub or private key was read.
- No hot-wallet nonce state or platform setting was edited.
- No Render resource was selected or changed.
- Pre-existing unrelated withdrawal migrations and draft files in the local worktree were preserved.

## 8. Step 4 completion decision

**Connected staging catalog inventory:** completed.
**Aggregate wallet/address counts:** completed; staging has no customer wallet/address rows.
**Wallet registry schema reconciliation:** blocked; staging schema lacks the canonical wallet-index and provisioning contract.
**Production address reconciliation:** blocked; production project identity is not established and the locally linked project is inactive.
**Code/test fix:** completed for the partial-unique-index preflight defect; read-only registry preflight added.
**Critical staging permissions:** identified, not remediated.
**Provisioning owner-reassignment and conflict-target defects:** identified, forward SQL correction required.
**Database mutations:** none.
**Production launch:** blocked.

Next step: **Step 5 - Correct wallet-index and deposit-address provisioning transaction semantics**, starting with a forward SQL migration design for immutable wallet-index ownership, no deposit-address owner reassignment, normalized EVM address uniqueness and server-only wallet allocation. That migration must be tested against the verified production schema before it is applied.

Production identity blocker: the connected account currently shows the inactive local-linked `paxonesflows` project and the healthy `cleanp2p-staging` project. Do not treat staging as production or migrate it as production by inference.