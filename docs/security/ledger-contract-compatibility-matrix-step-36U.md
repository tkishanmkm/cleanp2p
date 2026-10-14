# Step 36U — Live ledger contract compatibility matrix

Date: 2026-10-14  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only production catalog/function audit. No SQL or application changes.

## Executive result

The live ledger is not governed by one consistent contract. The table `public.ledger_entries` has a compact legacy schema, while several live financial RPCs use an expanded per-wallet delta schema. The live type constraint only allows `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`. A second table, `platform_ledger_entries`, has a separate platform-accounting contract with its own idempotency key.

**Production readiness: BLOCKED for withdrawal settlement/refund until the schema/function mismatch and balance-source-of-truth question are resolved.** Do not fix this by adding columns or changing the check constraint in isolation.

## Live schema facts verified

### `public.ledger_entries`
Columns: `id uuid NOT NULL`, `user_id uuid NOT NULL`, `crypto text`, `amount numeric NOT NULL`, `type text NOT NULL`, `reference_id text`, `balance_after numeric`, `metadata jsonb`, `created_at timestamptz`, `asset text`, `chain text`, `status text`.

Constraints/indexes observed:
- Primary key on `id`.
- Check constraint only allows types: `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, `fee`.
- Unique partial index `idx_ledger_entries_deposit_ref` on `reference_id` for `type = 'deposit'` and non-null references.
- No `idempotency_key` column or unique index on that key in this table.

### `public.platform_ledger_entries`
Separate table with `entry_type`, `asset_code`, `amount`, `direction`, `related_user_id`, `ref_table`, `ref_id`, `network_code`, `tx_hash`, `metadata`, and required `idempotency_key`. The live `record_platform_ledger_entry` function implements conflict detection against that table. It is not a drop-in replacement for user wallet ledger entries.

### Balance stores
Live columns exist across `wallet_assets`, `user_wallets`, and `wallets`. These are different contracts, with different fields and nullability. For example, `wallet_assets.balance`, `locked_balance`, `in_escrow`, and `in_withdrawal` are nullable; the corresponding `user_wallets.balance` and `locked_balance` are not nullable. The catalog alone does not establish which table is authoritative for each flow or prove balances reconcile.

## Live function inventory and compatibility notes

A catalog scan found 24 public function definitions with source referencing `ledger_entries`; all listed definitions reported `SECURITY DEFINER`. This is a function-source inventory, not proof that every function is callable by every role or that every branch executes.

### Clearly mismatched withdrawal writers
- `complete_onchain_withdrawal(uuid, text, numeric, text)`
- `process_failed_withdrawal(uuid, text, numeric, text, boolean)`

Their live source inserts `wallet_id`, `asset_code`, `delta_available`, `delta_locked`, `available_after`, `locked_after`, `entry_type`, `ref_table`, `ref_id`, and `idempotency_key`. Those columns are absent from the observed `ledger_entries` table. The refund function uses `withdrawal_refund`, and settlement uses `withdrawal_complete`; neither type is accepted by the live check constraint. These are direct compatibility blockers.

### Compact-schema writers (examples)
- `process_deposit_atomic(...)` inserts compact fields including `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `asset`, `chain`, and `status`; this aligns with the live table shape.
- Other deposit functions, trade escrow functions, transfer functions, admin adjustments, and withdrawal request functions also reference the ledger. Their exact branch-by-branch contract and behavior still need individual review before any migration.
- `process_deposit_atomic` reads existing entries by deposit reference and validates the existing row, while the unique partial deposit-reference index provides a DB-level guard for that specific class of entry.
- The compact ledger has no general idempotency-key uniqueness contract. Do not assume conflict handling on a key is possible on this table just because other ledger functions use that pattern.

### Platform ledger
- `record_platform_ledger_entry(...)` writes to `platform_ledger_entries`, not `ledger_entries`, and verifies that an existing idempotency-key row matches the requested accounting event. This is a separate journal and must be reconciled as a separate contract.

## Risk summary

1. **Critical — withdrawal settlement/refund writes cannot match live table columns and type constraint.** The affected RPCs may fail when reaching ledger insertion. No live invocation was attempted.
2. **High — mixed ledger contracts.** Compact user-ledger, expanded delta-style withdrawal writers, and platform ledger have not been proven consistent.
3. **High — multiple balance stores.** The source of truth and reconciliation invariants across `wallet_assets`, `user_wallets`, and `wallets` must be explicitly documented and verified.
4. **High — incomplete idempotency protection on compact ledger.** Only deposit reference has a relevant unique partial index; there is no general idempotency-key field/index on the live compact table.
5. **High — SECURITY DEFINER inventory needs ACL/caller review.** All 24 scanned definitions are security definer, but no blanket revoke is recommended without mapping callers and effective privileges.
6. **Not proven — application readers.** GitHub path-level inventory identifies the wallet APIs, history endpoints, worker, and reconciliation job; full line-by-line code search was not completed because the repository search index did not return dependable results and the contents endpoint did not resolve the known non-default ref. Do not infer that no other readers exist.

## Safe next action

Continue with a focused read-only source review of the active branch by fetching files through the Git tree/blob SHA and compare each function and caller. Then define one canonical user-ledger contract and migration sequence that preserves historical records, balances, and idempotency. Before any production DDL, require a reconciliation plan covering user balances, escrow, withdrawals, deposits, fees, and platform-ledger entries. Do not run withdrawal settlement/refund RPCs as tests against production.

## Verification status
- Live table columns, constraints, indexes, and balance-store schemas: checked read-only.
- Function-source compatibility scan: checked read-only.
- Withdrawal mismatch: confirmed from live schema and function source.
- Production data or schema changes: none.
- Build/tests: not run.
