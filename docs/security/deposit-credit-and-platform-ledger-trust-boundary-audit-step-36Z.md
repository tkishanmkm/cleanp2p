# Step 36Z — Live Deposit Credit and Platform Ledger RPC Trust-Boundary Audit

Date: 2026-10-14  
Environment: production Supabase project `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Repository branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only review of live definitions, ACL snapshots, and obvious in-database callers for `credit_user_balance`, `record_platform_ledger_entry`, and the related legacy `credit_onchain_deposit`. No RPCs were executed and no database rows, balances, schema, or privileges were changed.

## Results

### 1. `credit_user_balance(uuid,text,text,numeric)`

- SECURITY DEFINER, owner `postgres`, empty pinned search path.
- ACL snapshot: `postgres`, `service_role`, and `supabase_auth_admin` have EXECUTE; no direct `anon` or `authenticated` grant appeared.
- Adds `credit_amount` to `wallet_assets.available` via upsert and inserts a `deposit` row in compact `ledger_entries`.
- The function itself does not establish verified on-chain evidence, check a canonical deposit record, bind the credit to a transaction/output/network idempotency key, or verify that the caller is an authorized deposit processor. It accepts a user UUID, asset, network and amount. Therefore, it is a privileged balance-credit primitive, not a safe public deposit endpoint. Any privileged caller must independently prove verified evidence and ensure atomic deduplication before invoking it.
- It also creates a parent `wallets` row if none exists. That insert and the balance/ledger changes are transactional within the function call, but the function does not provide deposit-specific idempotency.

### 2. `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

- SECURITY DEFINER, owner `postgres`, pinned search path `public, pg_temp`.
- ACL snapshot: `postgres`, `service_role`, and `supabase_auth_admin` have EXECUTE; no direct `anon` or `authenticated` grant appeared.
- Validates nonblank idempotency key, entry type and asset; requires positive amount and direction `CREDIT` or `DEBIT`.
- Inserts into `platform_ledger_entries` using the unique idempotency key and rejects reuse when core event fields differ.
- Positive: this function records a platform accounting entry and implements idempotent replay checks. It does not itself change a user's wallet balance or verify chain evidence; its metadata is not included in the replay-field comparison. Callers still must be trusted and event semantics must be validated upstream.

### 3. Related legacy function: `credit_onchain_deposit(text,text,numeric,text,text)`

- SECURITY DEFINER, empty pinned search path.
- ACL snapshot lists only `postgres` and `supabase_auth_admin` with EXECUTE; no `service_role`, `anon`, or `authenticated` grant appeared.
- Definition locates a user by address/network, checks whether any `onchain_deposits` row has the same `tx_hash`, inserts a completed deposit, credits a separate `balances` store and writes to a separate `financial_ledger`.
- The existence check is keyed only by transaction hash, not network/output index; it is not an atomic check-and-insert by itself. It also trusts supplied address, amount, asset and network without showing chain-verification evidence in this function.
- This legacy path uses `balances` and `financial_ledger`, while the current compact-ledger credit function uses `wallet_assets` and `ledger_entries`. The authoritative wallet store is therefore still unresolved. Do not reactivate this function or grant access to it as a workaround.

## Caller inventory and limitations

- A production database function-source scan found `credit_onchain_deposit` as the only other public function whose definition text referenced `credit_user_balance` or `record_platform_ledger_entry`; it did not establish a direct call from the two inspected functions themselves.
- GitHub code search for the two exact function names returned no results on the repository's default-branch search index. This is not proof that the working branch or deployed application has no callers; GitHub's code search can miss results and the search is indexed on the default branch.
- No end-to-end caller chain was proven from deposit watcher to evidence verification to credit RPC. This remains a production blocker.
- The live ACL results are a point-in-time snapshot. SECURITY DEFINER alone does not imply public execution; actual ACL and caller authorization matter.

## Risk assessment

**Do not launch deposit crediting based on these findings alone.** The legacy unverified deposit RPCs were previously contained in Steps 35X/35Z. Keep that fail-closed containment in place until a replacement pipeline is traced and tested end to end. Pending deposits are safer than unverified credits.

## Next step

Trace the actual application and worker call sites on `fix/retire-unverified-deposit-entrypoints`, then map each deposit source through chain confirmation, canonical transaction/output/network deduplication, user/address binding, atomic credit and ledger recording. Only after the trace and tests are complete should a narrowly scoped migration or code fix be proposed. Do not grant broad EXECUTE privileges or change live financial functions based solely on this audit.

## Change record

- Audit only; no production database changes.
- No RPC was executed.
- No wallet balance or ledger row was changed.
