# Step 35H — Schema-only export workflow and repository preflight

## Result

The current tool connection cannot execute a trusted local Supabase CLI or pg_dump/pg_restore workflow, so this step does not claim to have exported or restored a schema. Official Supabase CLI documentation was checked to confirm the supported general approach. This report is a preflight/runbook, not a database change.

## Repository findings

- The proposal branch contains supabase/migrations/ but no supabase/config.toml at the expected path.
- supabase/.temp/ is present in GitHub and contains generated CLI metadata files: cli-latest, gotrue-version, linked-project.json, postgres-version, project-ref, rest-version, and storage-version.
- These are not, by their filenames alone, evidence of a database password or service-role key. However, generated local CLI state generally should not be committed. Review whether the directory is tracked unintentionally; do not publish credential-bearing local configuration.
- .gitignore excludes .env, .env.local, and .env.*.local, and allows .env.example. This is good baseline protection, but it does not exclude supabase/.temp/.

## Official CLI guidance reviewed

Supabase's CLI reference says supabase db dump dumps remote database schema by default, excludes Supabase-managed schemas and extension-created schemas, and does not include data or custom roles unless requested. The command requires the project to be linked; --db-url is documented for self-hosted database use. The docs also warn that default privileges on a target database can grant broader access than expected.

Reference: https://supabase.com/docs/reference/cli/supabase-db-dump

The exact installed CLI version and its flags have not been verified here. The operator must run supabase --version, supabase db dump --help, and supabase db pull --help locally before relying on any flags. The command help is authoritative for that installed version.

## Safe operator-controlled preflight

Run from a trusted workstation with the repository checked out on the proposal branch. Do not paste database credentials, connection strings, passwords, service-role keys, or dump contents into chat or GitHub.

1. Verify branch and clean working tree. Confirm the current branch is fix/retire-unverified-deposit-entrypoints, not main.
2. Inspect supabase --version and the help output for db dump and db pull.
3. Confirm the project link targets the intended production project before creating a schema-only dump; never run a restore command against production.
4. Use the documented schema-only/dump options supported by the installed CLI and write output only to a private local path outside the repository. Do not use data-only, role-only, or a full data dump.
5. Review the dump locally for functions, triggers, policies, grants/default privileges, extensions, cron jobs, HTTP/net calls, auth/storage customizations, role assumptions, destructive DDL, and environment-specific values. Do not commit the raw dump.
6. Create a staging bootstrap from reviewed DDL. Reconcile the 108 migration files, duplicate timestamps, and live-schema differences. Do not blindly replay history.
7. Apply only to staging, with financial schedulers disabled; verify catalog/object counts and privilege/RLS behavior before testing deposits.

### Important CLI caveat

supabase db pull can create a migration from a remote schema and may use a shadow database/Docker. It is not a substitute for inspecting the exact CLI behavior and resulting diff. Because the repo lacks the expected supabase/config.toml and its migration history is collision-prone, do not run it as an unreviewed write operation in this step.

## Actions taken in this step

- Read-only repository and project inventory only.
- Reviewed official Supabase CLI documentation.
- No CLI command was executed.
- No schema dump was generated or imported.
- No staging or production SQL was executed.
- No secrets or application data were exported.
- No tests/build run.

## Exit criteria before schema import

- A verified, schema-only export exists privately outside Git.
- Export scope and exclusions are reviewed.
- Duplicate migration timestamps and schema drift are reconciled.
- A staging-only bootstrap plan is reviewed.
- The staging project is confirmed as the sole restore target.
- Financial schedules/workers remain disabled until explicit tests pass.

## Production status

The deposit credit trust boundary remains unresolved. This preflight does not remediate the function's reliance on caller-influenced confirmation values. Deposits remain NOT READY for production.
