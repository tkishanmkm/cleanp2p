# Step 36T — Ledger entry writer/reader dependency inventory

Date: 2026-10-14  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only inventory; no SQL, code, balance, or ledger mutations.

## Executive finding

**Do not attempt to repair the withdrawal ledger mismatch by simply adding columns or loosening the type constraint.** The live `public.ledger_entries` schema observed in Step 36S is the compact legacy contract (`id, user_id, crypto, amount, type, reference_id, balance_after, metadata, created_at, asset, chain, status`). Live withdrawal settlement/refund functions reference a different expanded contract (`wallet_id, asset_code, delta_available, delta_locked, available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key`) and use entry types that the current check constraint does not allow. A schema-only patch could make one writer run while leaving other financial paths inconsistent.

## Live database function inventory

Read-only catalog query found these public functions whose function source references `ledger_entries`:

- `admin_adjust_balance(uuid, uuid, text, text, numeric, text)`
- `cancel_p2p_trade(uuid, uuid, text)`
- `complete_onchain_withdrawal(uuid, text, numeric, text)`
- `complete_trade(uuid)`
- `complete_trade_atomic(uuid)`
- `credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer)`
- `credit_user_balance(uuid, text, text, numeric)`
- `execute_internal_transfer(uuid, text, text, numeric, text)`
- `expire_p2p_trade(uuid)`
- `initiate_trade_with_escrow(text, numeric, numeric, text, numeric, text, text, text, uuid)`
- `process_confirmed_deposit(uuid)`
- `process_deposit_atomic(text, text, text, numeric, text, integer, bigint, text, text, integer, text)`
- `process_external_withdrawal(uuid, text, text, numeric)`
- `process_failed_withdrawal(uuid, text, numeric, text, boolean)`
- `process_incoming_deposit(text, text, text, numeric, text, integer)`
- `process_user_deposit(uuid, uuid, text, text, numeric, text, text, integer)`
- `record_platform_ledger_entry(text, text, numeric, text, uuid, text, text, text, text, text, jsonb)`
- `refund_custodial_withdrawal(uuid, text)`
- `refund_reverted_custodial_withdrawal(uuid, text, text)`
- `release_escrow_to_buyer(uuid)`
- `release_trade_escrow(uuid, uuid)`
- `request_custodial_withdrawal(uuid, text, text, text, numeric, numeric, text)`
- `request_withdrawal(uuid, text, text, numeric, numeric, text, numeric)`

This is a source-reference inventory, **not** a claim that every function is currently reachable or every branch has been executed. Each function's exact insert/update columns, execution ACL, idempotency behavior, and caller must be compared with the live table before any schema migration.

## Repository dependency surface identified

The active branch contains financial API and job surfaces that may read or write balances/history and must be included in the contract review:

- Wallet API: `app/api/wallet/route.ts`, `app/api/wallet/balance/route.ts`, `app/api/wallet/balances/route.ts`
- Deposit APIs/history: `app/api/wallet/deposit/route.ts`, `app/api/wallet/deposit-address/route.ts`, `app/api/wallet/deposit-addresses/route.ts`, `app/api/wallet/history/deposits/route.ts`, `app/api/wallets/deposit-address/route.ts`, `app/api/wallets/provision-address/route.ts`
- Withdrawal APIs/history: `app/api/wallet/withdraw/route.ts`, `app/api/wallet/history/withdrawals/route.ts`
- Transfer APIs/history: `app/api/wallet/transfer/route.ts`, `app/api/wallet/history/transfers/route.ts`
- Reconciliation: `app/api/cron/reconcile-ledger/route.ts`
- UI balance/history consumers include `app/(dashboard)/wallets/page.tsx`, `components/wallet/TransactionHistory.tsx`, `components/wallets/TransactionHistory.tsx`, and `hooks/useUserWallet.ts` / `hooks/useUserWallets.ts`
- Worker surface: `jobs/withdrawalWorker.ts`

The GitHub code-search endpoint returned no indexed matches for `ledger_entries`, so that empty result was not treated as proof that the repository has no additional references. This step identified the likely wallet/financial surface from the branch tree; full file-by-file query and column-contract verification remains necessary before implementation.

## Known live contract incompatibilities carried forward from Step 36S

1. The live table lacks columns referenced by withdrawal settlement/refund functions.
2. The live `ledger_entries_type_check` permits `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`, but settlement/refund logic uses `withdrawal_complete` and `withdrawal_refund`.
3. `wallet_assets` has nullable `balance`, `locked_balance`, `in_escrow`, and `in_withdrawal`; a future ledger reconciliation must define null handling explicitly.
4. The previously observed zero row counts in the two withdrawal tables do not prove that ledger entries, wallet balances, deposits, escrow, or off-chain liabilities reconcile.

## Safe next action

Continue read-only review of the exact source definitions for the listed live functions and each repository API/worker consumer. Build a compatibility matrix covering: writer columns, allowed `type` values, balance source of truth, transaction atomicity, idempotency key uniqueness, and reader expectations. Only then propose a migration strategy. Do not execute settlement/refund RPCs or alter production ledger data as part of the audit.

## Verification status

- Read-only live function source-reference inventory: completed.
- Active-branch wallet/financial path inventory: completed at path level.
- Full per-function insert/update contract comparison: pending.
- Full per-file reader/writer scan: pending (code-search indexing was unavailable/incomplete).
- Production SQL/code changes: none.
- Runtime tests/build: not run.
