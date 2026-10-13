# Step 35I — Schema-baseline reconciliation checklist

## Outcome

**Decision: staging is still not ready for financial-migration testing.** This is a review checklist based on the Step 35G/35H preflight and the current repository proposal branch. It is deliberately not a schema export, migration, or deployment.

## Current baseline facts

- Proposal branch: `fix/retire-unverified-deposit-entrypoints`.
- Repository migration inventory previously counted 108 SQL files, 105 distinct 14-digit timestamps, and two timestamp-collision groups.
- Collision group 1:
  - `20260919050000_fix_enum_trade_status_all_variants.sql`
  - `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`
- Collision group 2:
  - `20261002010000_p2p_enum_typecast_hotfix.sql`
  - `20261002010000_remove_legacy_trade_escrow_trigger.sql`
- `supabase/config.toml` was not found at the expected path.
- `supabase/.temp/` is tracked and contains generated CLI metadata. Review and remove generated local state from source control in a separately reviewed cleanup change; first check whether any file contains sensitive environment details. Do not paste those values into issues or reports.
- Staging project `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) was previously observed active/healthy but empty: zero public tables and zero recorded migrations. An empty database is not a production-equivalent validation target.
- Production has a materially populated schema (prior inventory: 80 public tables, 200 public routines, 42 triggers, 118 RLS policies, and 269 indexes). These counts are a prior inventory snapshot, not a current guarantee.
- The live `process_deposit_atomic` trust boundary remains unresolved because confirmation values are caller-influenced. Schema parity alone will not make deposits safe.

## Required reconciliation checklist

### A. Secure the source export

- [ ] Operator verifies the exact production project ref and CLI version locally.
- [ ] Operator reads the installed CLI's `supabase db dump --help` and relevant restore/pull help before using flags.
- [ ] Generate a schema-only dump to a private path outside the repository; do not include application data or custom roles unless a separate, reviewed need is approved.
- [ ] Record dump date, CLI version, project ref, command flags, exit code, and checksum in a local operator log. Do not record credentials.
- [ ] Keep the raw dump, connection strings, and any secrets out of GitHub and chat.
- [ ] Confirm exclusions: Supabase-managed schemas and extension-created schemas are not included by default. Separately inventory any required auth/storage configuration, extensions, roles/grants, and scheduler definitions that the dump does not fully capture.

### B. Review sensitive and environment-specific objects

- [ ] Inventory all extensions and versions; confirm which are available in staging and production before restoring dependent objects.
- [ ] Review schema/table ownership, role grants, default privileges, function EXECUTE grants, and SECURITY DEFINER owners/search paths.
- [ ] Review RLS enablement, every policy, views and their security-invoker behavior, triggers, constraints, indexes, sequences, and foreign keys.
- [ ] Review `pg_cron` jobs and any `pg_net`/HTTP calls. Do not activate financial schedules, webhooks, sweepers, or withdrawal broadcasters during bootstrap.
- [ ] Review auth triggers, storage policies/buckets, Vault references, and project-specific URLs/IDs without copying secret values.
- [ ] Identify destructive statements, backfills, data-dependent constraints, and functions that assume existing user or ledger rows.
- [ ] Confirm target default privileges will not accidentally grant broad access to `anon` or `authenticated`.

### C. Reconcile migration history without guessing

- [ ] Compare each repository migration's intended effect with the exported live schema and recorded migration history.
- [ ] Resolve both duplicate timestamp groups explicitly; do not assume filename ordering makes them safe.
- [ ] Mark migrations already reflected in production, migrations superseded by later changes, and migrations that are unsafe to replay.
- [ ] Reconcile known drift, including deposit transaction uniqueness, financial RPC signatures/grants, and the current definitions of deposit/wallet/escrow triggers.
- [ ] Produce a dependency-ordered staging bootstrap from reviewed DDL rather than blindly replaying all 108 files.
- [ ] Preserve the original migration files until the reconciliation is reviewed; any timestamp renaming or history repair must be a separate, auditable proposal.

### D. Bootstrap staging safely

- [ ] Confirm staging is the only target in the command and dashboard before applying any DDL.
- [ ] Take a staging backup/snapshot if supported and record the recovery procedure.
- [ ] Keep all financial cron jobs and worker/broadcast/sweep/withdrawal automation disabled.
- [ ] Apply the reviewed bootstrap to staging only; stop immediately on any unexpected DDL, privilege, extension, or migration-history result.
- [ ] Compare table/routine/trigger/policy/index/constraint counts and critical definitions with the reviewed baseline.
- [ ] Verify role grants, RLS behavior, SECURITY DEFINER ownership/search_path, and that public/ordinary authenticated callers cannot invoke privileged financial routines.
- [ ] Verify no production URL, key, webhook, cron schedule, or external broadcast destination was copied into staging.

### E. Financial acceptance gates (must pass before any production change)

- [ ] Test deposit confirmation from independently verified chain evidence, not caller-supplied confirmation counts.
- [ ] Test wrong chain, asset, contract, destination, amount, transaction/log identity, block hash, insufficient confirmations, reorg, dropped/replaced transaction, outage, expiry, tampering, and replay.
- [ ] Test concurrent duplicate submissions and rollback/atomicity of ledger plus wallet credit.
- [ ] Prove ordinary `service_role` callers cannot mint attestations, access verifier signing material, or bypass the verifier boundary.
- [ ] Test withdrawal authorization, limits, replay/idempotency, approval controls, and broadcaster failure recovery separately.
- [ ] Test sweep and broadcast workers with external side effects disabled or mocked; verify retry/idempotency and audit logs.
- [ ] Run Supabase security advisors and application tests against staging; capture actual outputs and resolve blockers.
- [ ] Obtain human review before production rollout; use a controlled canary and documented rollback plan.

## Exit criteria

This step is complete as a checklist only. Schema reconciliation is **not complete** until an operator has privately generated and reviewed the schema export, the duplicate timestamps and live drift are reconciled, and a staging-only bootstrap has passed verification. No schema has been exported or imported by this step.

## Actions taken

- Reviewed the prior Step 35G and Step 35H audit reports and the migration inventory summary.
- No production SQL or staging SQL executed.
- No schema dump, application data, or secret values exported.
- No migrations applied; no code or database behavior changed.
- No tests or build run.

## Release status

**Deposits remain NOT READY for production.** Do not merge/deploy the proposal branch or re-enable legacy deposit-credit paths based on this checklist. The database credit function still trusts caller-influenced confirmation values, and staging is not yet schema-faithful.
