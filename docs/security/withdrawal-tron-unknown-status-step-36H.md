# Withdrawal TRON Unknown-Status Handling — Step 36H

## Audit finding
The TRON confirmation helper returned `success: false` when transaction information was missing or the provider call failed. The worker interpreted any falsy `success` as an unsuccessful transaction and moved it to `AMBIGUOUS_BROADCAST`. A temporary explorer/RPC outage or a transaction not yet indexed could therefore be misclassified as an on-chain failure.

## Change
- Represent unknown execution status as `null`, distinct from explicit failure.
- Treat confirmation depth separately from execution status.
- Quarantine only when the transaction has reached configured confirmation depth and the provider reports an explicit non-success receipt result.
- Keep successful settlement gated on `isConfirmed && success`.

## Safety and limitations
- Code-only change on `fix/retire-unverified-deposit-entrypoints`.
- No production SQL, wallet balances, withdrawals, or ledger rows changed.
- Build/typecheck/tests were not run in this step.
- This does not resolve hashless ambiguous broadcasts, stale PROCESSING recovery, or atomic paired-row settlement. Production readiness is not established.
