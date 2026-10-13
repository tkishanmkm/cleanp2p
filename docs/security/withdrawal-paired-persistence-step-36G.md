# Withdrawal paired persistence guard — Step 36G

Date: 2026-10-14
Repository: `tkishanmkm/cleanp2p`
Branch: `fix/retire-unverified-deposit-entrypoints`

## Audit finding

In both TRON and EVM dispatch paths, the worker checked whether `onchain_withdrawals` persisted the transaction hash but ignored the result of the subsequent `withdrawals` update. A database error on the second update could leave the legacy row stale while the worker returned a successful broadcast result.

## Fix committed

The worker now checks the returned Supabase error from both legacy-row updates. If persistence fails after the on-chain hash has been saved, it throws into the existing ambiguous-broadcast containment path instead of reporting a normal successful dispatch. The on-chain hash remains available for confirmation/reconciliation, and the code does not issue a second payout or refund.

Code: `src/jobs/withdrawalWorker.ts`
Commit: `1f11c7031675999953b06c7b4c57bf731c18a2c0`

## Limits / remaining work

- This is a detection and containment improvement, not an atomic two-table transaction. A database RPC/transaction is still preferable for consistency.
- Hashless stale `PROCESSING` reconciliation, sender/nonce chain reconciliation, and database settlement-function verification remain open from Step 36F.
- No production SQL, withdrawal rows, balances, or ledger records were changed.
- Build, typecheck, and tests were not run; runtime behavior is not yet test-verified.
- Production readiness is not confirmed.
