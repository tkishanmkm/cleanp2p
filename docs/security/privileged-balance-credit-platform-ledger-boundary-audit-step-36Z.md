# Step 36Z — Privileged Balance-Credit and Platform-Ledger RPC Boundary Audit

Date: 2026-10-14  
Repository branch: `fix/retire-unverified-deposit-entrypoints`  
Production Supabase project: `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Scope: read-only inspection of live function definitions, execute privileges, and available GitHub caller-search results. No database writes or RPC invocations were performed.

## Executive result

**Not production-ready.** The two functions are not executable by `anon` or `authenticated` in the inspected live privilege snapshot, but both are callable by `service_role` and are `SECURITY DEFINER`. This is a meaningful containment boundary, not proof that the privileged caller paths are safe.

## Findings

### 1. `public.credit_user_balance(uuid,text,text,numeric)` — critical trust-boundary concern

Live definition:
- `SECURITY DEFINER`, owner `postgres`, pinned empty search path.
- Executable by `service_role` and `postgres`; not executable by `anon` or `authenticated`.
- Adds `credit_amount` to `wallet_assets.available` using the unique `(user_id, asset_symbol)` conflict target.
- Inserts a compact `ledger_entries` row with type `deposit`, but no deposit reference/idempotency key or evidence binding.
- **No explicit validation that the amount is positive, finite, or within a supported precision/range.** A negative value can reduce available balance while being recorded as a `deposit` with a negative amount, if a privileged caller supplies it.
- No check that a verified on-chain deposit exists, has sufficient confirmations, matches the user/asset/network/amount, or has not already been credited. The function itself cannot establish those guarantees.
- Wallet parent-row creation and balance update are separate statements; concurrent first-time calls for one user may race on `wallets.user_id` unless a caller or schema constraint safely handles the conflict.
- The ledger insert has no explicit canonical deposit reference, so the compact ledger's unique deposit-reference guard cannot provide idempotency for this function.

**Disposition:** Do not grant this function to client roles or restore its use as a generic deposit-credit endpoint. Keep automatic deposit credit fail-closed until a replacement atomically binds a verified canonical deposit record to one credit, rejects invalid amounts, and enforces idempotency at the database boundary.

### 2. `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

Live definition:
- `SECURITY DEFINER`, owner `postgres`, configured search path `public, pg_temp`.
- Executable by `service_role` and `postgres`; not executable by `anon` or `authenticated`.
- Requires nonblank idempotency key, entry type and asset; amount must be greater than zero; direction must be `CREDIT` or `DEBIT`.
- Uses `ON CONFLICT (idempotency_key) DO NOTHING` and compares core event fields on replay, raising an exception if they differ.
- Replay comparison does not compare `metadata`. That may be acceptable if metadata is explicitly non-authoritative, but this must be documented; it must not carry unvalidated financial facts.
- Function records a platform-ledger entry only; its definition does not itself prove that a corresponding user balance mutation, chain event, or platform accounting counterpart occurred.
- Because it accepts caller-supplied event details and trusts service-role callers, authorization and event provenance must be established by each privileged caller.

**Disposition:** Keep service-role-only. Review all call sites and ensure the idempotency key is derived from a stable canonical event; compare or explicitly exclude metadata from replay semantics; validate allowed entry types and asset/network identifiers at the correct domain boundary.

### 3. Caller inventory remains incomplete

GitHub search for the two exact function names and `platform_ledger_entries` returned no matches in the available search results. This is **not proof that no callers exist**: search coverage may be limited to the default branch and can miss generated SQL, dynamic RPC names, migrations, or code on this working branch. Therefore, no claim is made that all privileged callers have been identified.

## Verified privilege snapshot

| Function | anon | authenticated | service_role |
|---|---:|---:|---:|
| `credit_user_balance(uuid,text,text,numeric)` | denied | denied | allowed |
| `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)` | denied | denied | allowed |

## No changes made

- No function executed.
- No production or staging data, balances, ledger rows, schema, or permissions changed.
- This step is an audit report only; no production fix or test was performed.

## Required next steps

1. Identify every service-role/API/worker caller by searching the checked-out target branch and migrations, including string-built RPC names.
2. For balance credit, replace generic credit authority with a single atomic function that locks and validates a canonical verified deposit, enforces positive bounded amount and asset/network/user matching, and prevents duplicate credit under concurrency.
3. Define safe platform-ledger event types and stable idempotency-key semantics; decide whether metadata participates in replay equality.
4. Add integration tests for negative/zero/excessive amounts, duplicate and concurrent deposit events, mismatched evidence, and privileged caller authorization.
5. Only after replacement paths are verified, plan any retirement of legacy functions. Do not broaden grants as a workaround.

## Production status

Wallet/deposit credit remains **not production-ready**. The client-role ACL is restrictive, but the privileged balance-credit function lacks its own evidence, amount, and idempotency guards. Automatic credit should remain disabled until a verified replacement is tested end-to-end.
