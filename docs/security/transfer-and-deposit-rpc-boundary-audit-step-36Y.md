# Step 36Y — Transfer transaction and deposit-credit RPC boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only catalog, ACL, index, and ledger-insert-contract review. No financial RPC was executed; no data or schema was changed.

## 1. Internal transfer transaction and uniqueness

Live `public.execute_internal_transfer(uuid,text,text,numeric,text)` is SECURITY DEFINER and is executable by `service_role`, not by `anon` or `authenticated` in the current privilege snapshot. It:
- requires a nonblank idempotency key;
- serializes same-sender/same-key requests with a transaction-scoped advisory lock;
- looks up a previous transfer by sender and key and compares a request fingerprint / core parameters;
- locks sender and recipient profiles in deterministic UUID order;
- checks emergency/platform controls, sender KYC, banned/restricted/non-active status and emergency freeze for both parties;
- updates `wallet_assets` and writes transfer plus ledger rows within one database function transaction.

The transfer table has unique `public_id` and primary-key indexes, and **two redundant unique partial indexes** covering the same `(sender_id, idempotency_key)` key when non-null:
- `transfers_sender_id_idempotency_key_unique`
- `uq_transfers_sender_idempotency`

The redundancy is not an immediate correctness defect, but adds write/storage overhead and makes schema management noisier. Do not drop either index without a migration review and confirmation of dependencies.

### Remaining transfer risks / checks
- The RPC is service-role-only, so every service-role caller must authenticate/authorize the sender correctly. The API route is one caller, not proof that all callers are safe.
- The RPC accepts a caller-supplied sender UUID for service-role calls; treat any other caller as a privileged trust boundary.
- Existing transfers with a NULL request fingerprint use fallback comparisons; verify historic data and rounding semantics before relying on this for every replay.
- Recipient wallet provisioning relies on the `wallet_assets(user_id, asset_symbol)` unique index. Concurrent attempts may race; the function needs a clear conflict/retry path if the `INSERT` loses the race. No concurrent test was run.
- Transfer ledger writes are compatible with the compact `ledger_entries` column contract and allowed `transfer` type. No RPC was invoked, so this is schema/source compatibility, not an end-to-end pass.
- Audit still needs to verify affected-row counts, transaction/ledger ordering, and failure handling throughout the complete function. Do not declare transfers production-ready yet.

## 2. Deposit-credit RPC privilege snapshot

Live function privilege checks show these legacy / alternative deposit functions are not executable by `anon`, `authenticated`, or `service_role` in the current snapshot:
- `credit_deposit_atomic(uuid,text,text,text,text,numeric,integer,integer)`
- `process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`
- `process_incoming_deposit(text,text,text,numeric,text,integer)`
- the three `process_user_deposit` SECURITY DEFINER overloads inspected, plus the non-definer overload

This matches a fail-closed containment posture: automatic credit through those signatures may not be available until an explicitly reviewed verified ingestion path is authorized. Do not restore privileges blindly.

The following functions were executable by `service_role` in the privilege snapshot:
- `credit_user_balance(uuid,text,text,numeric)`
- `execute_internal_transfer(...)`
- `record_platform_ledger_entry(...)`

`credit_user_balance` is a generic balance-credit capability and therefore deserves a separate trust-boundary audit of its body, all callers, and whether it can credit without independently proving a verified on-chain deposit. Its ledger insert uses compact-table fields, but schema compatibility does not establish that the function is safe to expose to callers. No function was invoked.

`process_confirmed_deposit(uuid)` was not executable by `service_role` in the same snapshot. Keep this contained unless and until a verified replacement and complete caller audit are approved.

## 3. Deposit deduplication indexes and ledger schema

Live indexes:
- `onchain_deposits` has a unique canonical index on `(lower(trim(tx_hash)), upper(trim(network)), output_index)`, supporting canonical chain-output deduplication.
- `ledger_entries` has a unique partial index on `reference_id` only for `type='deposit'` and non-null references, plus its primary key.
- `transfers` has the two duplicate unique sender/idempotency indexes noted above.

The reviewed deposit function bodies are not interchangeable:
- `process_deposit_atomic` and `credit_deposit_atomic` use compact ledger columns that are broadly compatible with the current table, but their privilege containment must remain until verified caller and evidence requirements are settled.
- `process_incoming_deposit` attempts to use `entry_type`, `asset_symbol`, and `idempotency_key` in `ledger_entries`, which are absent from the deployed compact schema. This is an incompatible legacy path even aside from its current execute privileges.
- The earlier steps already identified the withdrawal reservation and settlement/refund functions as having the same expanded-vs-compact ledger contract mismatch.

## 4. Recommended disposition

1. Keep legacy/alternate deposit-credit RPCs contained. Do not grant service-role execution as a quick fix.
2. Audit `credit_user_balance` and `record_platform_ledger_entry` callers before considering either safe for deposit-credit use.
3. Design one coordinated ledger contract migration covering all writers, readers, allowed event types, idempotency, indexes, reconciliation, and settlement/refund behavior. Do not solve one RPC in isolation.
4. Review the redundant transfer idempotency indexes as cleanup after correctness and migration coverage are proven.
5. Stage-test transfer replay, same-key/different-parameters conflict, concurrent first-time recipient wallet creation, banned/restricted/frozen accounts, insufficient balance, and rollback on ledger constraint failure before production sign-off.

## Verification / limitations

- Queried live function signatures, SECURITY DEFINER flags, and role EXECUTE privileges.
- Queried current indexes on `transfers`, `ledger_entries`, `onchain_deposits`, and `wallet_assets`.
- Compared ledger INSERT column lists for selected transfer/deposit functions against the deployed compact ledger schema.
- No RPCs executed, no user balances or ledger rows changed, no grants changed, and no migrations applied.
- No build, typecheck, or automated tests were run.
