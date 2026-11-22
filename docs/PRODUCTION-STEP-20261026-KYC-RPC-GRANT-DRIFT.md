# Paxones Production Audit — 2026-10-26 KYC RPC Grant Drift

## Scope
Read-only review of the live Supabase production function privileges compared with the local KYC hardening candidate. No production SQL was changed.

## Verified live observation
Function: `public.initiate_didit_kyc(uuid, text)`
- `SECURITY DEFINER`: true
- EXECUTE for `authenticated`: true
- EXECUTE for `service_role`: true
- configured search_path: `public, pg_temp`
- live function definition MD5 observed during read-only review: `bb37799ee0276dc83df0c16196155eeb`
- function references `auth.uid()` and raises exceptions, but the catalog-pattern checks did not find a direct `p_user_id` vs `auth.uid()` mismatch guard. This pattern scan is not a substitute for complete function-body review or adversarial execution tests.

## Local candidate
`supabase/migrations/20261018100000_restrict_didit_kyc_rpc_execution.sql` revokes EXECUTE from `PUBLIC`, `anon`, and `authenticated`, grants it to `service_role` and `postgres`, and sets `search_path = ''`.
The application route `src/app/api/kyc/initiate/route.ts` calls the RPC through `getSupabaseAdminClient()`, so a service-role-only grant is consistent with the observed intended server call path. All server routes and jobs must still be checked for other callers before deployment.

## Risk / disposition
**Production security configuration drift; treat as a release blocker pending review.** An authenticated role can directly execute a privileged SECURITY DEFINER function accepting a user ID and external provider session ID. Whether this enables cross-user session registration depends on the full installed function body and its identity checks; do not claim exploitability solely from the grant.

## Safe remediation sequence
1. Recover the exact live function definition and verify its complete identity, ownership, retry, and session-state checks against the intended behavior.
2. Inventory all RPC call sites; confirm only trusted server code needs to invoke this function.
3. Validate the proposed grant/search_path migration in an isolated schema-faithful database, including positive service-role tests and negative authenticated/anon tests.
4. Reconcile migration history and verify the migration's preconditions against the live definition hash before deployment.
5. Apply only through the approved migration/release path, then re-query grants and run end-to-end KYC tests.

## Constraints / current status
- No production mutation, commit, push, or deployment performed.
- Local migration is a candidate, not evidence that production is fixed.
- Production migration ledger drift and lack of a schema-faithful free-tier test database remain independent blockers.
