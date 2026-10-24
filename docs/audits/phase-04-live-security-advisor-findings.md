# Phase 04 — Live Supabase security and performance advisor review

**Date:** 2026-10-24  
**Target:** Production project `eaiwgfxoiwxepinvcykg`  
**Method:** Read-only catalog queries and Supabase security/performance advisor results. No writes, migrations, grants, or policy changes were applied.

## Current advisor snapshot

Security advisor:
- **18** SECURITY DEFINER functions are executable by `authenticated`. This is a review queue, not proof that all 18 are exploitable; several may intentionally serve signed-in users and have authorization checks in their bodies.
- **3** tables have RLS enabled with no policies: `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. Determine intended access paths (trusted backend versus user self-service) before adding policies. Do not add permissive generic policies.
- Advisor timestamps: `2026-10-24T15:30:05Z`.

Performance advisor:
- **5** foreign keys lack covering indexes.
- **38** RLS policies trigger auth/current-setting functions in a row-wise form that may be optimized using scalar subqueries.
- **5** duplicate-index groups.
- These are performance/maintenance findings; index removal or policy rewrites require workload, dependency, and lock-impact review.

## Focused view-access review

Five public views were inspected. All had `security_invoker=true`, which is an important positive control. However, each view also has SELECT privileges for `anon` and `authenticated` at the SQL privilege layer:

| View | Definition-level concern | Follow-up |
|---|---|---|
| `admin_financial_overview` | Aggregates wallet balances, successful sweeps, withdrawal fees, P2P fees and pending approvals | Confirm the view is strictly admin-only; verify underlying-table grants/RLS for every exposed API role |
| `dispute_details_view` | Exposes trade/user identifiers and trade amounts/status | Confirm it is intended only for participants/moderators and verify underlying `trades` RLS/grants |
| `user_trading_stats` | Aggregates trade counts by user ID | Confirm whether cross-user stats are intended to be public |
| `wallet_balances_view` | Aggregates completed trade amounts by user ID; not a canonical wallet ledger | Confirm no client treats it as authoritative wallet balance; verify intended visibility |
| `p2p_ads_view` | Public listing joins ad rows to profile username, full name and avatar | Confirm each selected profile field is intentionally public and consistent with product/privacy policy |

The views use invoker security, and the underlying table RLS policies inspected for sensitive wallet, withdrawal, escrow, and trade tables constrain rows. The catalog inspection did **not** perform API-role impersonation or prove actual REST responses; therefore it does not establish a data leak. Validate effective privileges and RLS with non-production test identities before changing grants.

## High-priority function authorization review queue

The security advisor identified the following examples among the 18 signed-in-executable SECURITY DEFINER functions:
- `admin_freeze_user`, `admin_unfreeze_user`, `admin_set_emergency_mode`, `admin_update_user_role`
- `execute_bulk_ban_atomic`, `execute_bulk_restrict_atomic`, `execute_bulk_unban_atomic`, `execute_bulk_unrestrict_atomic`
- `mark_p2p_trade_paid`, `raise_trade_dispute`, `cancel_p2p_trade`, `initiate_trade_with_escrow`
- `get_user_2fa_status`, `initiate_didit_kyc`, `verify_admin_login`, `get_my_kyc_info`, `get_emergency_mode`, `is_admin`

**Important:** do not simply revoke EXECUTE from every function. Some may be part of the current app contract. For each signature, trace callers, inspect the full deployed body, classify as user-facing or trusted-backend-only, then enforce identity/ownership/admin authorization and least-privilege grants. Service-only RPCs should not be reachable by untrusted roles. Never use user-editable `raw_user_meta_data` for authorization.

## Safe remediation sequence

1. Freeze production changes until the migration source-history issue from Phase 03 is resolved.
2. Create a per-function matrix: signature, SECURITY DEFINER status, owner, grants, app call sites, caller identity source, authorization conditions, and intended roles.
3. Prioritize financial/admin functions and verify `auth.uid()` identity binding; reject caller-supplied IDs that differ from the authenticated identity.
4. Review the three policy-less RLS tables and all five views with explicit expected-access tests in isolated staging.
5. Prepare a separate, reviewed migration from the verified live schema contract. Do not apply changes directly to production from this report.
6. For performance findings, verify query plans/workload and lock impact before adding FK indexes, rewriting policies, or dropping duplicate indexes.
7. Re-run advisors and targeted tests after remediation, then produce a reviewed rollout/rollback plan.

## Not done

- No SQL DDL/DML or grants/policies were changed.
- No live production row data was queried.
- No application tests or impersonated API-role tests were run in this step.
- No GitHub Actions jobs were triggered.
- No merge or deployment was performed.

## Status

**Live advisor review documented. Production readiness remains blocked** by unresolved authorization review, migration-history drift, and the absence of an initialized isolated migration replay environment.
