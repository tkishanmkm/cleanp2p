# WAYONES Production Audit — Step 09
**Title:** Authentication, RLS, public RPC exposure and legacy P2P/admin boundaries  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Free-tier tools/resources only  
**Scope:** Public-schema RLS, table grants, SECURITY DEFINER RPCs, administrator snapshot access, legacy P2P state writes, server-role boundaries  
**Financial activity:** Read-only database/catalog inspection; no financial state, wallet, escrow, trade or blockchain operation

## Executive status

**Step 09 source remediation is prepared but not deployed.** The audit found two concrete access-control issues:
1. Authenticated/anonymous roles had direct table DML privileges on legacy P2P mirror/order tables; the RLS policies allowed users to update their own `p2p_trades` row and fully manage their own legacy `p2p_orders` row. The current app does not require direct client writes to either table.
2. Authenticated users with stale admin profile flags could read `admin_user_status_snapshots` even when suspended, banned or on hold. The current RLS policy checked only admin role flags, while the live `is_active_admin_identity(uuid)` helper also checks account status.

A guarded source migration, contract tests and a legacy hot-wallet path retirement were added on this branch. No production DDL was applied.

## W09-01 — Direct participant updates on legacy P2P trade mirror
**Severity: High — legacy state integrity**

Production grants before the proposed migration:
- `p2p_trades`: anon/authenticated SELECT, INSERT, UPDATE and DELETE privileges were granted at table level; service_role also had server privileges.
- The RLS policy `Users can update their own trades` allowed either a buyer or seller to update a row when the resulting row still matched their participant ID. There were no UPDATE triggers on this table to constrain mutable columns or synchronize a canonical ledger state.
- The SELECT policy was participant-scoped.

A participant could therefore mutate the legacy mirror’s status, amounts, payment fields, or escrow hashes without going through the canonical `trades` state machine. This did not by itself prove a canonical wallet/ledger credit bypass; `p2p_trades` is a separate legacy mirror. It was still an unnecessary writable compatibility surface.

Source usage review:
- `src/app/api/p2p/trades/route.ts` uses an authenticated client for participant SELECT only.
- `src/app/api/trades/[tradeId]/actions/route.ts` validates the Supabase JWT and buyer identity, calls the canonical `mark_p2p_trade_paid` RPC, then mirrors PAID using `adminClient` (service role).
- Media routes use participant SELECT.
- `src/jobs/p2pExpiryWorker.ts` calls the canonical expiry RPC, not direct table writes.
- No frontend or browser source callsite directly writes `p2p_trades`.

**Source fix:** the guarded migration removes the participant UPDATE policy and all browser/public table privileges, then grants authenticated SELECT only and restores service_role ALL access. The migration aborts if the exact reviewed RLS policy set, table privileges, RLS status or service role privileges have drifted.

## W09-02 — Direct browser management of legacy P2P orders
**Severity: High — obsolete order-book write surface**

Production gave anon/authenticated SELECT, INSERT, UPDATE and DELETE table privileges on `p2p_orders`, with a single owner-scoped ALL policy. The table contained zero rows at inspection.

Current source review:
- `src/app/api/p2p/orders/route.ts` is retired with HTTP 410.
- `src/app/api/p2p/orders/[id]/route.ts` validates the user through Supabase Auth, checks the caller is the buyer, allows only PAID, rejects COMPLETED, performs a status compare-and-set with the observed prior status, and uses a service-role server client for the actual write.
- `src/app/api/p2p/trades/route.ts` has a compatibility SELECT fallback to `p2p_orders`, but no direct writes.
- No direct frontend/client `p2p_orders` DML callsites were found in the source tree.

**Source fix:** replace the owner-scoped ALL policy with an owner-scoped SELECT policy only; revoke all public/anon/authenticated table privileges and grant back only authenticated SELECT; preserve service_role ALL access. This retains the compatibility read path and authenticated server mutation route.

## W09-03 — Admin status snapshot SELECT does not check active account state
**Severity: High — stale/suspended administrator read access**

Production policy `admin_user_status_snapshots_mutate_policy` was `FOR ALL TO public` and its predicate accepted any profile with:
- `role = 'admin'`, or
- `is_admin = true`, or
- `is_admin_account = true`.

At table privilege level, authenticated users had SELECT but not INSERT/UPDATE/DELETE; anon had no SELECT. The table currently contains zero rows, but the SELECT predicate would still allow an authenticated administrator whose profile carries a stale admin flag after suspension or ban.

The live `public.is_active_admin_identity(uuid)` helper is PostgreSQL-owned, SECURITY DEFINER and has an empty search path. Its definition rejects banned, suspended, on-hold, and disabled accounts before accepting admin metadata/profile/app_admins identities. Its EXECUTE grant is not exposed to authenticated users, so the migration wraps it in a narrow SECURITY DEFINER helper that uses only `auth.uid()`.

**Source fix:** replace the broad ALL policy with:
- authenticated SELECT only when `is_active_admin_identity(auth.uid())` is true;
- service_role ALL for server operations;
- no anon access and no authenticated DML.

The helper itself is PostgreSQL-owned SECURITY DEFINER with empty search path; EXECUTE is granted only to authenticated and postgres. The migration aborts if the live active-admin helper or existing policy no longer matches the reviewed contract.

## W09-04 — Unused legacy hot-wallet escrow release helper
**Severity: High if reintroduced; dormant source risk**

`src/lib/p2p/escrowService.ts` exported `P2PEscrowService.releaseTradeEscrow()`. Its old implementation:
- loaded a `p2p_trades` row through a service-role client;
- accepted PAYMENT_MARKED as the status gate;
- resolved a buyer address from legacy registries;
- called `executeHotWalletWithdrawal` directly;
- updated the `p2p_trades` mirror to COMPLETED separately.

No call sites for `P2PEscrowService`, `releaseTradeEscrow`, or `lockTradeEscrow` were found in the current `src` tree. The method bypassed the canonical trade settlement and persisted receipt-proof flow if called, so its implementation has been disabled: the existing method signature remains for compatibility but now throws and cannot broadcast. The import of the direct hot-wallet withdrawal primitive was removed.

This is a defense-in-depth code retirement, not a claim that an exploit was observed.

## W09-05 — Five SECURITY DEFINER functions exposed to authenticated callers
**Severity: Reviewed — identity-bound RPCs, not a confirmed vulnerability**

The live database has exactly five public SECURITY DEFINER RPCs callable by authenticated users and not by anon:
1. `check_is_admin(p_user_id uuid, user_uuid uuid)`
2. `initiate_trade_with_escrow(..., p_caller_id uuid)`
3. `is_admin()`
4. `raise_trade_dispute(p_trade_id uuid, p_user_id uuid, p_reason text)`
5. `verify_admin_login(p_user_uuid uuid, user_uuid uuid)`

All five are PostgreSQL-owned and use an empty search path. Code-definition inspection confirmed:
- Caller-supplied IDs are checked against `auth.uid()` for authenticated requests.
- Caller-ID fallback branches explicitly require `service_role`.
- `initiate_trade_with_escrow` uses the authenticated identity as the effective actor and rejects a mismatched `p_caller_id`.
- `raise_trade_dispute` binds `p_user_id` to the authenticated caller and verifies buyer/seller or active-admin authorization.
- `is_admin()` derives the identity from `auth.uid()` and the active-admin helper.
- `verify_admin_login` binds the requested user to the verified auth identity and checks user status.
- `check_is_admin` validates a supplied identity or permits a different identity only for the explicit service-role path.

These grants appear intentional and the inspected definitions do not accept caller-supplied identity as authority. They were not revoked; doing so would break active application flows. Continue regression-testing the identity binding when modifying these RPCs.

## W09-06 — RLS advisor informational findings preserved
The Supabase security advisor also reported four public tables with RLS enabled and no policy:
- `admin_audit_logs`
- `kyc_webhook_events`
- `system_settings`
- `user_feedbacks`

Anon/authenticated table grants were absent for the sensitive tables checked. These are default-deny/private tables, not a reason to add broad policies. No policies were added to silence the advisor.

## Production row counts (aggregate only)

At inspection:
- `p2p_orders`: 0
- `p2p_trades`: 0
- `admin_user_status_snapshots`: 0
- canonical `trades`: 0

No user or record identifiers were copied into this report. No rows were changed.

## Step 09 source files

- `supabase/migrations/20261120193000_step_09_harden_legacy_p2p_and_admin_snapshot_rls.sql`
  - Guarded preflight for exact table/RLS/policy/function/grant contracts.
  - Removes direct browser DML and inherited PUBLIC/anon privileges from legacy P2P tables.
  - Retains authenticated owner/participant SELECT and service_role ALL.
  - Adds an active-admin snapshot read wrapper and splits snapshot SELECT from service-role ALL.
- `tests/step-09-rls-boundary-migration.test.ts`
  - Static contract checks for DML revocation, owner/participant reads, active admin policy, service-role access, and server-side route compatibility.
- `src/lib/p2p/escrowService.ts`
  - Retires the direct hot-wallet release method; no in-repo call sites were found.
- `docs/audits/wayones-step-09-auth-rls-rpc-boundaries-20261120.md`
- `docs/AUTONOMOUS-PROGRESS.md`

## Verification and limitations

- Production catalog inspection was read-only and targeted `paxonesflows`.
- RLS policies, table grants, SECURITY DEFINER function definitions, function grants, source callsites and row counts were compared.
- The Step 09 migration preflight predicates were evaluated with read-only SQL and matched the currently observed production policy/grant state.
- Automated tests were **not executed** in this pass. No migration was applied to production.
- No customer data, balances, trades, escrow, wallets, addresses or blockchain state were changed.
- No paid-tier resources were created.
- Local Desktop Commander worktree was not reset, cleaned, stashed, or overwritten; pre-existing wallet/withdrawal changes remain untouched.

## Step 09 completion status

| Item | Status |
|---|---|
| Public RLS/table grant inventory | Complete |
| Five authenticated SECURITY DEFINER RPCs reviewed | Complete — identity-bound |
| No-policy advisor entries assessed | Complete — private/default-deny |
| Legacy p2p_trades direct update path | Source migration prepared |
| Legacy p2p_orders direct DML path | Source migration prepared |
| Suspended/banned admin snapshot read policy | Source migration prepared |
| Legacy direct hot-wallet escrow method | Disabled in source |
| Step 09 static regression tests | Added; not executed |
| Production DDL application | Not performed |
| Schema-matched replay and authorization matrix | Pending |

**Step 09 is not signed off.** Source changes are ready for review, but the migration has not been replayed against an isolated database or applied to production. Production remains **NOT READY**.
