# Paxones production recheck — 2026-11-01

## Scope
Only `tkishanmkm/cleanp2p`. No PNB changes.

## Live state rechecked
- Desktop Commander device: online.
- Production Supabase project: `paxonesflows` (`eaiwgfxoiwxepinvcykg`).
- Staging project: `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`); earlier checkpoint states public schema has no application tables.
- Local branch: `fix/production-typecheck-batch-1`.
- HEAD at recheck: `eb5e0acf` — Include recognized withdrawal queue statuses in shared type.
- Working tree contains extensive pre-existing modified and untracked code/SQL; preserve it. No commit or push made.
- Local SQL migration files: 198. `scripts/check-migration-versions.mjs` passed its version-prefix uniqueness preflight (198 unique valid prefixes). This does not reconcile the migration ledger.
- Static tracked-source secret-pattern scan suppressed values and found no matching tracked source paths; this is not a full history, deployment, provider, log, or backup secret audit.
- `git diff --check` was run. Output contained line-ending warnings (LF/CRLF); no whitespace-error lines were observed in the captured output.

## Current Supabase advisor snapshot (production)
Security:
- 3 INFO: RLS enabled with no policies on 2FA pending enrollment, recovery-code, and security-audit tables. Existing checkpoint notes say grants are service-only; do not add broad user policies just to silence the advisor.
- 18 WARN: authenticated execution of SECURITY DEFINER functions. Review each function's body, grants, overloads, and call sites before changing grants.
Performance:
- 5 INFO: missing foreign-key indexes.
- 38 WARN: RLS auth-function initplan opportunities.
- 74 WARN: multiple permissive policies.
- 5 WARN: duplicate indexes.
- 46 INFO: unused indexes. Do not remove without usage/constraint/deployment review.

## Critical blockers remain
1. Production has 81 recorded migrations while local has 198 SQL files; exact provenance and production-only changes must be reconciled before applying migrations.
2. Production withdrawal, worker, and ledger contracts remain incompatible with local application expectations. No production withdrawal migration or financial data change was made.
3. Do not bulk-revoke SECURITY DEFINER function access without function-by-function authorization review.
4. Secrets, external provider keys, deployment environment, and full Git history still require a non-disclosing scan/rotation review.
5. Field-level encryption and key-management requirements have not been fully designed or certified. TLS alone is not field-level encryption; client encryption cannot protect a secret from a compromised client.
6. Full localization, legal/AML review, build/type/security/integration/smoke/E2E validation remain outstanding.

## Safety
This recheck used read-only production SQL/advisor calls and local read-only inventory commands. No production migration, Edge Function deployment, wallet/ledger/withdrawal mutation, commit, push, or launch was performed. Production remains NOT LAUNCH-READY.
