# Step 36Z — Live balance-credit and platform-ledger RPC trust-boundary audit

Date: 2026-10-14  
Repository: `tkishanmkm/cleanp2p`  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Production Supabase project: `eaiwgfxoiwxepinvcykg` (`paxonesflows`)

## Scope and method

Read-only inspection of live PostgreSQL function definitions, function ACLs, function security settings, and database-side function-to-function references for `public.credit_user_balance(uuid,text,text,numeric)` and `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`. No RPC was invoked. No schema, permissions, balances, deposits, or ledger rows were changed.

## Live findings

### 1. `credit_user_balance` is a high-risk privileged primitive

Live signature: `credit_user_balance(uuid,text,text,numeric)`  
- `SECURITY DEFINER`, owner `postgres`, pinned empty search path.
- Live ACL check: not executable by `anon` or `authenticated`; executable by `service_role`.
- Takes a caller-supplied user UUID, asset, network, and amount.
- Does not validate that amount is positive, finite, within supported precision/range, or linked to a verified on-chain deposit.
- The `target_network` argument is not used by the function body.
- Upserts `wallet_assets.available` and inserts a compact `ledger_entries` row with type `deposit`; there is no event/reference/idempotency key parameter or duplicate-deposit check in this function.
- Its transaction makes the wallet upsert and ledger insert atomic, but does not make the credit evidence-bound or idempotent.

**Risk:** any trusted backend path that can call this function with unvalidated inputs may create arbitrary credits; a negative amount may reduce the available balance while being recorded as a deposit, depending on deployed constraints. This is a source-level risk, not a demonstrated exploit. Because only `service_role` can execute it in the ACL snapshot, caller/service-role compromise or an unsafe privileged route is the relevant boundary.

**Required disposition:** do not grant this RPC to user roles and do not use it for automated deposit settlement. Keep it contained until replaced by a verified-deposit-specific, transactionally idempotent routine. Before any removal/change, identify all server callers and any operational dependency. Do not test by calling it against production.

### 2. `record_platform_ledger_entry` has better idempotency but still requires caller audit

Live signature: `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`  
- `SECURITY DEFINER`, owner `postgres`, search path set to `public, pg_temp`.
- Live ACL check: not executable by `anon` or `authenticated`; executable by `service_role`.
- Requires nonblank idempotency key, entry type and asset; requires amount > 0 and direction `CREDIT` or `DEBIT`.
- Inserts into `platform_ledger_entries` with unique-key conflict handling. On replay, compares the principal event fields and raises on mismatch; matching retries return the existing ID.
- It does not itself establish that the referenced deposit/withdrawal/chain event is real or finalized. That evidence and authorization must be enforced by its caller.
- Replay comparison does not compare metadata; callers must not treat metadata differences alone as proof that a distinct financial event was accepted.

**Risk:** financial ledger integrity depends on the service-role caller binding the key and reference to a verified event and enforcing the appropriate state transition.

### 3. Database-side caller discovery was inconclusive

A catalog search of public function definitions found no other public SQL function body referencing either helper. GitHub code search on the configured repository returned no matches for these exact names; that search is not exhaustive for the non-default working branch or dynamically constructed RPC calls. Therefore this audit has **not** proven that there are no application callers.

Before changing either helper, inspect the working branch's server routes, workers, cron handlers, and generated/dynamic RPC call sites. Record every caller and its validation/evidence/idempotency guarantees.

## Decision

**Wallet/deposit settlement is not production-ready.** `credit_user_balance` remains a high-risk privileged credit primitive without built-in verified-deposit binding or idempotency. Do not re-enable legacy deposit-credit entrypoints or route live deposits through this helper. Keep deposit auto-credit fail-closed until the verified replacement and its caller are reviewed and tested.

No production change was made in this step. No test transaction was run. This is a read-only audit, not proof of end-to-end production readiness.

## Next step

Step 36AA: inspect the application working branch and all server-side call sites for both helper RPCs (including workers and cron routes), then map each caller to evidence validation, idempotency, authorization, and failure handling before proposing any code or SQL change.
