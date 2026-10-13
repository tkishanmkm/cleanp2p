# Step 34Y — Schema-only baseline feasibility and export plan

## Result

The reviewed schema-only staging baseline is **not yet generated or imported**. The connected database tools expose catalog/table metadata and SQL execution, but this workflow has not obtained a verified complete DDL export for all production schemas, functions, triggers, policies, grants, publications, and extension configuration. Generating a partial baseline and calling it reproducible would be unsafe for a custodial financial platform.

## Verified source inventory

- Production: project `eaiwgfxoiwxepinvcykg`; 80 public tables, 200 public routines, 42 public triggers, 118 public RLS policies, 269 public indexes.
- Staging: project `tazvjyrdondcrdrkggqe`; zero public tables/routines/triggers/policies/indexes.
- Repository migration inventory: 108 SQL files, with duplicate timestamps and observed drift from live deposit identity indexes.
- Initial migration `20260831000000_init_schema.sql` (blob `9900290082a8b7e4c7285be4eaa02c04dd7c160a`) includes auth-trigger changes and cannot be treated as harmless staging-only DDL without review.
- `20260903000000_onchain_deposits_and_worker.sql` (blob `1ab654866df4d25086b113ae5953a41f4e67730d`) defines historical deposit schema that differs from live canonical uniqueness.
- `20261009000000_archive_and_disable_obsolete_financial_rpcs.sql` (blob `25aadaf1d47976b41db5c113674344b30268b54b`) archives definitions and changes privileges/ownership; it requires explicit review before replay.

## Required safe export procedure

1. From a trusted workstation with the Supabase CLI installed, inspect the installed CLI version and `supabase db dump --help`; do not guess flags for an unknown version.
2. Authenticate using an operator-controlled, short-lived database credential. Never paste credentials or connection strings into GitHub, chat, or source files.
3. Export schema-only DDL from production into a local, access-controlled temporary file. Exclude application data and secret values. Treat extension-owned objects, auth/storage schemas, grants, and role ownership as sensitive review areas.
4. Inspect the dump for environment-specific endpoints, secrets, role names, auth/storage side effects, cron schedules, HTTP calls, and destructive statements. Redact environment-only values rather than copying them.
5. Build a dependency-ordered, reviewed baseline as a new migration or a separate staging bootstrap artifact. Reconcile every difference with the 108-file repository history; do not replay all historical migrations.
6. Apply only to staging after review; verify object counts, definitions, indexes, grants, RLS, triggers, and routines. Keep all financial schedulers disabled until their individual tests pass.
7. Run negative authorization tests and deposit credit invariants before considering any promotion.

## Scheduler and trigger precautions

Production catalog inspection previously found an inactive five-minute cron job calling `public.auto_cancel_expired_p2p_trades(15)`. The baseline must not accidentally enable it. Relevant wallet/deposit trigger dependencies are listed in `financial-schema-dependencies-step-34X.md`; preserve the dependent functions and triggers together.

## No changes made

No SQL was applied, no migration executed, no scheduler toggled, no secret read/copied, and no production data exported. This step documents the safe path but does not claim a baseline is ready.

## Blocking production issue

The deposit-credit trust boundary is still unresolved: `process_deposit_atomic` uses caller-influenced confirmation values in credit decisions. Staging setup and schema parity do not remediate this issue. Deposits remain NOT READY for production.
