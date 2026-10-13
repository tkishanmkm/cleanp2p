# Step 34V — Staging migration baseline audit

Status: read-only repository inventory and targeted migration review. No migrations executed; no database objects changed.

## Inventory

- Inspected `supabase/migrations` on branch `fix/retire-unverified-deposit-entrypoints`.
- 108 SQL migration files are present.
- Earliest file: `20260831000000_init_schema.sql`.
- Latest file: `20261009000000_archive_and_disable_obsolete_financial_rpcs.sql`.
- Production's recorded migration history was previously observed to extend through 2026-10-13, later than the latest migration in this repository snapshot.
- Two timestamp collisions exist:
  - `20260919050000_fix_enum_trade_status_all_variants.sql`
  - `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`
  - `20261002010000_p2p_enum_typecast_hotfix.sql`
  - `20261002010000_remove_legacy_trade_escrow_trigger.sql`

These collisions require checking actual migration tooling behavior and recorded migration IDs before any replay. Do not rename applied migrations casually.

## Targeted high-risk review

1. `20260831000000_init_schema.sql` includes `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users` (line 408). It changes auth-trigger state and should not be assumed safe to replay over an existing environment.
2. `20260928000000_platform_ledger_entries.sql` drops a withdrawal status constraint and two legacy withdrawal RPC signatures. These changes can affect live financial workflows.
3. `20261001030000_remove_testnet_and_unsupported_networks.sql` deletes rows from `public.hot_wallet_nonces`, removes a network constraint, and drops a legacy gas-funding RPC. It is not safe to run blindly against any database containing operational data.
4. `20261009000000_archive_and_disable_obsolete_financial_rpcs.sql` creates an archive schema/table, changes grants/ownership, and snapshots/archives financial RPC definitions. It needs explicit review for dependencies and intended role access.

The targeted review did not identify cron scheduling or outbound HTTP calls in the sampled deposit-critical migrations; this is not a full scan of all 108 files.

## Deposit-critical migration notes

- `20260903000000_onchain_deposits_and_worker.sql` creates deposit-related schema but defines `onchain_deposits.tx_hash TEXT UNIQUE`; the live database was previously found to use normalized composite uniqueness involving network and output index. This is known schema drift.
- `20260924000000_canonical_deposit_rpc_v2.sql` and `20261001000000_canonical_process_deposit_atomic_part6k7.sql` both define deposit-processing behavior at different points in history. The later live signature still trusts caller-provided confirmation counts for the credit decision.
- A schema baseline cannot be declared reproducible just because all SQL files are present. Migration order, duplicate timestamps, schema drift, and potentially destructive operations need resolution.

## Recommended safe baseline

Do not replay the complete historical migration directory into staging yet. First:
1. Export/inspect the staging and production migration histories and relevant schema-only definitions.
2. Compare every migration recorded as applied with its exact repository file and blob hash where possible.
3. Resolve timestamp collisions in a separate migration-history review; do not mutate already-applied identifiers.
4. Build a clean bootstrap from a reviewed schema snapshot or a documented, deterministic migration sequence. Exclude production data and secrets; replace external endpoints with testnet-only values and keep schedulers disabled initially.
5. Apply only to `cleanp2p-staging`, then compare schema, routines, grants, indexes, triggers, RLS, and extension versions before deposit tests.
6. Only after staging schema matches the intended baseline should the deposit verifier isolation implementation be tested.

## Result

Step 34V identified why blind migration replay is unsafe. It does not yet provide a runnable staging baseline. No production or staging schema was changed. Deposits remain NOT READY for production.
