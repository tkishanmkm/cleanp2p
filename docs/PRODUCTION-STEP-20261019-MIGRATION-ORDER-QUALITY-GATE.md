# Production Step — Migration Ordering and Quality Gate (2026-10-19)

## Completed locally

- Detected that the new trusted-caller hardening migration shared timestamp `20261019100000` with `add_financial_fk_indexes`. Renamed the new migration to `20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql` and updated its static test and progress-log reference.
- Confirmed no duplicate migration timestamps remain among migrations dated 2026-10-17 or later. Two duplicate timestamps remain in older historical files (`20260919050000` and `20261002010000`); do not rename already-applied historical migrations without checking live migration history and replay behavior.
- Ran 14 migration-contract test files: all passed. The trusted-caller fallback test passes 2/2 cases.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with existing warnings, including object-injection heuristics, React Hook dependencies, unsafe-regex warnings, and `<img>` optimization warnings.
- `tests/2fa-session-edge.test.ts`: PASS.
- `git diff --check`: PASS; only Windows LF/CRLF normalization warnings.
- Latest production dependency audit snapshot: 69 findings (57 moderate, 12 high, 0 critical). Many high findings report no available non-breaking fix; several proposed fixes require major Tailwind changes. No force upgrade was attempted.

## Blocked / not validated

- `npm run test:all` is blocked by its safety gate because no dedicated disposable test database is configured. It requires `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1`; production credentials must never be used for these mutating tests.
- SQL migrations have only source-level/static validation. No local PostgreSQL, Docker, or Supabase CLI is available, and the separate staging Supabase project has no matching schema/migration history.
- The connected `paxonesflows` database remains unchanged. Read-only Supabase advisors still report 18 authenticated-executable SECURITY DEFINER functions, five missing foreign-key indexes, 38 RLS auth-initplan warnings, and other policy/index lint findings. Findings need per-function and per-policy review; do not bulk-revoke grants or drop duplicate indexes blindly.
- No migration was applied, no commit/push/merge/deployment occurred, and no real financial operation was performed.

## Release status

**NOT PRODUCTION READY.** Next gate: provision a truly disposable, schema-matched PostgreSQL/Supabase test database without using production credentials; replay migrations in order; run positive and negative authorization tests for trade, KYC, admin-login, ad visibility, chat retention, and account-status guards; then review the dependency remediation plan and run the full build/test gate.
