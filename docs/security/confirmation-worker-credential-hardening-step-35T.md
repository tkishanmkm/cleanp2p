# Step 35T — Confirmation worker credential hardening

Status: code change committed to `fix/retire-unverified-deposit-entrypoints`. No database, SQL, secrets, or deployment changes were made.

## Audit-before-fix

Step 35S found that `src/jobs/confirmationsWorker.ts` used:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a fallback for the privileged service-role key;
- placeholder Supabase URL and key values if environment variables were missing;
- a stale function comment claiming the worker processed deposits via `process_deposit_atomic`, even though it intentionally does not credit deposits.

These are configuration and operational-reporting defects. The worker should fail clearly instead of constructing a client with public or fake credentials.

## Fix applied

1. Replaced module-level client construction with lazy `getSupabaseAdmin()`.
2. Require `SUPABASE_SERVICE_ROLE_KEY` and a configured Supabase URL (`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`).
3. Refuse the service-role key if it exactly matches the configured public anon key.
4. Removed anon-key and placeholder credential fallbacks.
5. Corrected the worker comment to say it only reports chain confirmations and never credits deposits.
6. Fatal worker errors now increment `failedCount` and include a `WORKER_ERROR` detail instead of silently returning an all-zero result.

File: `src/jobs/confirmationsWorker.ts`

## Verification

- GitHub read-back after commit: confirmed.
- Anon/placeholder fallback string: absent in read-back.
- Automated tests, lint, typecheck, build, and runtime behavior: not run.
- SQL/database/deployment changes: none.
- Automatic deposit credit: still disabled/fail-closed; this change does not make deposits production-ready.

## Remaining caveats

- This check only rejects equality with `NEXT_PUBLIC_SUPABASE_ANON_KEY`; it cannot prove that an environment variable named `SUPABASE_SERVICE_ROLE_KEY` contains the correct secret. Deployment secrets and least-privilege access still require review.
- The confirmation worker's chain lookups remain informational and must not authorize credit.
- The repository-wide direct/indirect RPC caller inventory remains incomplete because indexed code search returned no results in Step 35S.
