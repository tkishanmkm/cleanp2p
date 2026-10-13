# Step 34P — Deposit-credit call-site audit

Read-only audit of proposal branch `fix/retire-unverified-deposit-entrypoints`. No live SQL, permissions, balances, or deployments changed.

## Confirmed signature

The source migration `supabase/migrations/20261001000000_canonical_process_deposit_atomic_part6k7.sql` defines one 11-argument `public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)` function. It accepts amount, network, transaction identity, output index, block number, and caller-supplied confirmations. It calculates effective confirmations using the maximum of the caller parameter and existing stored confirmations, then decides whether to credit. The database does not independently validate chain evidence or a signed attestation. This is the critical release blocker.

## Call sites in the audited branch

- `src/jobs/depositIngestion.ts`: the legacy scanner routes through `rejectUnverifiedScannerCredit`, which always returns a controlled error and does not invoke the credit RPC. This covers scanner-originated EVM token/native, TRON, BTC, and LTC paths. The scans can detect deposits but intentionally cannot credit them through these legacy paths.
- The same file has one remaining direct `process_deposit_atomic` call in the pending-confirmation worker, labelled `confirmations_worker`. It verifies chain-specific transaction/receipt information and exact amount against the stored pending record before calling the RPC. However, its service-role credential can still call the RPC directly and supply arbitrary confirmations, so the DB trust-boundary flaw remains.
- The proposal branch retires the legacy webhook, listener, and wallet deposit API routes with HTTP 410. These branch changes are not proof of deployment and may interrupt deposits if merged before a tested replacement is available.

## Compatibility and operational risks

1. Replacing or revoking the current RPC before a compatible verified path is staged could halt legitimate deposit crediting.
2. Keeping the current RPC callable by the ordinary service-role credential preserves a bypass if that credential is compromised.
3. Legacy scanners are deliberately fail-closed, so deposits discovered only by those paths may remain uncredited pending a supported reconciliation/recheck flow.
4. Existing live identity indexes must be preserved and migration drift reconciled before any schema rollout.
5. No test execution or staging deposit was performed in this step.

## Decision

Do not revoke or replace the production RPC yet. The smallest safe implementation is a staging-only replacement whose database credit operation cannot be invoked with arbitrary confirmation evidence by the ordinary service-role credential. First prove the available credential/role isolation model, then test both legitimate pending-to-credited flow and forged-confirmation rejection across supported chain families. Do not merge or deploy the proposal branch as production-ready until those tests pass.
