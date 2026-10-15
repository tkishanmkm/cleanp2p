# Trade escrow fee migration — staging validation plan

Migration under test: `supabase/migrations/20261015203000_restore_platform_trade_fee_accounting_legacy_schema.sql`

**Safety:** run only against a disposable staging clone. Do not run settlement mutations against production to test them. The migration has not yet been applied or executed in PostgreSQL as part of this plan.

## Preflight

1. Restore a recent schema-only/data-masked clone, or create a disposable Supabase staging project with the same legacy schema.
2. Confirm the schema matches the migration assumptions:
   - `trades.buyer_id` and `trades.seller_id` are text containing UUID-formatted user IDs.
   - `wallet_assets` has `user_id`, `asset_symbol`, `balance`, `in_escrow`.
   - `ledger_entries` has the legacy columns used by the function (`user_id`, `crypto`, `asset`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `status`).
   - `platform_ledger_entries` has `entry_type`, `asset_code`, `amount`, `direction`, `related_user_id`, `ref_table`, `ref_id`, `idempotency_key`.
   - `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)` exists.
3. Apply the migration to staging in a transaction-capable SQL runner and capture the complete result. If any statement fails, stop and discard/reset the staging clone before retrying.
4. Verify the deployed function's definition and grants; expected caller access is limited to trusted server/service role paths, not anon/authenticated direct execution.

## Test fixtures

Create isolated buyer and seller users with UUID-formatted IDs, plus one supported asset. Seed wallet balances and trade rows using the exact status values and escrow conventions required by the existing application. Record all initial wallet and ledger values before each case. Never reuse fixtures across cases without resetting them.

## Required cases

| Case | Action | Expected result |
|---|---|---|
| Normal settlement with positive fee | Release a valid paid, undisputed eligible trade | Success; seller escrow decreases by crypto amount + fee; buyer balance increases by crypto amount; exactly one matching platform fee CREDIT entry exists |
| Zero fee | Release a valid eligible trade with fee 0/null | Success; no platform fee ledger entry is created |
| Negative fee | Attempt eligible trade with negative fee | Error; transaction rolls back all wallet, ledger, and trade mutations |
| Insufficient escrow | Attempt settlement where seller escrow is below crypto amount + fee | Error; all state unchanged |
| Duplicate retry | Call release again after successful settlement | Idempotent success; no additional user ledger entries or platform fee entries |
| Fee ledger mismatch | In staging only, alter the expected idempotency entry's asset/amount/direction/ref and retry | Error; no further balance mutation |
| Completed trade missing fee row | In staging only, remove the fee entry for a completed positive-fee trade and retry | Error indicating inconsistent financial state; no balance mutation |
| Invalid participant UUID | Attempt with malformed seller ID in a disposable fixture | Error; no balance, ledger, or trade state mutation |
| Concurrent release | Submit two release calls concurrently for the same trade | One settlement only; final wallet and ledger totals match a single release |
| Rollback on ledger failure | Force the platform ledger helper to fail in staging | Entire settlement rolls back, including wallet and legacy ledger changes |
| Authorization | Call with wrong caller, anonymous session, and unauthorized role | Rejected; no state mutation |
| Asset/amount boundaries | Try null/zero crypto amount and unusual numeric precision consistent with schema | Rejected or handled according to documented business rules; no inconsistent ledger totals |

## Assertions after each case

- Compare buyer and seller `wallet_assets` before/after values.
- Count legacy `ledger_entries` for `trade_rel_buyer:<trade-id>` and `trade_rel_seller:<trade-id>`.
- Count platform ledger rows for `pf_p2pfee_<trade-id>`; positive-fee successful settlement must have exactly one matching row.
- Confirm trade status, escrow status, completion/release timestamps, and dispute resolution state.
- Confirm failed cases leave all related rows unchanged.
- Capture SQL output, function definition, grants, and test evidence in the PR.

## Exit criteria

Do not call this production-ready until every required case passes on staging, the migration is reviewed, the repository CI is green, and a rollback/recovery plan exists. Do not deploy this migration to the live project as part of this checklist.
