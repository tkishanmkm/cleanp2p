# Step 36Z — Direct balance-credit and platform-ledger RPC trust-boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only live function-definition and privilege inspection plus repository caller search. No financial RPC was executed; no schema, permissions, balances, or ledger rows were changed.

## 1. `public.credit_user_balance(uuid,text,text,numeric)`

Live definition confirms this is a `SECURITY DEFINER` function with an empty pinned search path (`SET search_path TO ''`). Live privilege checks: `service_role` and `postgres` can execute; `anon` and `authenticated` cannot.

The function:
- accepts caller-provided user UUID, asset, network, and amount;
- uppercases/trims the asset;
- creates a parent `wallets` row if one does not exist;
- upserts `wallet_assets`, adding `credit_amount` to available balance;
- inserts a compact `ledger_entries` row with type `deposit`, but without a deposit reference / transaction identity;
- returns the new available balance.

### Critical trust-boundary concerns
1. **No verified-chain evidence is checked in the function.** The RPC can add a deposit-type balance credit from only caller-supplied parameters. The function itself does not bind a credit to a verified `onchain_deposits` record or canonical transaction/output identity.
2. **No idempotency key or unique deposit reference is supplied to its ledger insert.** Repeated calls can credit the same economic event more than once.
3. **The network argument is not used to validate the asset/network pair or evidence.**
4. **No explicit positive/finite amount validation is visible.** Callers must not be trusted to enforce financial invariants alone.
5. **Caller search returned no indexed matches** for the exact function name in the repository's default-branch code search. This does not prove there are no callers: the search does not cover the working branch and indexing can miss code. The live privileged caller inventory remains incomplete.

### Decision
Treat this RPC as an **unverified privileged credit primitive**. Do not execute it, grant it to user-facing roles, or wire it into deposit processing. Before restoring any automatic deposit-credit path, either remove/revoke service-role execution after a complete live caller inventory, or replace it with a verified-evidence/idempotency-bound atomic flow. Because service-role execution currently exists, the earlier deposit containment is not sufficient by itself to prove every direct credit route is closed.

## 2. `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

Live catalog metadata confirms this function is `SECURITY DEFINER` and has `search_path=public, pg_temp`. Live privilege checks confirm `service_role` can execute while `anon` and `authenticated` cannot.

A full function-definition read was blocked by the SQL tool's safety checks in this run, so its validation rules, idempotency behavior, writes, and caller behavior are **not yet verified**. A mutable/exposed search path for a SECURITY DEFINER function is a hardening concern; do not change it blindly without inspecting body dependencies and schema-qualifying referenced objects.

## 3. Repository caller inventory status

Exact-name code searches returned no indexed results for either function. This is an inconclusive search, not evidence of zero callers. A branch-aware source scan and live function-body read are still required before revoking or changing either RPC.

## 4. Safe next actions

1. Obtain the full live definition and ACL of `record_platform_ledger_entry` using a narrower catalog query or a reviewed SQL editor session.
2. Inventory all SQL functions, triggers, edge functions, server routes, jobs, and migrations that invoke either function; include dynamic SQL and indirect wrappers.
3. Confirm whether any production deposit path still depends on `credit_user_balance`. If none, prepare a narrowly scoped migration to revoke service-role execution only after reviewing dependencies.
4. Audit `record_platform_ledger_entry` input validation, uniqueness/idempotency, and atomicity; then prepare a separate search-path hardening migration after dependency review.
5. Verify any eventual change with live ACL/function metadata and Supabase Security Advisor. Do not test by crediting a real account.

## Status

- `credit_user_balance`: body reviewed; direct unverified-credit risk confirmed; no change made.
- `record_platform_ledger_entry`: SECURITY DEFINER, search path, and role boundary reviewed; body/callers unresolved.
- Deposit processing: **not production-ready**. Prior containment revocations remain in place; do not interpret this audit as approval to re-enable deposits.
- No production database writes were performed.
