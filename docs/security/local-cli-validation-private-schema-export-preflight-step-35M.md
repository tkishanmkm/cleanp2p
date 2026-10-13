# Step 35M — Local CLI validation and private schema-export preflight

## Status: Preflight prepared; actual export blocked by environment

This step reviewed the current official Supabase CLI workflow and dump reference, checked the proposal-branch configuration, and prepared a safe operator procedure. The connected tools cannot run a shell, Docker, or the local Supabase CLI, so no claim is made that the installed CLI/config has passed parsing or that a dump exists.

## Documentation checked

- Local workflow: https://supabase.com/docs/guides/local-development/cli-workflows
- CLI config reference: https://supabase.com/docs/guides/local-development/cli/config
- CLI dump reference: https://supabase.com/docs/reference/cli/supabase-db-dump
- Supabase breaking-change changelog: https://supabase.com/changelog?types=breaking-change

Current docs confirm:
- `supabase db dump` uses a CLI-managed `pg_dump` container and excludes Supabase-managed schemas and extension-created schemas.
- Default dump is schema-only; data and custom roles are excluded unless explicitly requested.
- The command supports `--db-url`, `--file`, and explicit local/linked targets.
- `db dump` defaults to the linked target when no target flag is supplied, so an explicit target is essential.
- The local workflow requires CLI and a Docker-compatible runtime for the full local-stack workflow.

## Proposed config checked

`supabase/config.toml` on the proposal branch contains only:

```toml
project_id = "cleanp2p-local"

[db]
major_version = 17
```

The file was read back successfully. It contains no remote project ref or credentials. Config parsing is **not yet verified** because no CLI binary is available to this tool session.

## Safe local validation sequence

Run these from the root of a clean checkout of `fix/retire-unverified-deposit-entrypoints`, using the same CLI installation method you already have. Do not paste secrets or connection strings into chat.

```sh
supabase --version
supabase --help
supabase db --help
supabase db dump --help
supabase db pull --help
supabase migration --help
```

If `supabase` is not a global command, use the package runner matching your installation (for example, `npx supabase --version`). Confirm the CLI help lists the options before running an export.

## Private schema-only export — do not run until target identity is independently confirmed

1. In the Supabase Dashboard, verify the project ref and that it is the intended production project. Do not rely only on a local linked-project file.
2. Use the Dashboard's Connect panel to obtain the appropriate database connection string. Prefer a secure session-pooler connection if direct connectivity is unavailable. Do not commit it or put it in command history.
3. Set `SUPABASE_DB_URL` in the current shell through your local secret manager or secure prompt; do not echo it or save it in a repository file.
4. Create a private destination outside the repository and export schema only.

Example Bash procedure (review paths and target identity before running):

```sh
set -eu
umask 077
mkdir -p "$HOME/private-db-backups/paxones"
chmod 700 "$HOME/private-db-backups" "$HOME/private-db-backups/paxones"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL securely in this shell}"
out="$HOME/private-db-backups/paxones/production-schema-$(date +%Y%m%d-%H%M%S).sql"
supabase db dump --db-url "$SUPABASE_DB_URL" --file "$out"
chmod 600 "$out"
printf 'Schema export created at: %s\n' "$out"
unset SUPABASE_DB_URL
```

This procedure intentionally omits `--data-only` and `--role-only`, so it requests the default schema-only dump. Do not use `--linked` in this first export because an explicit DB URL reduces ambiguity about which remote project is targeted. The CLI may require Docker. Check command output for errors before trusting the file.

## Required post-export checks

- Confirm the command exited successfully and the output file is non-empty.
- Check the beginning and end of the dump locally; do not upload or commit it.
- Inspect the export for project-specific objects, functions, triggers, policies, grants, extensions, and customizations in managed schemas that the default dump might omit.
- Preserve the original as a private baseline; do not edit it in place.
- Compare the dump against repository migrations offline. There are known duplicate migration timestamp groups, so do not automatically replay the current migration directory against production or staging.
- Do not import this dump into staging yet. Staging is currently empty and PostgreSQL minor version differs; first plan an isolated bootstrap/reconciliation with financial acceptance tests.

## No operations performed

- No CLI commands executed.
- No schema export created.
- No SQL, migrations, or database changes executed.
- No tests/build run.
- No production or staging project linked or modified.

## Release gate

The schema baseline remains pending. Deposits remain **NOT READY for production** because the credit RPC still relies on caller-influenced confirmation values. A schema dump alone does not fix or validate that trust boundary.
