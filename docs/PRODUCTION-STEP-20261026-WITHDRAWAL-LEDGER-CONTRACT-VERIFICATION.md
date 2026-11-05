# Paxones Stage 20 — Withdrawal and ledger live-contract verification (2026-10-26)

## Read-only live production facts

Project: `eaiwgfxoiwxepinvcykg` (`paxonesflows`). No writes were performed.

### `public.onchain_withdrawals`
- Live table has `idempotency_key TEXT NOT NULL`, no default.
- The local migration history and all reachable Git refs searched in this stage did not reveal a migration adding this column to `public.onchain_withdrawals`.
- Live `public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)` body MD5: `64c72eef3e65e2c9c3b419f886f41c60`.
- The body was previously inspected and omits `idempotency_key` from the `onchain_withdrawals` insert. Expected normal requests to fail at that insert, rolling back earlier statements in the same function transaction; no live request was attempted.

### `public.ledger_entries`
The current live table contains only these columns: `id`, `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `created_at`, `asset`, `chain`, `status`.
It does not contain the canonical-ledger columns `wallet_id`, `asset_code`, `delta_available`, `delta_locked`, `available_after`, `locked_after`, `entry_type`, `ref_table`, `ref_id`, or `idempotency_key`.

Live `complete_onchain_withdrawal(uuid,text,numeric,text)` body MD5: `f53b21c218775de52f1dfb11163275bd`; body references `wallet_id` and `idempotency_key` in the ledger logic. Live `process_failed_withdrawal(uuid,text,numeric,text,boolean)` body MD5: `2e4fc4171a76b121e2ff0e9760a821a1`; it also references `wallet_id` and `idempotency_key` in its ledger logic. Their settlement/refund ledger writes therefore remain incompatible with the observed live ledger table contract and are expected to fail if those paths reach those statements. No settlement or refund RPC was invoked.

### Other wallet integrity concern
`wallet_assets.balance`, `locked_balance`, `in_escrow`, and `in_withdrawal` are nullable in production. `reserved_balance` is NOT NULL. All financial write paths must be reviewed to ensure null-safe arithmetic and invariant enforcement; this is not repaired in this stage.

## Historical provenance search

- Searched every locally reachable Git ref for `onchain_withdrawals.idempotency_key`, `ADD COLUMN idempotency_key`, and matching migration patterns; no authoritative DDL was found.
- Confirmed `origin/security/02-7-align-withdrawal-rpcs-to-live-schema` does not supply the missing column migration; its withdrawal insert definitions still omit the column.
- Existing historical audit `docs/security/withdrawal-ledger-liability-reconciliation-step-36S.md` documents the ledger/function mismatch from 2026-10-14. This is recurring drift, not a new safe basis for a speculative hotfix.

## Decision

**Do not deploy the Stage 18 candidate yet.** The database contract is wider than one missing column: the settlement/refund functions and the live ledger schema disagree. Patching only the reservation insert would leave completion/refund broken. The exact production migration history and authoritative ledger design must be reconciled first.

## Required next actions
1. Export read-only DDL for production withdrawal/ledger tables, constraints, indexes, triggers, and the relevant RPCs, with grants and hashes.
2. Inventory every ledger writer/reader and decide whether the legacy ledger (`crypto/amount/type/reference_id/balance_after`) or canonical double-entry ledger is authoritative. Do not add columns blindly.
3. Recover missing applied migration SQL from Supabase migration history/backup/source commits or other authoritative records; record unresolved entries explicitly.
4. Build a disposable database from a reconciled schema and run migration + transaction integration tests for reservation, settlement, refund, replay, and rollback.
5. Only then replace the provisional Stage 18 patch with a complete, tested forward migration sequence.

## Safety and test status
No production SQL, financial RPC, or test withdrawal was executed. No commits, pushes, or deployments were made. The Stage 18 migration remains an unvalidated candidate. This report is audit-only.
