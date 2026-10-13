# Step 35O — Migration reconciliation audit and staging bootstrap plan

## Status: Repository audit completed; no migrations applied

This is a read-only audit of the proposal branch and Supabase migration metadata. It does not claim a live schema comparison: the private schema dump is still pending, and SQL catalog queries were blocked in this tool session.

## Evidence gathered

### Production/staging migration history

- Production Supabase migration API reports 12 recorded entries, ending with `20261013202555 revoke_anon_access_to_p2p_trade_financial_rpcs`.
- Staging reports zero recorded entries.
- Production and staging are both PostgreSQL 17, but report different minor/build versions: production 17.6.1.166; staging 17.11.0.003.
- Migration-history comparison only compares timestamps, not migration contents or actual schema equality. See official CLI docs: https://supabase.com/docs/reference/cli/supabase-migration-list and https://supabase.com/docs/guides/deployment/database-migrations.

### Repository migration inventory

GitHub API inventory of `supabase/migrations` on `fix/retire-unverified-deposit-entrypoints` returned 108 SQL migration files and 105 unique 14-digit timestamps. Two timestamp collisions were confirmed:

1. `20260919050000_fix_enum_trade_status_all_variants.sql`
2. `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql)

And:

1. `20261002010000_p2p_enum_typecast_hotfix.sql`
2. `20261002010000_remove_legacy_trade_escrow_trigger.sql`

The files were individually fetched and inspected. The first pair both alter the trade-status enum; the buyer-marked-paid file also defines `public.lower(trade_status)` and changes the trades status column. The second pair changes `public.release_trade_escrow` and drops a legacy trigger. These are not interchangeable duplicate files; ordering and effects matter.

Supabase tracks migration versions by timestamp, and its documented migration list compares timestamps only. Therefore, the two collision groups are a migration-history/replay hazard. Do not blindly rename them or replay the directory: changing timestamps can cause already-applied SQL to be considered pending, and order can affect function/trigger state.

## Reconciliation plan (no execution yet)

### Gate 1 — Capture real schema
- Run the Step 35M private schema-only export from a trusted local machine.
- Keep dump outside GitHub; verify production project ref in the Dashboard before export.
- Save dump checksum and export timestamp in a private operations log, not in the repository.

### Gate 2 — Build an immutable migration ledger
- Inventory every migration file's timestamp, path, Git blob SHA, and content hash.
- Compare every repository timestamp to the 12 production history entries.
- For each matching timestamp, compare actual file content against the intended deployed migration evidence/commit history where available.
- Record the two collisions as explicit manual-review blockers.
- Do not use `migration repair` as a shortcut: it changes migration tracking only and does not apply or reverse SQL.

### Gate 3 — Compare schema and migration coverage
- Use CLI help for the installed version before commands.
- Use the private dump plus a local isolated Postgres 17-compatible environment to inspect actual objects.
- Compare tables, columns, enum labels, constraints, indexes, triggers, routines, grants, RLS policies, extensions, and customizations in managed schemas such as auth/storage.
- Account for CLI diff-engine limitations; no single diff output should be treated as a complete proof of parity. See https://supabase.com/docs/reference/cli/supabase-test-db and https://supabase.com/docs/guides/local-development/cli-workflows.

### Gate 4 — Stage only from a reviewed baseline
- Do not apply the existing 108-file directory to empty staging.
- First create a proposed baseline strategy based on the captured production schema, with a reviewed manifest that marks which migrations are already represented in the baseline.
- Resolve duplicate timestamp groups without rewriting production history. Any new timestamped migrations must be unique and generated using the installed CLI's `supabase migration new --help`-verified syntax.
- Bootstrap staging from a private copy/controlled baseline, not production user data or secrets.
- Run reset/replay in an isolated local environment first, then compare the resulting schema to the captured production schema.
- Only after parity review, run financial acceptance tests on staging: deposit confirmation spoofing, replay/idempotency, duplicate transaction/log index, failed/reorged receipts, exact token amounts, withdrawal limits, sweep idempotency, escrow lock/release/refund invariants, and RLS/role boundaries.

## Current release gates

- No SQL or migrations applied by this step.
- Production and staging were not modified.
- No private schema export exists yet.
- Staging remains empty and is not production-equivalent.
- Deposits remain NOT READY for production because `public.process_deposit_atomic` still relies on caller-influenced confirmation values and no validated replacement credit trust boundary has been deployed and tested.

## Outcome

Step 35O completes the repository/history risk audit and provides a safe reconciliation plan. The next useful step is to obtain the private schema export outside this connected session; after that, perform object-level comparison and prepare a baseline manifest without applying it to any remote database.
