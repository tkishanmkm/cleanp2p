# Step 32 — Deposit Credit Boundary: Historical SQL Call Paths

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: read-only review of key historical SQL migrations and current worker routes. No production database changes or financial-row reads.

## Current route status rechecked

- `src/app/api/workers/deposit-worker/route.ts` returns HTTP 503, code `DEPOSIT_CREDITING_PAUSED`, and explicitly says no deposits were credited.
- `src/app/api/cron/indexer/route.ts` also returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`.
- `tests/deposit-worker-reports-paused.test.ts` asserts these paused responses and asserts the ingestion job does not call `process_deposit_atomic`.
- This previously reported stale “completed via canonical process_deposit_atomic” response text is already absent from the branch. No additional route edit was needed in this step.

## Confirmed historical SQL hazards

### 1. `20260909000000_hardened_core_rpcs.sql` — `process_incoming_deposit`

The migration defines a SECURITY DEFINER function that accepts destination address, asset, network, amount, transaction hash, and output index from its caller. It checks duplicate records, resolves a user from the supplied address, then inserts a deposit with credited status and confirmation count 1 and updates balances. The shown function body does not independently verify a canonical chain transaction or exact on-chain event before crediting.

### 2. `20260910000001_add_process_user_deposit_rpc.sql` — `process_user_deposit`

The migration defines a SECURITY DEFINER overload accepting user ID, address, asset, chain, amount, and transaction hash. The function updates wallet balances, inserts completed/confirmed deposit records, stores 12 confirmations, and writes a ledger entry from those caller-supplied values. The migration's original grants to `anon`, `authenticated`, and `service_role` were recorded in Step 29; later hardening was reported to revoke the matching overload in the deployed environment. Fresh-environment migration ordering must be verified so the hardening is always applied.

### 3. `20260903000000_onchain_deposits_and_worker.sql` — `process_confirmed_deposit`

This SECURITY DEFINER function accepts a deposit UUID and credits from the stored `onchain_deposits` row. This is only safe if the row's transition into a creditable state is itself evidence-backed and protected. The reviewed code path does not establish that invariant. A function that trusts a stored row does not, by itself, prove the row came from an independent verifier.

### 4. `20261001000000_canonical_process_deposit_atomic_part6k7.sql` — `process_deposit_atomic`

The canonical function validates and normalizes fields, enforces network/asset policy and idempotency, and performs transactional ledger/balance work. However, it accepts `p_confirmations` and event fields from its caller. Atomicity and validation do not prove the submitted transaction/output/log exists on the canonical chain; Step 30's deployed function audit also found confirmation values could be trusted to reach the credit threshold.

### 5. `20260924000000_canonical_deposit_rpc_v2.sql`

This migration includes a historical-row safety gate that aborts if deposits/on-chain deposits already exist. This gate is not a chain verifier and should not be treated as proof of safe crediting. Review migration application history before assuming this file was applied or safe to re-run.

## Current caller inventory remains incomplete

The complete recursive branch tree contains 740 source/config/migration files. Repository code-search queries for the legacy RPC names returned no indexed matches, and the search tool searches the default branch rather than reliably scoping to this draft branch. Thus the no-match results cannot establish that there are no callers. This step confirms historical SQL definitions and current fail-closed worker behavior, but does not claim exhaustive mapping of every application caller, SQL trigger, edge function, external scheduler, or other environment.

## Decision

Do not add a broad revoke/drop migration yet. It could break undocumented callers, and revoking only application-level calls would not solve the core issue if a privileged caller can still submit fabricated transaction fields. The safe target design is:

1. A trusted verifier creates immutable evidence for a specific chain/network, canonical block, transaction hash, output/log index, successful receipt, recipient, asset/token contract, and exact amount.
2. A credit RPC accepts only a unique evidence ID, locks it, verifies it is valid and unused, and derives all financial fields from that evidence record.
3. Event-level uniqueness and a single database transaction protect concurrent/replayed credits.
4. Reorg/failed-receipt handling prevents or reverses credits according to a documented policy.
5. Legacy functions are revoked/retired only after exhaustive caller inventory and staging tests.

## Safety and validation status

No production SQL, grants, configuration, financial rows, merge, or deployment changed. Deposit crediting remains paused in this draft. Static source assertions exist, but runtime tests, typecheck, lint, and production build have not been run in this environment. The platform is not yet production-ready for deposits.
