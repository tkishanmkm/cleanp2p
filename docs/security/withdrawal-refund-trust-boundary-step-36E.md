# Step 36E — Withdrawal refund trust-boundary containment

Date: 2026-10-14
Repository: `tkishanmkm/cleanp2p`
Branch: `fix/retire-unverified-deposit-entrypoints`

## Audit findings

Production function privilege inspection confirmed `process_failed_withdrawal(uuid,text,numeric,text,boolean)` is executable by `service_role`, not `anon` or `authenticated`. The function trusts `p_is_verified_unbroadcast` to bypass transaction-hash/broadcast-stage refund protections. The worker passed this flag as `true` when its confirmation checker observed a TRON unsuccessful result or EVM receipt status 0. The database function does not independently validate chain evidence or bind that evidence to the stored hash.

The TRON helper's `success=false` result may also mean a transaction is not yet verifiably successful; it must not automatically trigger a refund.

## Fix committed

The confirmation worker no longer calls `process_failed_withdrawal(..., p_is_verified_unbroadcast: true)` for observed TRON unsuccessful/unknown outcomes or EVM reverted receipts. It instead quarantines both withdrawal rows as `AMBIGUOUS_BROADCAST`, checks each update result, records the reason, and leaves the reserved funds untouched pending controlled reconciliation.

Commit: `6607a8392d894fffeb12bcb2f3b43889a367f79d`

## Limitations / next work

- This is conservative containment, not the final refund solution. It can leave funds reserved until an operator or a future transaction-bound settlement mechanism resolves the case.
- The pre-broadcast local validation branch still calls `process_failed_withdrawal` with the boolean set to true. That path should only be used when the code can prove no broadcast attempt occurred; future refactoring should encode this distinction in a narrower database API rather than a general caller-supplied boolean.
- The existing `AMBIGUOUS_BROADCAST` checker may revisit rows; monitoring and query semantics need additional review to avoid repeated noisy alerts.
- No production database migration or financial-row update was applied.
- Build, typecheck, and automated/end-to-end tests were not run.
- Withdrawal and wallet production readiness remains unconfirmed.

## Production privilege check

Live database inspection showed the refund RPC is denied to `anon` and `authenticated` and allowed to `service_role`. This limits direct client invocation but does not remove the trust-boundary weakness inside privileged worker code.
