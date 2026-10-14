# Refund authorization boundary — Step 36O

## Audit result
Production `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)` is a SECURITY DEFINER function. Execute privilege is denied to `anon` and `authenticated`, and granted to `service_role` and `postgres`.

The function's refund decision nevertheless trusts `p_is_verified_unbroadcast`. The current worker calls this function with `p_is_verified_unbroadcast: true` on its local/pre-broadcast error path. The database does not independently verify the claimed no-broadcast fact.

## Safe handling decision
Do not make an untested production SQL change. A proposed worker change to remove automatic use of this RPC was blocked by repository write safety checks. No code or database change was made in this step.

## Required remediation
1. Replace the caller-controlled Boolean with a database-enforced state/evidence contract.
2. Make refund authorization atomic with locking the withdrawal row, checking the persisted transaction hash and dispatch state, and preventing double refunds.
3. Define an explicit manual reconciliation route for uncertain broadcast outcomes.
4. Test valid pre-broadcast refunds, concurrent retries, hash-present withdrawals, hashless ambiguous broadcasts, and already completed/failed withdrawals in staging.
5. Apply the migration only after review and staging verification.

## Impact
No wallet balances, withdrawal rows, ledger entries, production SQL, or code were changed by this audit step.
