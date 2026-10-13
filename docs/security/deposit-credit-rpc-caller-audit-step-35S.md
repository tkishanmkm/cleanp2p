# Step 35S — Deposit credit RPC caller audit

Status: source audit performed on `fix/retire-unverified-deposit-entrypoints`. No application code, SQL, secrets, database, or deployment was changed in this step.

## Scope and confidence

Reviewed the current branch contents of:
- `src/jobs/depositIngestion.ts`
- `src/jobs/confirmationsWorker.ts`
- the Step 35R entry-point audit report

The GitHub code-search connector returned no indexed matches for the credit RPC names during this run, so this is **not a proven exhaustive repository-wide caller inventory**. It does not establish what is deployed at runtime.

## Findings

### 1. Legacy scanner routes inside `depositIngestion.ts` are fail-closed through a stub

EVM token, EVM native, TRON, BTC, and LTC scanner paths call `rejectUnverifiedScannerCredit(...)`. The helper currently returns `data: null` plus the error `Direct scanner credit disabled: canonical transaction verification is required`; it does not call Supabase RPC. These scanners therefore cannot credit through this helper in the inspected branch.

Operational defect to address later: scanner loops often record an RPC error and continue, so the cycle reports errors rather than credit. Some legacy success-count logic remains but should not trigger because the helper always returns an error. Tests are still required to verify this behavior.

### 2. Pending EVM recheck verifies chain evidence but intentionally never credits

`refreshPendingDepositConfirmations()` checks the receipt, canonical block hash, transaction destination, token contract and Transfer log identity, exact amount, and stored output/log index for supported EVM pending rows. It then deliberately throws:
`Deposit credit disabled: database credit trust boundary is not independently verified`.

This is fail-closed and does not invoke the privileged credit RPC. It can leave legitimate deposits pending.

### 3. Confirmation worker does not invoke the credit RPC

`src/jobs/confirmationsWorker.ts` only reads pending rows and performs confirmation lookups; it marks them as not credited and explains that confirmation-only evidence is insufficient. It does not call `process_deposit_atomic` in the inspected branch.

**Additional configuration risk:** the worker still initializes its Supabase client with a fallback to `NEXT_PUBLIC_SUPABASE_ANON_KEY` and placeholder URL/key values. This should be removed in a separate, focused fix so a missing service-role configuration fails explicitly rather than constructing a misleading client. Its top-level comment also still describes the worker as processing via the canonical credit RPC, which is stale.

### 4. Database trust boundary remains the principal blocker

The known privileged RPC `public.process_deposit_atomic(...)` and legacy credit RPC family remain high risk until their deployed definitions, grants, all callers, replay behavior, and transaction identity checks are independently verified. A service-role caller can invoke privileged database functions; client-side or worker-side chain checks alone do not create an independently enforced database trust boundary.

## Required next actions

1. Obtain an exhaustive branch-level file/callsite inventory (for example, repository tree plus content search) and search every `.rpc(` call, SQL function name, route, job, and trigger that can reach deposit credit functions.
2. Remove the confirmation worker's anon/placeholder fallback and correct its stale comment in a separate change.
3. Inspect every remaining direct/indirect caller and legacy overload, including SQL grants and trigger paths.
4. Design and validate a dedicated verifier/credit interface with replay protection and atomic idempotency before restoring automatic credit.
5. Run targeted tests, typecheck/build, and controlled staging integration tests before proposing any production schema change.

## Verification and status

- Source files read back from the proposal branch: yes.
- Credit RPC direct caller inventory exhaustive: **no; code-search index returned no matches**.
- Code changes in this step: none.
- Tests/build/runtime: not run.
- Database/deployment changes: none.
- Deposits production-ready: **NO**. Automatic deposit credit remains intentionally disabled/fail-closed.
