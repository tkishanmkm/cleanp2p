# Phase 03 — Production migration source recovery inventory

**Date:** 2026-10-24  
**Repository:** `tkishanmkm/cleanp2p`  
**Production Supabase project:** `eaiwgfxoiwxepinvcykg`  
**Scope:** Read-only comparison of the production migration ledger and SQL migration filenames on repository branches, plus recovery-source searches. No SQL was executed.

## Result

- Production migration ledger records: **81**.
- `main` SQL migration files: **108**.
- SQL migration files on `audit/phase-02-platform-ledger-replay-metadata`: **112**.
- Exact timestamp/version-prefix matches between production ledger versions and the audit branch SQL filenames: **0 of 81**.
- Searches of the default-branch code index and commit search for representative missing names (including `wallet_rpc_execute_restrictions`, `restrict_sensitive_escrow_and_sweep_rpc_execution`, and version `20261011161817`) returned no results.
- This is evidence of a source-history/reproducibility gap, **not** evidence that the recorded production migrations failed to apply.

## Representative production ledger entries without matching timestamped SQL filenames

- `20261011152650 wallet_rpc_execute_restrictions`
- `20261011160153 wallet_hardening_followup`
- `20261011160335 wallet_deposit_rpc_restrictions`
- `20261011160457 wallet_legacy_deposit_overload`
- `20261011161643 secure_wallet_provisioning_trigger`
- `20261011161817 enforce_atomic_withdrawal_limits`
- `20261011163228 restrict_wallet_lock_functions`
- `20261011163807 fix_wallet_transfer_search_path`
- `20261013202306 restrict_sensitive_escrow_and_sweep_rpc_execution`
- `20261013202340 restrict_sensitive_escrow_release_and_refund_rpcs`
- `20261013202420 restrict_unauthorized_admin_status_and_escrow_rpcs`
- `20261013202555 revoke_anon_access_to_p2p_trade_financial_rpcs`

## Existing repo audit findings that remain release blockers

- Production and migration contracts differ materially for wallet balances, ledger entries, withdrawals, and RPC signatures. See `docs/audits/phase-02-production-schema-contract.md`.
- The connected staging project was previously observed with no public tables and no migration ledger; it is not a valid replay environment.
- Duplicate migration version prefixes exist in the repository. Do not rename already-applied production history in place.
- Exact filename matching alone cannot establish that an SQL body is absent under every possible alternate filename. No original SQL body has been authenticated as a replacement for the missing entries.

## Required recovery procedure

1. Recover original SQL from the authoritative deployment artifact, original Git commit/PR, or verified backup. Preserve provenance (commit/blob hash or backup reference).
2. For each recovered file, record production ledger version/name, source path, content hash, and the deployed function/DDL objects it affects.
3. Compare each recovered migration body to the current live schema and function definitions in read-only mode. Do not infer SQL from migration names or reconstruct missing bodies from current state alone.
4. Resolve duplicate-version and ordering issues in a documented forward-only plan without rewriting historical production entries.
5. Create a disposable, isolated validation database from an approved canonical baseline. The current blank staging project must not be populated by blindly replaying the repository.
6. Replay only the reviewed migration sequence in isolation; run schema, grant/RLS, RPC, financial idempotency, concurrency, and rollback tests.
7. Prepare a separately reviewed production rollout and rollback plan. No production migration, merge, or deployment is authorized by this inventory.

## Actions explicitly not taken

- No production or staging SQL/DDL/DML executed.
- No production financial data queried or changed.
- No secrets or live-chain transactions used.
- No GitHub Actions workflow triggered.
- No pull request merged and no deployment performed.

## Status

**Migration recovery remains blocked pending authoritative source artifacts.** This inventory is not a production-readiness certification.
