# Phase 07 — Live user-metadata authorization and ledger RLS audit (2026-10-31)

## Executive finding

**Public launch remains blocked by live authorization defects.** Read-only production inspection confirmed that user-editable Supabase Auth metadata is trusted by authenticated P2P RPCs and by the platform financial-ledger RLS policy. A separate authenticated admin-status RPC also accepts a caller-supplied UUID without requiring it to match auth.uid().

No production SQL, DDL or DML was executed. All fixes described below are local migration candidates only.

## Critical production findings

### 1. P2P SECURITY DEFINER functions trust user-editable role metadata

Production signatures and grants:

| Function | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---:|---:|---:|
| mark_p2p_trade_paid(uuid,uuid,text) | No | Yes | Yes |
| raise_trade_dispute(uuid,uuid,text) | No | Yes | Yes |
| resolve_trade_dispute(uuid,text,uuid,uuid) | No | No | Yes |

The deployed mark_p2p_trade_paid and raise_trade_dispute bodies accept auth.users.raw_user_meta_data ->> 'role' = 'admin' in their administrator predicate. An authenticated user can update their own user metadata. In these SECURITY DEFINER functions, that means a user may satisfy the admin override without being a real administrator. The affected operations can act on trades for which the caller is not the buyer/seller.

resolve_trade_dispute also includes the user-editable metadata predicate, but its EXECUTE grant is service-role-only; no direct authenticated EXECUTE grant was found.

Read-only dry-run against the actual deployed function source confirmed that the existing local migration supabase/migrations/20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql matches exactly one predicate in each of five functions:
- mark_p2p_trade_paid
- raise_trade_dispute
- resolve_trade_dispute
- expire_p2p_trade
- cancel_expired_p2p_trades

For all five, the proposed rewrite removes the user-editable metadata reference while preserving trusted raw_app_meta_data conditions. This was a function-source dry-run only; no function was replaced in production.

### 2. Platform financial-ledger RLS policy trusts editable user metadata

Production table catalog:
- platform_ledger_entries: RLS enabled; FORCE RLS disabled.
- Table-level SELECT privilege: granted to anon, authenticated and service_role.
- Current policy Admins can view platform ledger applies to role public and includes an alternative predicate that accepts auth.users.raw_user_meta_data ->> 'role' = 'admin'.

An authenticated user who sets their own metadata role to admin can therefore satisfy the current ledger SELECT policy. The policy can expose platform financial-ledger records through PostgREST.

The existing local migration supabase/migrations/20261031120000_remediate_live_database_advisors.sql replaces this policy with TO authenticated and USING ((SELECT public.is_admin())). The live public.is_admin() implementation relies on a service-role check, the authenticated caller's ID, public.app_admins and server-managed raw_app_meta_data; it does not trust raw_user_meta_data.

Static migration test passed. No policy was changed in production.

### 3. Authenticated admin-status lookup permits cross-user UUID probing

Production verify_admin_login(uuid,uuid) is executable by authenticated and not by anon. The current body chooses COALESCE(p_user_uuid, user_uuid, auth.uid()) without first requiring a supplied UUID to equal auth.uid(). An authenticated user can therefore probe whether another UUID is an administrator.

The local migration supabase/migrations/20261019110000_harden_verify_admin_login_identity.sql binds normal authenticated calls to auth.uid(), rejects other supplied UUIDs, and preserves cross-user lookup only for the trusted service role. Production has all required profiles fields and app_admins.user_id.

Focused static test passed. No function was replaced in production.

## Additional inventory

Read-only scan of public SECURITY DEFINER definitions found:
- 145 SECURITY DEFINER functions total.
- 10 function bodies reference raw_user_meta_data.
- Of those, two trade RPCs with the user-metadata admin override are directly executable by authenticated users.
- The remaining user-metadata references inspected belong to service-role-only trade/worker functions or signup/profile username/full-name initialization triggers; those trigger uses are not role elevation predicates.

A separate live inventory found no SECURITY DEFINER functions executable by anon at the time of this audit. This does not make the authenticated user-metadata paths safe.

## Local migration-chain defects found and corrected

### A. Escrow admin-context candidate did not match live function definitions

The previous 20261030140000_harden_escrow_admin_context.sql expected a user-metadata predicate that is not present in the current deployed definitions of cancel_p2p_trade and release_trade_escrow. Its exact-shape guard would abort rather than patch the actual live functions.

The local candidate was corrected to patch the current common prefix v_is_admin := public.is_admin() OR, replacing it with an authenticated auth.uid()-bound public.is_admin() check plus an explicit public.app_admins membership check. The original trusted raw_app_meta_data predicate remains intact. The candidate fails closed if raw_user_meta_data unexpectedly appears or the function shape drifts.

Read-only dry-run on both actual live functions returned exactly one patch match each, confirmed the authenticated actor guard, confirmed the app_admins predicate, preserved the app_metadata predicate, and left no user_metadata reference.

### B. Duplicate dispute caller-fallback rewrite in the migration chain

Both 20261030130000_harden_resolve_trade_dispute_trusted_caller.sql and 20261030150000_harden_remaining_trade_rpc_caller_fallbacks.sql previously targeted the same resolve_trade_dispute caller fallback. When run in timestamp order, the first migration patches the fallback and the second would then fail its exact-one-match precondition.

The later migration was corrected to target only release_trade_escrow; the dispute RPC remains exclusively handled by the earlier migration. The later patch also skips the exact already-hardened shape idempotently.

Both corrections are local only and are not deployed.

## Verification results

- Live metadata-rewrite dry-run: 5/5 targeted functions matched exactly once; no user-editable metadata remained in the simulated rewritten definitions; server-managed app metadata checks were preserved.
- Live escrow admin-context dry-run: 2/2 functions matched exactly once; authenticated guard and app_admins check added; app metadata preserved.
- Live trusted-caller fallback inventory: one fallback found in each of the four earlier trade RPC targets and in release_trade_escrow / resolve_trade_dispute before migration sequencing; the later duplicate target was removed.
- TypeScript security contract tests: 7 passed.
- Node security contract tests: 8 passed.
- Emergency-freeze focused test: 1 passed.
- Migration preflight: 172 files, 172 unique valid prefixes.
- git diff --check: passed (Git reports existing LF-to-CRLF normalization warnings).

These are static/source and catalog dry-run checks, not PostgreSQL migration execution or adversarial integration tests.

## Release decision and non-actions

**Do not launch publicly until these authorization and RLS fixes have been replayed and tested on schema-matched staging.**

- Production migration ledger remains 81, latest 20261016013425.
- Existing staging migration ledger remains 0; it still lacks the application's public schema.
- No production or staging SQL/DDL/DML was executed.
- No live financial rows or user ledger records were read.
- No migrations were applied, no project/branch was created, and no GitHub Actions workflow was run.
- No commit, push, merge or deployment was performed.

Current local branch remains fix/production-typecheck-batch-1. The worktree was already heavily modified before this step; do not blanket-stage or commit it.
