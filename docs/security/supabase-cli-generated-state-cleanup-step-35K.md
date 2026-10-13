# Step 35K — Supabase CLI generated-state repository cleanup

## Result

**Completed on proposal branch only.** Added ignore rules for Supabase CLI-generated local state and removed the tracked generated metadata files from the branch. No database was changed.

## Audit performed first

Inspected all seven tracked files in `supabase/.temp/`:
- `cli-latest`
- `gotrue-version`
- `linked-project.json`
- `postgres-version`
- `project-ref`
- `rest-version`
- `storage-version`

They contained CLI/service version metadata and linked project identifiers, not database passwords, access tokens, API keys, or signing secrets. The linked-project file did expose the production project reference/name and organization identifier in Git history. These identifiers are configuration metadata, not credentials; this cleanup does not claim to erase historical Git objects.

## Changes made

1. Updated `.gitignore` with:
   - `/supabase/.temp/`
   - `/supabase/.branches/`
2. Removed the seven generated files from Git tracking on `fix/retire-unverified-deposit-entrypoints`.
3. Left the rest of the `supabase/` folder intact, including `functions/` and `migrations/`.
4. Did not create a `supabase/config.toml` automatically; that file needs a deliberate local project setup review rather than an unexamined init operation.

## Verification

- `.gitignore` change committed: `936a8e0fe9524da2da7259a5a848bf366cac3268`.
- Generated metadata files were deleted in subsequent commits on the same proposal branch.
- The work is isolated from `main`; no merge or deployment performed.
- No secrets were added to the report.
- No Supabase SQL, schema export, import, or migration was executed.
- Tests/build not run.

## Security notes

- This reduces accidental recommit of generated local CLI state; it does not rewrite or purge Git history.
- If credentials are ever found in repository history, treat them as exposed and rotate them; deleting a file is not a substitute for rotation.
- Before using the CLI for schema export, the operator still needs to verify the installed CLI help/version locally and resolve the missing expected `supabase/config.toml` safely.

## Release status

**Schema baseline remains pending. Staging is not yet schema-faithful. Deposits remain NOT READY for production** because `process_deposit_atomic` still accepts caller-influenced confirmation values and the database trust boundary has not been replaced and tested.
