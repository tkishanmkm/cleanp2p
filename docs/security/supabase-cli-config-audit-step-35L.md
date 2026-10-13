# Step 35L — Supabase CLI configuration audit and minimal local config

## Outcome

A minimal `supabase/config.toml` was added on the proposal branch only. It identifies the local project as `cleanp2p-local` and sets the local database major version to PostgreSQL 17. It deliberately does **not** store or set a remote production/staging project reference, database URL, password, access token, or API key.

## Audit-first findings

- Inspected `package.json`: it does not declare the Supabase CLI as a project dependency in the inspected portion; the installed local CLI and its help output cannot be verified through the connected GitHub/Supabase tools.
- The previously tracked CLI metadata recorded CLI version `v2.119.0` and PostgreSQL `17.6.1.166`; this is historical generated state, not proof of the operator's current installed CLI version.
- The active production project is PostgreSQL 17. The minimal config therefore uses `major_version = 17` for local development.
- Supabase documentation says `config.toml` is source-controlled project configuration; `.temp/` and `.branches/` are generated internal state and should not be committed.
- Current Supabase CLI docs also note that remote-target defaults vary by command. Future schema commands must pass explicit target flags and verify project identity before running.
- No matching `supabase/config.toml` existed before this change.

## Change made

File: `supabase/config.toml`

```toml
project_id = "cleanp2p-local"

[db]
major_version = 17
```

This is a minimal local config only. It does not link the worktree to production or staging. It is not a complete declaration of the project's Auth, API, Storage, Edge Functions, or other local stack settings.

## Verification and limits

- Commit: `9918ce37943b616573a5f6539c04dc15a61b835e`.
- Config creation was successful through GitHub's contents API; read-back verification is required separately.
- The CLI binary is not available through connected tools, so `supabase --version`, `supabase --help`, and config parsing were not run. Do not consider CLI validation complete until tested locally.
- No `supabase init`, `supabase link`, schema dump, schema import, migration, SQL query, deployment, or database change was performed.
- Tests/build were not run.

## Operator validation (local worktree only)

From a clean checkout of this proposal branch, verify the installed CLI before any database operation:

```sh
supabase --version
supabase --help
supabase db --help
supabase db dump --help
supabase db pull --help
supabase migration --help
```

If using a project-local CLI dependency, invoke it with the package runner appropriate to that install. Review the CLI version and config against the current official docs before continuing. Do not run `supabase db reset --linked` or any linked push/reset command. Before any remote-target operation, independently confirm the target project ref in the Dashboard and use explicit target flags where supported.

Official references:
- https://supabase.com/docs/guides/local-development/cli/config
- https://supabase.com/docs/guides/local-development/cli-workflows
- https://github.com/supabase/cli/issues/5879 (CLI config requirement discussion)

## Release status

This step only prepares local CLI configuration. It does not establish the database schema baseline, make staging schema-faithful, or repair deposit-credit trust. **Deposits remain NOT READY for production** until the caller-controlled confirmation trust boundary is removed and the replacement is tested end-to-end in a schema-faithful staging environment.
