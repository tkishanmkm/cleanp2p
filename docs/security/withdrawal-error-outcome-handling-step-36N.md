# Withdrawal error-outcome handling — Step 36N

## Scope
Harden the withdrawal worker's pre-broadcast refund result handling and ambiguous-broadcast status persistence.

## Changes
- Checks the Supabase RPC `error` returned by `process_failed_withdrawal` instead of assuming the call succeeded because it did not throw.
- Requires an explicit JSON result with `success === true` before reporting a refund as confirmed.
- Returns `REFUND_RECONCILIATION_REQUIRED` when the refund outcome is an error or lacks explicit success; this avoids falsely reporting a refund.
- Checks returned Supabase errors for both on-chain and legacy status updates when containing an ambiguous broadcast result.

## Safety notes
- No production SQL was changed.
- No wallet balances, withdrawal rows, or ledger rows were changed by this code edit.
- The existing `p_is_verified_unbroadcast: true` trust-boundary issue remains open and must be fixed in a separate database-backed step. This change improves outcome reporting but does not prove the transaction was never broadcast.
- No build, typecheck, or automated tests were run.

## Commit
Worker update: `19d6c608ca819ccd00a9c160165d51eb2bfd29ea`
