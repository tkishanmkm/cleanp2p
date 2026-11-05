# PaxOnes Phase 04 — Migration provenance and staging readiness (2026-10-31)

## Status

**Production migration replay remains blocked.** This step performed read-only Supabase catalog/project inspection, GitHub branch/file inspection, and local workstation capability checks. No SQL/DDL/DML was run against either project. No project/branch was created, reset, restored, or merged. No GitHub Actions workflow was used.

## Exact migration-history comparison

Production project: eaiwgfxoiwxepinvcykg (paxonesflows).

- Production migration ledger: **81** records.
- Current local checkout: **172** SQL migration files.
- Exact version-prefix matches: **1 of 81**.
- Production records with no same-version local SQL file: **80**.
- Local SQL files with no same-version production record: **171**.
- The only exact match in this checkout is `20261011152650_wallet_rpc_execute_restrictions.sql`.
- The local version preflight passes: 172 valid, unique version prefixes.
- No same-version/different-name conflicts were found between the 81 live entries and local files.

The earlier Phase 03 GitHub audit (2026-10-24) recorded 81 production entries, 108 main migration files and 112 files on the then-audited branch, with zero exact timestamp matches in those historical snapshots. The current checkout is a later feature-branch snapshot with 172 unique files and one overlap; it does not recover the missing 80 source files.

## GitHub baseline

- Current local branch: `fix/production-typecheck-batch-1`, HEAD `eb5e0acf`.
- GitHub main HEAD: `e73d2a997e338c386032bce7547a123d0952a5ee` (2026-10-16).
- The local clone has no local main ref; origin/main is available.
- The prior GitHub audit branch `audit/phase-03-migration-recovery-inventory` contains a documented source-recovery gap. It states that original SQL bodies must be recovered from an authoritative deployment artifact, original Git commit/PR, or verified backup, and that filenames alone do not prove equivalent SQL exists elsewhere.

## Existing staging project

Staging project: `tazvjyrdondcrdrkggqe` (`cleanp2p-staging`).

- Project status: ACTIVE_HEALTHY.
- PostgreSQL: **17.11.0.003**; production is **17.6.1.166**.
- Public schema: **0 tables/views returned by list_tables**.
- Staging migration ledger: **0 records**.
- Staging has initialized non-public Supabase system schemas, but does not have the application's 80 public tables and 5 public views found in production.
- Staging currently has a different base schema and PostgreSQL patch version; it is **not** an acceptable schema-faithful replay target yet.

## Local workstation capability check

The connected Windows workstation currently has none of:
- Supabase CLI;
- Docker or Podman;
- `psql`, `pg_dump`, `pg_restore`, `initdb`, `postgres`, or `pg_ctl`;
- local `supabase/config.toml`;
- `DISPOSABLE_TEST_DATABASE_URL`, `DATABASE_URL`, or `SUPABASE_DB_URL` in the process environment.

Only `.env.example` was found at the repository root. No secret values were read.

## Free-tier and safety constraints

- No new Supabase project or development branch was created.
- No cost estimate/confirmation flow was entered.
- No GitHub Actions workflow was run.
- Existing staging remains untouched.
- Production remains read-only.

## Required next recovery gates

1. Obtain an authoritative schema-only backup/export of production, or recover the exact original SQL migration bodies from the original deployment artifact, original commit/PR, or verified backup. Preserve source hashes and provenance.
2. Build a version-controlled migration reconciliation manifest with one row per live version: live version/name, recovered source path, content SHA-256, commit/blob/backup reference, and objects changed.
3. Do not infer or recreate missing SQL from migration names or current function definitions. Current live definitions are evidence of state, not original migration source.
4. Prepare a schema-only, data-free staging baseline from an approved, verified export. Check PostgreSQL compatibility, extensions, roles, grants, RLS, policies, functions, triggers, constraints, indexes and views.
5. Replay only individually reviewed forward migrations on the isolated staging project and test withdrawal/ledger/escrow transaction paths with synthetic fixtures.
6. After staging verification, prepare a separate production migration and rollback review. Do not use `supabase db push`, blanket replay, branch rebase, or merge as a shortcut.

## Current release decision

**Do not apply the 172 local files to production or replay them wholesale into the blank staging project.** The 80 missing production migration sources and the production/staging schema contract drift remain the release blocker. This report does not authorize schema changes, production deployment, or live financial testing.
