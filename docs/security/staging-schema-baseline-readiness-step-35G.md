# Step 35G — Staging schema baseline readiness audit

## Outcome

**Staging is not ready for financial-migration validation.** This step audited the currently connected staging project and the proposal branch migration inventory. It did not import schema, execute migrations, or modify production.

## Verified staging state

- Project: `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`)
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: 17.11.0.003 (major version 17)
- Public tables returned by the connected table inventory: 0
- Recorded Supabase migrations: 0

This is an empty database, not a schema-faithful test environment. A financial migration tested against it would not prove compatibility with production's existing constraints, indexes, triggers, policies, grants, or data.

## Verified repository migration inventory

Branch: `fix/retire-unverified-deposit-entrypoints`

- 108 SQL migration files found under `supabase/migrations`.
- 105 distinct 14-digit migration timestamps.
- Two duplicate timestamp groups:
  - `20260919050000_fix_enum_trade_status_all_variants.sql`
  - `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`
  - `20261002010000_p2p_enum_typecast_hotfix.sql`
  - `20261002010000_remove_legacy_trade_escrow_trigger.sql`
- `supabase/config.toml` was not found at that path on this branch. This needs repository-level investigation before assuming CLI commands/configuration are reproducible.

The timestamp collisions and historical migration/live-schema drift mean replaying every migration in timestamp order is not a safe baseline strategy.

## Decision

Do **not** blindly replay the migration directory and do **not** run a speculative financial DDL migration on the empty staging database.

The connected tools do not provide a verified complete schema-only dump/import workflow for all required object classes. The safe next action is an operator-controlled local Supabase CLI workflow, with the installed CLI's `--help` consulted first and credentials kept outside chat/GitHub:

1. Produce a schema-only export from production to a private local file; exclude application data and secret values.
2. Review and redact environment-specific roles, grants/ownership, auth/storage objects, extensions, cron schedules, HTTP calls, and destructive DDL.
3. Compare the export against all repository migrations and known live-schema drift; resolve duplicate timestamps explicitly rather than guessing order.
4. Create a reviewed, dependency-ordered staging bootstrap artifact.
5. Apply only to staging with financial schedulers disabled, then compare object definitions/counts, constraints, indexes, RLS policies, triggers, grants, and function security.
6. Run adversarial deposit tests against that schema before approving any credit-path change.

## Scope and safety

- Production project `eaiwgfxoiwxepinvcykg`: no writes performed in this step.
- Staging: read-only inventory only; no schema or data changed.
- No production data or secret values exported.
- No tests/build run.
- No migration applied.

## Release blocker remains

The deposit credit trust boundary is unresolved: `process_deposit_atomic` relies on caller-influenced confirmation values. Establishing schema parity is a prerequisite for safely testing the fix, not a fix by itself. Deposits remain **NOT READY** for production.
