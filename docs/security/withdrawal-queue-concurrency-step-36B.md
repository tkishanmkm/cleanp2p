# Step 36B — Withdrawal Queue Concurrency Audit and Lock Correction

Date: 2026-10-14  
Repository: `tkishanmkm/cleanp2p`  
Branch: `fix/retire-unverified-deposit-entrypoints`

## Audit findings

Live production inspection of `public.claim_pending_withdrawals(integer)` shows it atomically selects pending rows using `FOR UPDATE SKIP LOCKED`, changes each selected row to `PROCESSING`, and returns the claimed rows. The RPC is executable by `service_role`, and denied to `anon` and `authenticated`.

The previous worker singleton lock used `pg_try_advisory_lock` / `pg_advisory_unlock` in separate PostgREST RPC requests. PostgreSQL session-level advisory locks are connection-scoped; separate RPC requests are not guaranteed to share the same database session. Therefore this was not a reliable distributed lock and could cause misleading results or leaked locks on pooled sessions.

## Change committed

Updated `src/jobs/withdrawalWorker.ts` to stop using the session-level advisory-lock RPCs for dispatch. The worker relies on the existing atomic `claim_pending_withdrawals` row-claim mechanism, which prevents two concurrent claim calls from claiming the same pending row. The code still processes the queue sequentially within each worker invocation.

Commit:
- `5b40873950291325a8b5633e696d3661685a7af6` — initial removal of the advisory-lock wrapper
- `39ee86bbcc81b8b96ed13cf8e26cd2d133cecab0` — syntax correction after removal

## Safety caveats

- This prevents duplicate claims of the same pending row, but does not limit the number of distinct withdrawals processed concurrently across multiple worker instances. EVM nonce allocation must remain database-atomic and unique.
- The old database lock functions remain deployed but are no longer called by this worker. Removing them from production requires a separate caller audit.
- A worker crash after a row becomes `PROCESSING` may leave it stranded. A future recovery lease needs explicit claim timestamps/expiry and safe reconciliation before reclaiming.
- The separate unsafe `p_is_verified_unbroadcast` refund trust boundary remains unresolved.

## Validation and impact

- Live database function definition and privileges were inspected before the code change.
- Code was committed to the working branch; `main` was not changed.
- No production database migration was applied and no financial rows were changed.
- Build, typecheck, and tests have not been run in this step.
- This is a concurrency correction, not a complete production-readiness certification.
