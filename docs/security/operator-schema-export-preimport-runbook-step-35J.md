# Step 35J — Operator schema-export and pre-import verification runbook

## Outcome

This step defines the safe operator-controlled path to establish a private schema baseline. It does not claim that a dump has been created, and it does not apply schema to staging or production.

## Preflight findings from repository review

- The proposal branch is `fix/retire-unverified-deposit-entrypoints`.
- `supabase/config.toml` was not found at the expected path.
- `.gitignore` currently excludes common environment files, but does not exclude `supabase/.temp/`.
- Supabase's current local-development documentation identifies `supabase/config.toml` and `supabase/migrations/` as source-controlled project files, and `.temp/` / `.branches/` as CLI internal state that should not be committed.
- The migration directory has 108 SQL files and two known timestamp-collision groups. A blind replay is not an acceptable bootstrap plan.
- Staging was previously observed as empty and is not schema-faithful yet.

Official reference reviewed: https://supabase.com/docs/guides/local-development/cli-workflows

## Operator procedure — do not paste credentials into chat

### 1. Worktree and tool verification

From a trusted workstation, check out the proposal branch and confirm the working tree is clean. Do not perform this procedure from `main`.

Run the installed CLI's own help before any operation:

```sh
supabase --version
supabase --help
supabase db --help
supabase db dump --help
supabase db pull --help
supabase migration --help
```

If the CLI is installed as a project dependency, use the package runner appropriate to that install (for example, `npx supabase`) and inspect its version/help. Do not upgrade the CLI or change package manifests as part of this step without a separate review.

### 2. Confirm project identity before linking

- Confirm the intended production project ref in the Supabase Dashboard.
- Confirm the intended staging project ref separately.
- Never paste database passwords, connection strings, access tokens, service-role keys, or raw dump contents into chat, an issue, or a commit.
- If a local `supabase/config.toml` is absent, stop and inspect why before attempting commands that expect initialized local project configuration. Do not run `supabase init` blindly over an existing directory.
- Linking may write generated state under `supabase/.temp/`; keep that state local and uncommitted.

### 3. Create a private schema-only export

Use the installed CLI's verified help to select the documented remote-schema dump flags and an output destination outside the repository (for example, a private temporary directory with restrictive local permissions). Do not guess flags from this report; CLI versions change.

Requirements:
- Dump schema only; do not request application data or custom-role dumps.
- Do not redirect output into `supabase/migrations/` or another tracked path.
- Confirm command exit status and that the output file is non-empty.
- Store a local record of the timestamp, CLI version, project ref, flags used, exit status, and checksum. Do not record credentials.
- Keep the raw file local. Never commit or upload it to GitHub.

Supabase's CLI documentation states that the default schema dump excludes Supabase-managed schemas and extension-created schemas and does not include data or custom roles by default. Therefore, a dump alone is not a complete transfer of all project configuration or privilege state.

### 4. Validate the dump before considering any restore

Perform a local review only. Do not execute the dump against any database during this step.

Check for:
- unexpected `DROP`, `TRUNCATE`, destructive alterations, and data-dependent constraints;
- function bodies, especially `SECURITY DEFINER`, owner, `search_path`, and EXECUTE grants;
- table ownership, RLS enablement and policies, views, triggers, indexes, constraints, sequences, and foreign keys;
- role/grant/default-privilege statements that could grant excess access to `anon` or `authenticated`;
- extension dependencies and versions, and objects belonging to schemas excluded by the dump;
- auth triggers, storage policy/bucket configuration, Vault references, cron schedules, and `pg_net`/HTTP calls that require separate handling;
- hard-coded project IDs, URLs, secrets, webhook destinations, or production-only endpoints.

Redact or omit secret values from any review notes. If secrets or credentials appear in a dump, stop, protect the file, and handle the exposure through the appropriate secret-rotation process rather than copying them elsewhere.

### 5. Reconcile schema and migration history

- Compare the reviewed dump against repository migrations and the latest recorded production migration history.
- Explicitly resolve the duplicate timestamp groups:
  - `20260919050000_fix_enum_trade_status_all_variants.sql`
  - `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`
  - `20261002010000_p2p_enum_typecast_hotfix.sql`
  - `20261002010000_remove_legacy_trade_escrow_trigger.sql`
- Reconcile known live drift, including deposit transaction uniqueness, financial RPC signatures and grants, and deposit/wallet/escrow triggers.
- Build a dependency-ordered staging bootstrap from reviewed DDL. Do not blindly replay all migration files and do not mark old migrations applied merely to silence a history mismatch.
- Keep the raw dump and generated CLI state out of Git. Commit only reviewed, reproducible migration/configuration changes and the sanitized reconciliation report.

### 6. Staging-only restore gate (not authorized by this step)

Do not restore or apply anything until a separate step reviews the sanitized dump and the exact command plan.

Before any staging import:
- verify the command explicitly targets `cleanp2p-staging` and not production;
- confirm recovery/backup options and that staging contains no needed data;
- ensure financial cron jobs, deposit-credit workers, sweepers, broadcasters, and withdrawal automation remain disabled;
- verify extensions and role/privilege strategy, including default privileges, before restore;
- use a reviewed bootstrap, then compare critical schema definitions and security grants with the expected baseline;
- run security advisors and the adversarial financial test plan;
- stop on any unexpected object, grant, job, external endpoint, or data mutation.

No production restore is permitted as part of this process.

## Repository hygiene follow-up

A separate reviewed cleanup should:
1. Inspect tracked `supabase/.temp/` files locally for sensitive project/environment information without publishing their contents.
2. Add `supabase/.temp/` (and other confirmed generated CLI state) to `.gitignore`.
3. Remove generated state from Git tracking while leaving local files intact, if safe.
4. Re-read the resulting diff and confirm no credentials or project secrets are exposed.
5. Avoid rewriting shared history; if previously committed sensitive credentials are discovered, rotate them.

This hygiene cleanup is intentionally not performed in Step 35J.

## Verification and result

- Repository .gitignore and config-path findings were rechecked.
- Current Supabase CLI version/help could not be executed through the connected tools; the operator must verify them locally before running a dump.
- No schema dump created or imported.
- No production or staging SQL executed.
- No migrations applied; no application code changed.
- No tests/build run.

## Release status

**Schema baseline not yet established. Staging is not yet suitable for financial-migration acceptance testing. Deposits remain NOT READY for production** because the database credit boundary still trusts caller-influenced confirmation values. This runbook is a prerequisite for safely preparing staging, not a deposit-security fix.
