# Paxones Stage 26 — Escrow release and reconciliation audit

Date: 2026-10-26. Source inspection only; no financial operations executed.

## Finding 1: Escrow release has a post-broadcast persistence gap

`src/lib/p2p/escrowService.ts`, `P2PEscrowService.releaseTradeEscrow()`:

1. Reads a `p2p_trades` row and checks `status === 'PAYMENT_MARKED'`.
2. Resolves the buyer destination using multiple fallback address tables.
3. Calls `executeHotWalletWithdrawal()` to broadcast an on-chain transfer.
4. Attempts to update the trade to `COMPLETED` and store `release_tx_hash`.
5. Does not inspect the update's returned `error` and returns success even if persistence failed.

This is a critical consistency risk. If the chain broadcast succeeds but the database update fails, the trade may remain `PAYMENT_MARKED`; a retry may broadcast a second transfer. A database update after broadcast cannot make the chain action atomic. The operation needs a durable pre-broadcast release intent/idempotency key, a per-trade lock/state transition, tx-hash persistence and recovery for ambiguous outcomes, and confirmation-aware completion. The app must not blindly retry a transfer if the first broadcast outcome is uncertain.

Destination resolution also falls back across `deposit_addresses`, `user_deposit_addresses`, and `user_wallets` without a network/asset-specific selection contract visible in this service. That requires review before a replacement is enabled.

## Finding 2: Financial reconciliation reads a schema it does not match

`src/lib/security/reconciliation.ts` selects `wallet_assets.wallet_id`, `asset_code`, `available`, `locked_escrow`, and `locked_withdrawal`, and selects `ledger_entries.wallet_id`, `asset_code`, `delta_available`, `delta_locked`. The observed production `ledger_entries` schema does not have those canonical columns. The function throws when either query errors, but its later alert/snapshot persistence catches and ignores Supabase returned errors because only thrown exceptions are caught; Supabase generally returns `{ error }` instead of throwing.

Its ledger sum is a sum of `delta_available + delta_locked` across entries, then compared to the current total wallet balance. This formula is only valid if entries are complete signed deltas from a zero opening balance and all migrations/history conform; that has not been proven. The function also labels a discrepancy as a critical anomaly and attempts to persist it. It must not be used to auto-freeze or make irreversible decisions until the schema and accounting equation are validated.

## Containment status

The local `src/app/api/cron/reconcile-ledger/route.ts` is currently fail-closed (503 after cron authorization) while the accounting model is unresolved. That route containment does not itself prove that `runFinancialReconciliation()` has no other callers.

## Required remediation order

1. Implement a durable escrow release state machine: `PAYMENT_MARKED` -> locked `RELEASE_REQUESTED`/`BROADCASTING` with idempotency key -> persist tx hash/ambiguous state -> confirm chain -> `COMPLETED`. Use a trusted database RPC to atomically claim one release attempt; never hold a DB transaction open during a chain RPC.
2. Make the broadcast worker idempotent and recoverable after process/network timeout. Do not broadcast again for an existing intent unless chain/provider evidence proves the previous attempt was not sent.
3. Check every Supabase result's `.error`; do not return success when a required state update fails. Persist failures to a durable queue/outbox and alert.
4. Bind buyer address to the trade's selected network and asset; reject ambiguous or missing address records instead of choosing the first row from unrelated address tables.
5. Reconcile the production table/function schema and the local migration chain; implement a read-only report first, using opening balances and all signed ledger movements, and validate against synthetic histories in a disposable database.
6. Inventory every caller of `runFinancialReconciliation()` before re-enabling any route or scheduler.

## Safety and verification

This was a source audit only. No hot-wallet transaction, financial RPC, production SQL mutation, commit, push, or deployment was performed. Existing cron reconciliation containment remains local and must be tested with the focused regression suite before release.
