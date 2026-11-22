# Paxones Production Step — Deposit Cross-Process Coordination Audit
Date: 2026-10-30

## Scope
Read-only review of confirmationsWorker.ts, canonical deposit RPC migration, pending registration hardening migration, and related safety tests.

## Verified source safeguards
- Confirmation worker refuses financial writes when service-role configuration is missing.
- Confirmation thresholds are defined per supported network and stored threshold mismatch fails closed.
- Worker independently verifies transaction/output and exact destination/amount before calling the canonical credit RPC.
- Below-threshold or unverifiable deposits do not call the credit RPC.
- Pending registration requires p_confirmations = 0 and uses a transaction-scoped advisory lock keyed by network, transaction hash, and output index.
- Pending registration checks identity mismatches and avoids resetting existing confirmation/status fields.
- Canonical credit RPC checks existing on-chain/deposit/ledger state and returns an already-processed response rather than applying a second credit.
- Migration revokes process_deposit_atomic execution from PUBLIC, anon, and authenticated, granting service_role and postgres.

## Production gap: worker-level cross-process claims
The confirmation worker explicitly states that cross-process claims remain a separate requirement. Its activeWorkerRun promise only coalesces calls inside one Node.js process. Two worker processes can both read the same PENDING rows and independently query chain evidence. The canonical RPC's row/identity/ledger checks are the financial idempotency boundary, but concurrent database behavior has not been exercised against a real disposable database in this step.

## Verification limits
- Source review only; no live Supabase connection or schema catalog inspection.
- No SQL migration executed.
- No blockchain provider or wallet transaction called.
- No source code changed.
- Combined test command execution was blocked by the desktop execution tool in the preceding step; static test contracts are not runtime/database proof.

## Safe remediation plan
1. Add a database claim/lease RPC for pending deposit work, keyed by deposit row ID with owner token and expiry; claim with row locks and SKIP LOCKED in a short transaction.
2. Require the worker to claim before expensive chain verification and revalidate/renew lease before credit attempt.
3. Ensure lease loss cannot authorize a stale worker to mutate status; keep process_deposit_atomic as an independent idempotency boundary.
4. Add a disposable-database concurrency test: two workers race on one deposit; only one owns the lease and exactly one ledger credit exists.
5. Test lease expiry/recovery, worker crash, provider timeout, stale owner token, duplicate pending rows, and transaction/output uniqueness.
6. Validate grants and security-definer settings in the deployed catalog before rollout. Do not apply a migration until historical data/schema preflight passes.

## Status
Deposit crediting: partially audited; not production-certified.