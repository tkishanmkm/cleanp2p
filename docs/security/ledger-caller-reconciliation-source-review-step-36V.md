# Step 36V — Source-level ledger caller and reconciliation review

Date: 2026-10-14  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only review of active-branch wallet routes, withdrawal service/worker, and ledger reconciliation job. No production SQL or application logic changed.

## Files reviewed

- `src/app/api/wallet/deposit/route.ts` — direct deposit endpoint returns HTTP 410 and directs callers to verified chain ingestion.
- `src/app/api/wallet/withdraw/route.ts` — delegates to `executeCanonicalWithdrawal` in `src/lib/services/withdrawalService.ts`.
- `src/lib/services/withdrawalService.ts` — canonical withdrawal entrypoint; reviewed initial auth/profile/platform guard and validation structure. Full end-to-end service and RPC argument mapping still requires a dedicated pass.
- `src/jobs/withdrawalWorker.ts` — claims `onchain_withdrawals`, broadcasts, writes tx hash/status to both `onchain_withdrawals` and legacy `withdrawals`, and calls refund RPC for local pre-broadcast validation failures.
- `src/app/api/cron/reconcile-ledger/route.ts` — computes wallet balance from deposits, withdrawals and transfers, and automatically freezes wallets on discrepancies.
- `src/app/api/wallet/transfer/route.ts` — sender and recipient restrictions are checked in the API; recipient lookup includes profile, deposit-address, and Auth fallback paths. Full transfer RPC/ledger write path remains for follow-up.

## Findings

### Critical — withdrawal ledger contract mismatch remains a production blocker

The Step 36U live-schema finding remains unresolved: `complete_onchain_withdrawal` and `process_failed_withdrawal` reference expanded delta/idempotency columns absent from live `public.ledger_entries`, and use entry types not permitted by its check constraint. The worker depends on these RPCs for settlement/refund workflows. Do not run these RPCs as production tests and do not deploy an isolated constraint/column patch without reconciling all writers/readers and existing balances.

### High — reconciliation formula is not a complete ledger reconstruction

The current reconciliation job computes:

`deposits - withdrawals(amount + network_fee) + received transfers - sent transfers(amount + fee_amount)`

It does not include a proven opening balance, administrative balance adjustments, trade escrow/lock movements, fee-accounting events, or every possible ledger event. It also reads `user_wallets` while the withdrawal/deposit flows touch other balance stores. Therefore a reported difference may be a false positive or false negative; this job is not yet a reliable proof that the user ledger and balances reconcile.

### High — reconciliation query errors can be treated as zero activity

The job checks the error when reading `user_wallets`, but the per-wallet reads for `onchain_deposits`, `withdrawals`, and `transfers` destructure only `data`. A query failure can therefore behave like an empty result set and feed an incorrect balance calculation. This must be fixed before relying on automated discrepancy freezes.

### High — automatic freeze and audit-log outcomes are not verified

When a discrepancy is found, the job updates matching `user_wallets` rows and inserts an audit log, but does not verify the update's returned error or affected-row count. The audit-log failure is only warned about. The response can mark a record `frozen: true` even if the freeze update failed. A safety workflow must verify both persistence outcomes and report failures explicitly.

### High — paired withdrawal persistence is non-atomic

The worker broadcasts, updates `onchain_withdrawals`, then separately updates legacy `withdrawals`. It checks returned errors, which is better than silently ignoring them, but the two updates are not atomic and a successful broadcast followed by a failed write can leave inconsistent records. The worker appropriately calls for reconciliation in error messages; production readiness still requires a durable, idempotent recovery path that binds the exact withdrawal ID, network, and transaction hash.

### High — refund authorization still relies on a caller-supplied assertion

For local validation failures, the worker calls `process_failed_withdrawal` with `p_is_verified_unbroadcast: true`. The database function's trust-boundary review (Step 36O) found that this Boolean is trusted rather than independently proving that no transaction was broadcast. Do not restore refunding for observed chain failures or ambiguous broadcasts based solely on this flag.

### Medium/High — transfer restriction checks are API-level and require database-path verification

The transfer route checks sender and recipient restrictions before execution. These checks are useful but must be confirmed at the authoritative transfer RPC/database transaction too, so alternate callers cannot bypass them and account status cannot change between API validation and balance movement. The route also has a broad Auth-user fallback and may upsert a missing profile; that recipient-resolution path needs separate review for pagination, exact matching, and side effects. No transfer was executed.

### Existing containment verified in source

- Direct user-supplied deposit endpoint returns `410 Gone`, rather than accepting a payload as proof of a chain deposit.
- Withdrawal dispatch persists a `BROADCASTED` status and transaction hash rather than immediately marking the payout complete.
- Circuit-breaker settings and EVM nonce allocation fail closed when their safety prerequisites cannot be verified.

## Dependency mapping from this pass

| Flow | Application entry/caller | Data/RPC dependency | Current status |
|---|---|---|---|
| User deposit request | `src/app/api/wallet/deposit/route.ts` | Retired endpoint; verified chain ingestion path not fully mapped here | Contained; replacement credit path pending |
| User withdrawal request | `src/app/api/wallet/withdraw/route.ts` → `withdrawalService.ts` | Withdrawal creation path requires further line-by-line review | Not production-ready |
| Withdrawal broadcast | `src/jobs/withdrawalWorker.ts` | `claim_pending_withdrawals`, `allocate_hot_wallet_nonce`, `onchain_withdrawals`, legacy `withdrawals` | Safer broadcast state handling; split persistence/recovery remains |
| Withdrawal settlement/refund | Worker/confirmation path → settlement/refund RPCs | `complete_onchain_withdrawal`, `process_failed_withdrawal`, `ledger_entries`, balance store(s) | Blocked by live schema mismatch and trust boundary |
| Ledger reconciliation | `src/app/api/cron/reconcile-ledger/route.ts` | `user_wallets`, `onchain_deposits`, `withdrawals`, `transfers`, `audit_logs` | Not a complete/reliable accounting reconciliation yet |
| Internal transfer | `src/app/api/wallet/transfer/route.ts` | Sender/recipient profiles plus downstream transfer transaction/RPC (full path pending) | API checks observed; atomic DB enforcement still to verify |

## Recommended next step

Continue read-only review of the full withdrawal service and confirmation/settlement callers, then trace the authoritative transfer transaction and deposit ingestion credit path against live RPC signatures, grants, schemas, and balance stores. Build a writer/reader compatibility map before proposing one canonical ledger contract. Do not perform production DDL or move balances until historical records, escrow, pending withdrawals, fees, and platform-ledger balances can be reconciled.

## Verification

- Source files fetched from branch `fix/retire-unverified-deposit-entrypoints`.
- Read-only review only; no financial RPC invoked and no production data modified.
- No build, typecheck, or automated tests run in this step.
