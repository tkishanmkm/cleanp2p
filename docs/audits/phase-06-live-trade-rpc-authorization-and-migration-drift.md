# Phase 06 — Live Trade RPC Authorization and Migration Drift

Date: 2026-10-28  
Repository: `tkishanmkm/cleanp2p`  
Base branch: `main`  
Scope: Read-only inspection of production definitions for `public.raise_trade_dispute` and `public.mark_p2p_trade_paid`, comparison with repository migration sources and API callers.

## Executive summary

Production currently exposes both RPCs to `authenticated` and `service_role`, but not `anon` or `PUBLIC`. Both are `SECURITY DEFINER` functions with `search_path = public, pg_temp`. Those are positive controls, but the authorization bodies still contain two material concerns:

1. If `auth.uid()` is null, either RPC accepts a supplied caller UUID as the effective identity without proving that the caller is a trusted service-role invocation.
2. Both production definitions include `raw_user_meta_data->>'role' = 'admin'` in admin authorization. User-editable metadata must not be treated as proof of admin privileges.

A third issue is a source-to-production contract mismatch: the production `raise_trade_dispute` signature names the second argument `p_user_id`, while `src/app/api/p2p/trades/[tradeId]/dispute/route.ts` sends `p_caller_id`.

## Production facts verified read-only

| RPC | Identity arguments | SECURITY DEFINER | PUBLIC execute | anon execute | authenticated execute | service_role execute |
|---|---|---:|---:|---:|---:|---:|
| `raise_trade_dispute` | `p_trade_id uuid, p_user_id uuid, p_reason text` | Yes | No | No | Yes | Yes |
| `mark_p2p_trade_paid` | `p_trade_id uuid, p_caller_id uuid, p_payment_method text` | Yes | No | No | Yes | Yes |

The production function bodies were retrieved through read-only SQL inspection on 2026-10-28. No production writes were performed.

## Repository comparison

- `supabase/migrations/20260928080000_p2p_trade_flow_and_rls_hardening.sql` describes an earlier hardened `mark_p2p_trade_paid` implementation that excludes `raw_user_meta_data` and uses trusted `raw_app_meta_data` / `app_admins` checks.
- `supabase/migrations/20261003000000_p2p_dispute_schema_and_resolution_alignment.sql` defines `raise_trade_dispute(p_trade_id, p_user_id, p_reason)`, includes the supplied-ID fallback when `auth.uid()` is null, and consults `raw_user_meta_data` for admin status.
- The production `mark_p2p_trade_paid` body currently includes the user-metadata admin check, so it does not match the earlier migration's stated security intent. Migration history and the active database definition must be reconciled before any migration is applied.

## API call contract

- `src/app/api/p2p/trades/[tradeId]/dispute/route.ts` calls `raise_trade_dispute` with `p_caller_id`. This does not match the live named argument `p_user_id` and can fail PostgREST function resolution.
- `src/app/api/trades/[tradeId]/dispute/route.ts` calls `raise_trade_dispute` using `p_user_id`, which matches the live signature.
- `src/lib/disputes.ts` server-side helper also calls `raise_trade_dispute` with `p_user_id`.
- `src/app/api/p2p/trades/[tradeId]/pay/route.ts` calls `mark_p2p_trade_paid` using `p_caller_id`, matching the live signature.

## Required remediation design

Do not deploy a blanket text replacement or blindly replay an old migration. Prepare a new, forward-only migration after the production migration ledger and all function callers have been reconciled.

1. **Identity handling:** when `auth.uid()` is present, use it as the caller and reject a conflicting supplied UUID. When `auth.uid()` is null, reject ordinary requests. If a service-role workflow truly requires an explicit caller UUID, permit it only through a separately verified `auth.role() = 'service_role'` path and keep that client strictly server-side.
2. **Admin authority:** remove all `raw_user_meta_data` role checks. Use only trusted `app_admins` membership and server-controlled `raw_app_meta_data` claims, with suspension/ban policy applied consistently where relevant. Do not rely on user-editable profile flags unless the admin system explicitly establishes them as trusted and server-controlled.
3. **Dispute caller contract:** change the P2P dispute route argument to `p_user_id` or deliberately standardize the database signature and all callers in one reviewed migration. Prefer matching the existing canonical live signature to minimize blast radius.
4. **Preserve invariants:** retain participant authorization, row locks, terminal-state guards, escrow-lock requirements, idempotency, and the no-wallet-mutation behavior of the “mark paid” action.
5. **ACLs:** retain explicit revocation from `PUBLIC` and `anon`; grant only the roles required by verified call paths.
6. **Testing:** validate against an isolated database, not production.

## Required regression cases

- Unauthenticated/anonymous caller with a forged UUID is rejected.
- Authenticated user supplying another user's UUID is rejected.
- User-editable metadata claiming `role=admin` does not grant admin permissions.
- Trusted server-managed admin and `app_admins` users follow intended admin policy.
- Buyer can mark paid only for their own eligible trade after escrow is locked.
- Seller/nonparticipant cannot mark paid.
- Participant can raise a dispute only for a permitted trade state.
- Nonparticipant cannot raise a dispute.
- Completed, released, cancelled, expired, and invalid escrow states remain blocked.
- Repeated dispute/paid requests preserve intended idempotency.
- RPC named arguments resolve correctly from every route and helper.
- `anon` and `PUBLIC` cannot execute the sensitive RPCs.
- “Mark paid” does not mutate wallet balances or settle escrow.

## Status and limits

- Live production function definitions and grants: verified read-only.
- Repository source comparison: completed for the files listed above.
- Migration ledger reconciliation: still required.
- Isolated/staging execution tests: not run.
- Code or SQL remediation applied: no.
- Production database modified: no.
- Main branch modified: no.
- Production readiness approval: not granted.

This document is an audit artifact and remediation plan, not evidence that a fix has been deployed.
