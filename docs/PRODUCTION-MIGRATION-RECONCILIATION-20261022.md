# Paxones — Day 1 Migration Reconciliation
Date: 2026-10-22

## Verified project identity and database state (read-only)

- `paxonesflows` (project ref `eaiwgfxoiwxepinvcykg`) is the production project: 80 public base tables, 200 public routines, and `supabase_migrations.schema_migrations` exists.
- Production migration ledger contains 81 rows, from `20261011152650` to `20261016013425`.
- `cleanp2p-staging` (project ref `tazvjyrdondcrdrkggqe`) is empty/uninitialized: 0 public base tables, 0 public routines, and no `supabase_migrations.schema_migrations` table.
- The Supabase migration-list connector returned an empty list for production even though a direct read-only SQL query found 81 rows in the production migration ledger. Use the direct SQL ledger query as the verified result; the connector outputs are inconsistent.

## Repository reconciliation findings

- The current working tree contains 132 migration files with valid, unique 14-digit prefixes.
- No local migration file has an exact version prefix matching the 81 versions recorded in production.
- The current worktree and `origin/main` contain no migration files with prefixes in the production ledger's 20261011–20261016 date range. Git history across other refs contains some similarly named migrations with different version prefixes, but that does not prove their SQL is identical to what was applied.
- A static migration filename check passing is not evidence that the SQL chain can be replayed or that the live database schema matches the source.

## Decision and safe next action

**Migration reconciliation is not complete; production deployment remains blocked.** Do not rename local files to imitate production versions, mark migrations as applied, apply the current chain to production, or use the empty staging project as a rehearsal database. Those actions could conceal drift or corrupt the migration history.

To clear the blocker safely, recover the exact SQL source that was used to produce the 81 production migrations (including the original version mapping), compare it with the live schema and current branch, and replay the resulting chain on a disposable schema-matched PostgreSQL database. Then test RLS/authorization, escrow/ledger invariants, idempotency, rollback, and migration ordering.

## Actions performed

- Read-only queries only against both Supabase projects.
- No DDL/DML changes, no migration applications, no branch creation, no commit/push/deploy, and no GitHub Actions execution.
- Existing local modifications were preserved.
