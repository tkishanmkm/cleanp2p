# Step 36A — Withdrawal Worker Fail-Closed Safety Checks

Date: 2026-10-14  
Repository: `tkishanmkm/cleanp2p`  
Branch: `fix/retire-unverified-deposit-entrypoints`

## Audit findings

The withdrawal worker had three fail-open behaviors:

1. `checkCircuitBreakers()` allowed withdrawals when platform settings were missing, the query errored, or an exception occurred. That could bypass a configured pause/kill switch during a database or configuration failure.
2. `allocateEvmNonce()` fell back to the chain's pending nonce if the database allocator failed. Concurrent workers or other wallet activity could then allocate the same nonce.
3. `processAllPendingWithdrawals()` proceeded if the worker-lock RPC threw, and also did not reject the case where the RPC returned an error or an unexpected/null lock result. This could allow dispatch without verified exclusivity.

## Changes committed

In `src/jobs/withdrawalWorker.ts`:

- Circuit-breaker settings now fail closed when missing/unavailable.
- EVM dispatch now stops if the database nonce allocator errors or returns no nonce; no unsafe fallback to the provider pending nonce.
- Withdrawal batches now stop unless the worker-lock RPC explicitly returns `true` without an error. RPC errors and false/null results do not dispatch withdrawals.

Commits:
- `bda6d062ded312ae2a0d3f82d98dc86c0f5536ee` — fail closed on withdrawal safety checks
- `886bdbd6d345f1ac33c05b22b523414e834580ab` — require verified withdrawal worker lock

## Important remaining issue

The current database worker lock uses PostgreSQL session-level advisory locks through separate RPC calls. A session-level advisory lock is tied to the database connection, while PostgREST requests do not guarantee that acquire, batch processing, and release share one connection. This means the lock's actual lifetime/exclusivity must be validated and the design should be replaced with a database-backed lease/claim mechanism if that guarantee cannot be established. This step does not claim the singleton lock is fully production-safe.

## Validation and impact

- Code was committed on the working branch; `main` was not changed.
- This was a code-only change; no production database migration was applied.
- No wallet balances, withdrawals, or ledger rows were changed by this step.
- Automated tests, typecheck, build, and end-to-end withdrawal tests were not run in this step.
- Fail-closed behavior can pause withdrawals during a configuration/RPC outage; that is intentional versus dispatching without verified safety controls.
- This does not resolve the separate `process_failed_withdrawal(..., p_is_verified_unbroadcast)` trust-boundary issue. The reverted-transaction settlement path still requires a separately audited design.
