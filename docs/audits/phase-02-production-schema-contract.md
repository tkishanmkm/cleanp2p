# Phase 02 — Production SQL and schema contract audit

**Audit date:** 2026-10-13  
**Target:** Supabase production project `eaiwgfxoiwxepinvcykg` (Paxones)  
**Scope:** Read-only catalog inspection and repository migration review. No data rows were read, no DDL/DML was run, and no live-chain/coin test was performed.

## Status

**Audit findings documented; Phase 02 remediation is not complete and must not be treated as deploy-ready.** The production schema is materially different from the repository migration contracts. The connected staging project `tazvjyrdondcrdrkggqe` has no public tables, so it is not yet a usable migration verification environment.

## Confirmed schema contract drift

Production columns were inspected via `information_schema.columns`:

- `public.wallet_assets`: `id, user_id, asset_symbol, balance, locked_balance, created_at, updated_at, reserved_balance, in_escrow, in_withdrawal`. It does **not** have the repository migration's `wallet_id, asset_code, available, locked_withdrawal` columns.
- `public.ledger_entries`: `id, user_id, crypto, amount, type, reference_id, balance_after, metadata, created_at, asset, chain, status`. It does **not** have `wallet_id, asset_code, delta_available, delta_locked, available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key` in the inspected production schema.
- `public.onchain_withdrawals`: has `wallet_id` and `idempotency_key`, but not `metadata`; its status values include approval, queue, broadcast, completion and failure states.
- `public.withdrawals`: has legacy/alternate fields including `asset_code, network_code, destination_address, network_fee, total_deducted`, but no `wallet_id, metadata, idempotency_key` in the inspected schema.
- `public.request_withdrawal` production signature: `(p_user_id uuid, p_network text, p_to_address text, p_amount numeric, p_fee numeric, p_asset text, p_usd_equivalent numeric) RETURNS jsonb`. The repository migration defines a different argument list and `RETURNS uuid`.
- `public.process_failed_withdrawal` production signature includes `p_actual_gas_amount numeric, p_gas_asset text, p_is_verified_unbroadcast boolean`; the repository migration defines only two arguments.

**Safety implication:** Do not apply `supabase/migrations/20260903000002_withdrawal_rpcs.sql` to production as-is. It references columns that are absent and redefines RPC contracts that differ from the live functions. Do not “fix” this by adding columns blindly: first determine the canonical balance model and all callers.

## Confirmed privilege/auth findings

Read-only catalog checks found 145 public-schema `SECURITY DEFINER` functions; 55 were executable by `anon`, 72 by `authenticated`, and 10 by `PUBLIC` according to the privilege query. These counts overlap and are **not additive**. Execute privilege alone does not prove exploitability; each function body and caller must be assessed.

Examples inspected from the live function definitions:

- `admin_resolve_dispute(uuid, uuid, text, text)` authorizes based on caller-supplied `p_admin_id`, rather than proving that it matches `auth.uid()`. This is a high-priority authorization flaw to fix after mapping trusted service callers.
- `finalize_p2p_release(uuid, uuid, numeric, text)` has no caller authentication/authorization check in its body. It should not remain callable by untrusted API roles.
- `complete_trade(uuid)` does check `auth.uid()` and seller/moderator authorization, but its balance/table contract must still be reconciled against the current schema.
- `admin_freeze_user(uuid, text)` checks admin role in its body; nevertheless its execute grants should be narrowed to the intended callers as defense in depth.

The database advisor also flagged eight public tables/views for missing RLS or policies: `admin_financial_overview`, `dispute_details_view`, `p2p_ads_view`, `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, `user_security_audit_logs`, `user_trading_stats`, and `wallet_balances_view`. Each view/table needs object-specific access review; do not blindly enable RLS or create a generic policy without checking its intended access model. PostgreSQL views may bypass RLS unless configured as security-invoker (or access is otherwise restricted).

## Existing migration history

The production migration ledger reports eight wallet/security migrations dated 2026-10-11:

- `wallet_rpc_execute_restrictions`
- `wallet_hardening_followup`
- `wallet_deposit_rpc_restrictions`
- `wallet_legacy_deposit_overload`
- `secure_wallet_provisioning_trigger`
- `enforce_atomic_withdrawal_limits`
- `restrict_wallet_lock_functions`
- `fix_wallet_transfer_search_path`

The connected staging project reports no migrations and no public tables. It must be initialized and seeded with a non-production schema before it can verify these changes.

## Remediation plan / release gates

1. **Freeze schema changes** to production until an owner-approved schema contract is written for wallet balances, locked/escrow/withdrawal amounts, ledger sign conventions, and idempotency.
2. Compare all deployed function signatures and bodies with repository migrations, including overloads, default arguments, grants, triggers, and dependencies. Treat the live database as current state, not as permission to overwrite it.
3. Map every caller of `request_withdrawal`, `process_failed_withdrawal`, `admin_resolve_dispute`, and `finalize_p2p_release`. Move trusted service-only RPCs behind service-role server code; make user-facing RPCs derive identity from `auth.uid()` and enforce object ownership/admin authorization in the function.
4. Write a clean migration from the reconciled contract; do not retrofit the old migration by adding placeholder columns.
5. Initialize an isolated staging database, apply the migration there, and run SQL regression tests for insufficient funds, duplicate/idempotent calls, ledger write failure rollback, failed/unbroadcast refund eligibility, already-broadcast ambiguity, authorization denial, and concurrency/row locking.
6. Run Supabase security advisors and re-check grants, RLS, and view security. Only then prepare a separately reviewed production rollout/rollback plan.

## Verification limits

- Read-only production catalog queries and security/performance advisors were run.
- No production writes, migrations, privilege changes, merge, deployment, SQL integration tests, full application tests, or live crypto transactions were run.
- A separate draft code change (PR #32) removes swallowed exceptions around withdrawal ledger writes, but it remains blocked from application by this schema drift.
