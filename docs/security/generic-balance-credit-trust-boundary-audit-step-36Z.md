# Step 36Z — Generic balance-credit and platform-ledger trust-boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only review of live function bodies, SECURITY DEFINER settings, EXECUTE ACLs, and source-code search. No RPC was executed; no data, schema, or privileges changed.

## 1. `credit_user_balance(uuid,text,text,numeric)` — HIGH RISK IF USED AS A DEPOSIT ENTRYPOINT

Live catalog facts:
- SECURITY DEFINER = true.
- Function setting is an empty `search_path` (catalog renders it as an empty value).
- EXECUTE ACL snapshot includes `service_role`, `postgres`, and `supabase_auth_admin`; no `anon` or `authenticated` entry was shown.
- The function body ensures a parent row in `wallets`, upserts `wallet_assets` using `ON CONFLICT (user_id, asset_symbol)`, then inserts a compact `ledger_entries` row with `type='deposit'` and returns the new balance.

Critical gaps in the body:
1. It accepts caller-supplied user, asset, and amount without validating positive/non-zero amount, canonical asset/network, verified chain evidence, confirmations, deposit ownership, transaction/output identity, or a durable idempotency/reference key.
2. Its ledger entry has no `reference_id` or chain/network metadata. Therefore the deposit-reference uniqueness guard cannot prevent repeated calls to this function from crediting the same on-chain event twice.
3. It is a generic balance mutation exposed to `service_role`; safety depends entirely on every privileged caller. A compromised or incorrectly authorized server-side caller could credit arbitrary accounts/amounts.
4. The parent `wallets` existence check followed by INSERT can race unless a suitable unique constraint and conflict path are present. The later `wallet_assets` upsert is concurrency-aware, but does not make the credit idempotent.
5. The function writes to `wallet_assets` while other parts of the application may use different balance stores. The authoritative balance/reconciliation model remains unresolved.

Disposition: keep this function unavailable to untrusted roles and do not use it as the replacement deposit processor. Do not revoke or modify privileges in isolation without auditing all trusted callers and checking live job dependencies. The function body itself does not independently establish that a deposit is verified.

## 2. `credit_onchain_deposit(text,text,numeric,text,text)` — LEGACY UNSAFE PATH, ALREADY NOT GRANTED TO SERVICE ROLE

Live catalog facts:
- SECURITY DEFINER = true, empty `search_path` setting.
- ACL snapshot lists `postgres` and `supabase_auth_admin`, not `service_role`, `anon`, or `authenticated`.

Body issues:
- It finds an address owner by address/network, but trusts caller-supplied transaction hash, amount, asset, and network; it does not prove chain confirmation or transfer details.
- Duplicate detection checks only exact `tx_hash`, not canonical network plus output/log index. This can incorrectly collide across networks and fail to deduplicate multiple outputs in one transaction.
- It marks the deposit `COMPLETED` immediately, credits the separate `balances` store, and writes to `financial_ledger`; these stores/contracts differ from the currently reviewed compact `ledger_entries` and `wallet_assets` paths.
- No amount positivity/canonical-asset validation or evidence binding is performed in the body.

Disposition: keep contained. Do not restore execution permissions.

## 3. `record_platform_ledger_entry(...)` — IDEMPOTENT PLATFORM JOURNAL, NOT A USER-BALANCE CREDIT

Live catalog facts:
- SECURITY DEFINER = true; `search_path=public, pg_temp`.
- EXECUTE ACL snapshot includes `service_role`, `postgres`, and `supabase_auth_admin`, not `anon` or `authenticated`.
- It validates nonblank idempotency key, entry type, asset code, positive amount, and CREDIT/DEBIT direction. It inserts into `platform_ledger_entries` with `ON CONFLICT (idempotency_key) DO NOTHING`, then compares core fields against the existing row before returning it or raising an idempotency conflict.
- It does not call `credit_user_balance`; catalog source search found `credit_onchain_deposit` as the only public function body directly referencing `credit_user_balance`, and no public function body directly referencing `record_platform_ledger_entry`.

Risk/limitation:
- A platform journal entry does not itself prove on-chain evidence or update user spendable balance. Its safety still depends on the caller's authorization and trustworthy event construction.
- Existing-key comparison does not compare metadata; callers must not treat metadata-only differences as a new financial event.

## 4. Caller inventory and limits

- GitHub code search for these function names returned no matches on the repository's default-branch search endpoint. This is not proof that no caller exists: it may not cover the working branch, generated code, SQL migrations, deployment configuration, or remote jobs.
- Live database body search found one direct public SQL-function reference to `credit_user_balance`: `credit_onchain_deposit(text,text,numeric,text,text)`.
- No direct public SQL-function reference to `record_platform_ledger_entry` was found.
- No functions were invoked. No source code, balances, ledger rows, schema, or privileges were changed. No build or automated tests were run.

## 5. Recommended next step

Before any deposit-credit restoration, trace every server-side caller and scheduled/edge worker across the working branch and deployed jobs. Then design one evidence-bound deposit-credit RPC that derives amount/asset/owner from a canonical verified chain observation, uses network + transaction + output/log identity for idempotency, updates the authoritative balance and user ledger atomically, and rejects mismatched replays. Keep current legacy entrypoints contained until that path passes staging tests and independent reconciliation checks.
