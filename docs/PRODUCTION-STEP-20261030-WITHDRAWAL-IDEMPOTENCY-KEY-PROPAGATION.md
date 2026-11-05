# Paxones Production Audit — Withdrawal Idempotency-Key Propagation (2026-10-30)

## Scope
Static source audit from withdrawal dialogs through wallet context, API route, and canonical withdrawal service. No application runtime or production database changes were performed.

## Confirmed flow
- The two inspected withdrawal dialogs invoke `useWallet().requestWithdrawal`.
- `wallet-context.tsx` creates a UUID for a withdrawal fingerprint and sends it in `x-idempotency-key` to `/api/withdraw`.
- `/api/withdraw` forwards the header key (or body fallback) into `executeCanonicalWithdrawal`.
- `withdrawalService.ts` uses `request_withdrawal_idempotent` and the replay lookup RPC.
- The in-memory key is cleared after a successful HTTP response, and retained after caught errors to support same-page retries.

## Finding: retry guarantee is only in-memory
`pendingWithdrawalKeys` is a module-level `Map`. It does not survive a page reload, browser restart, or another tab. If the server commits a withdrawal but the response is lost and the user reloads before the result is known, the new page can generate a new key for the same intent. The server cannot recognize this as the same idempotent request solely from the old key. This is a resilience gap for ambiguous outcomes and should be resolved before production financial traffic.

The fingerprint includes user ID, asset, chain, destination, amount, and fee. It excludes TOTP, which is appropriate for request identity, but the map is memory-only. Its size cap also evicts the oldest entry once more than 100 distinct pending fingerprints are stored.

A separate exported helper in `src/lib/wallet.ts` uses a timestamp-based fallback key when callers omit one. Its `createWithdrawalRequest` wrapper does not pass an explicit key. Repository search found no current call site for `createWithdrawalRequest`, so this is a latent hazard rather than a confirmed active user flow. It should be made impossible to call without an explicit stable key or removed after checking downstream consumers.

## Tests
- `tests/withdrawal-idempotency-key-propagation-audit.test.mjs`: 6 passed, 0 failed.
- Related lifecycle and migration contract tests: 7 passed, 0 failed.
- `git diff --check` for the new audit test: passed.

These are static contract tests; they do not simulate a browser reload, multiple tabs, or PostgreSQL concurrency.

## Recommended remediation
1. Introduce a small client-side pending-request store scoped by authenticated user and a stable fingerprint, with a privacy-safe storage key and explicit expiry/cleanup policy. Persist the generated idempotency key before issuing the request; remove it only after a definitive success or a verified terminal response. Treat uncertain network/5xx responses as ambiguous and retain the key.
2. On page reload, recover the pending key and use the server replay lookup before allowing a new request for that exact intent.
3. Require an explicit idempotency key in legacy helpers, or deprecate/remove them once callers are proven absent.
4. Add tests for lost response + reload, concurrent tabs, same intent, changed intent, expired entries, storage denial, and success cleanup. Then verify against an isolated PostgreSQL schema.

## Safety
No production database query/mutation, migration, real withdrawal, commit, push, deployment, or GitHub Actions minutes used. Existing working-tree changes preserved.

**Status: Key propagation is consistent in the primary flow; cross-reload retry protection is not production-grade yet.**