# Step 36Z — Generic balance-credit and platform-ledger trust-boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only function definition, ACL, caller-text, and live table-contract review. No financial RPC was executed; no data, schema, or privileges were changed.

## Findings

### 1. `credit_user_balance(uuid,text,text,numeric)` — high-risk generic credit primitive

Live catalog:
- SECURITY DEFINER, owner `postgres`, pinned empty search_path.
- EXECUTE granted to `service_role` (and `supabase_auth_admin`); not to `anon` or `authenticated`.
- Accepts caller-supplied user, asset, network and amount. The body does not validate a verified deposit, tx hash, chain/network allowlist, positive amount, deposit status, or an idempotency key.
- It upserts `wallet_assets` by adding `credit_amount` to `available`, then inserts a `deposit` row in compact `ledger_entries`. The ledger row has no reference/idempotency binding. The RPC transaction means an insert failure rolls back the preceding balance update, but repeated successful calls can credit repeatedly.
- The function's parent-wallet insert uses `wallets(user_id, currency)`, while the live `wallets` table also has required `chain`, `address`, and `derivation_index` columns without nullable defaults in the inspected schema. On a new user this branch may fail before the credit; this was inferred from the current table definition and was not executed.

**Disposition:** do not grant this function to clients or treat it as a safe deposit endpoint. Service-role-only ACL limits exposure but does not make the function safe for every privileged caller. Replace or wrap it only as part of a reviewed, evidence-bound deposit-credit transaction with canonical chain output identity, confirmed status, positive bounded amount, asset/network validation, uniqueness/idempotency, and consistent authoritative balance/ledger updates.

### 2. `record_platform_ledger_entry(...)` — idempotent insertion, but not proof of event validity

Live catalog:
- SECURITY DEFINER, owner `postgres`, search_path `public, pg_temp`.
- EXECUTE granted to `service_role` (and `supabase_auth_admin`); not to `anon` or `authenticated`.
- Requires nonblank idempotency key/type/asset, positive amount, and direction in `CREDIT`/`DEBIT`.
- Uses unique-key conflict handling and compares the stored core event fields on replay, raising an exception if the same key has different event parameters.
- It records a platform-ledger row; it does not itself move a user's wallet balance or verify that a deposit/withdrawal/broadcast/sweep occurred. A valid idempotency key prevents duplicate insertion for the same key, but does not authenticate the truth of the event.
- Its explicit search_path includes `pg_temp`; review schema qualification and temporary-object shadowing assumptions before further changes. All table references in the inspected body are schema-qualified.

**Disposition:** suitable only as a privileged ledger-writing primitive behind trusted, validated workflows. Caller authorization and event evidence remain mandatory.

### 3. Caller search and nearby legacy deposit primitive

A search of deployed public function bodies for `credit_user_balance` found `credit_onchain_deposit(text,text,numeric,text,text)`, but the match was in a comment, not an executable call. Its body is a separate legacy path: it trusts supplied transaction hash/address/amount, deduplicates only by raw tx hash, marks the deposit completed, and updates legacy `balances`/`financial_ledger` stores. The current ACL denies EXECUTE to anon, authenticated and service_role. Keep it contained; do not restore privileges.

A search of deployed public function bodies for `record_platform_ledger_entry` returned no caller definitions. This only covers function bodies visible in the current `public` catalog; it does not discover application code, external workers, dynamic SQL, or callers in other schemas.

### 4. Financial data-store divergence

The inspected live schema contains distinct stores:
- `wallet_assets` uses `available` and `locked` (plus reserved/escrow/withdrawal fields).
- `wallets` contains chain/address provisioning fields as well as legacy balance columns.
- `ledger_entries` is a compact user ledger.
- `platform_ledger_entries` is a separate platform ledger with an idempotency key.

Do not assume these are interchangeable or choose a canonical store without tracing all production readers/writers and reconciling existing balances. A coordinated migration is needed rather than a one-function patch.

## Required follow-up

1. Search all application routes, jobs, edge functions, and external worker configuration for both function names and any alternative direct balance writes.
2. Confirm the intended authoritative user balance store and define an event-to-ledger contract across deposit, withdrawal, transfer, sweep, broadcast, trade escrow, and fees.
3. Keep unverified deposit-credit functions contained. Do not execute test credits against production.
4. Add staged integration tests for repeated delivery, same-key/different-payload conflict, concurrent deposit processing, unknown/unconfirmed chain evidence, and rollback on ledger failure.
5. Review and fix the `wallets` parent-row creation assumption before enabling any replacement credit path.

## Verification and limitations

- Queried live function definitions, owner, SECURITY DEFINER/search_path settings, ACLs, and effective EXECUTE privileges.
- Searched deployed `public` function bodies for textual references to both function names.
- Compared relevant live table columns.
- No RPCs executed, no user balances/deposit records/ledger rows changed, no privileges changed, no migration applied.
- No application build, typecheck, or automated tests run. This is a read-only audit, not production sign-off.
