# Step 34U — Staging environment discovery audit

Audit date: 2026-10-14
Status: read-only inspection; no staging or production modifications.

## Environment inventory

### Production project
- Name: `paxonesflows`
- Project ref: `eaiwgfxoiwxepinvcykg`
- Status: ACTIVE_HEALTHY
- Region: `ap-northeast-1`
- PostgreSQL: 17.6.1.166

### Existing staging project discovered
- Name: `cleanp2p-staging`
- Project ref: `tazvjyrdondcrdrkggqe`
- Status: ACTIVE_HEALTHY
- Region: `ap-northeast-1`
- PostgreSQL: 17.11.0.003
- Created: 2026-10-12
- Public base tables: 0
- Public routines: 0
- Recorded migrations: 0
- Edge Functions: none returned
- Security advisor: no lints returned

The project list already contains a separate staging project. It was not created during this step. The absence of public tables/routines and migrations means it is currently an empty database for this application, not a usable staging copy of the production schema.

## Critical limitation

A schema-less staging database cannot validate the live deposit-credit RPC, its grants, migration compatibility, or atomic balance/ledger effects. Do not run the deposit remediation migration against production to compensate. Do not copy production data or secrets into staging. Build a reviewed schema baseline from repository migrations only after reconciling historical drift and reviewing every migration for production-only side effects.

## Next implementation gate

1. Inventory repository migration files and order them.
2. Compare their assumptions against live production schema, especially `process_deposit_atomic`, confirmation thresholds, unique indexes, tables, and grants.
3. Select a minimal reproducible staging baseline. Avoid blindly applying all historical migrations because repository migrations are known to differ from live production.
4. Inspect the candidate migration sequence for cron jobs, triggers, external HTTP calls, real wallet/provider secrets, or scheduled financial side effects.
5. Apply only to `tazvjyrdondcrdrkggqe` after a separate reviewed migration plan; then verify tables, routines, grants, and tests on staging.
6. Implement the independent verifier/credit boundary and run the Step 34T negative-test matrix before considering production rollout.

## Result

Step 34U confirms a separate, healthy but empty staging project exists, so no new branch/project or cost confirmation is needed merely to discover it. No schema, extension, role, secret, data, migration, Edge Function, or deployment was changed. Deposits remain NOT READY for production.
