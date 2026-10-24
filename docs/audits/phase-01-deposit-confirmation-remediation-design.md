# Phase 01 Step 11 — Deposit confirmation remediation design

**Status:** Design/preflight only. Not production-ready.

## Policy decision
The operator selected **12 Litecoin confirmations** on 2026-10-13. This is a policy target for the candidate implementation, not a claim that production has been changed. The deployed function was previously observed using 6 confirmations; the repository migration uses 12. Production remains unchanged.

## Objective
Prevent deposit credit from relying solely on caller-controlled webhook confirmation counts, while preserving idempotency and atomic accounting against the deployed schema.

## Verified constraints from prior read-only audit
- Deployed RPC signature:
  `process_deposit_atomic(p_destination_address text, p_asset_symbol text, p_network_code text, p_amount numeric, p_tx_hash text, p_output_index integer DEFAULT 0, p_block_number bigint DEFAULT NULL, p_from_address text DEFAULT NULL, p_token_contract text DEFAULT NULL, p_confirmations integer DEFAULT 0, p_provider text DEFAULT 'internal') RETURNS jsonb`
- Deployed function is SECURITY DEFINER, owned by postgres, with search_path `public, pg_temp`.
- Unique identities exist for normalized tx hash + network/chain + output index in `deposits` and `onchain_deposits`; ledger deposit references have a partial unique index.
- The deployed RPC's existing-row consistency checks differ from the repository migration.
- Production schema differs materially from the repository's withdrawal migration; migrations must not be blindly applied.
- The connected staging project was reported healthy but had no public tables/migrations, so it cannot yet validate the real deposit RPC contract.

## Required implementation design
1. Treat webhook payloads as **notifications**, not proof of confirmation.
2. Verify the transaction against a trusted chain data source before calling the crediting RPC:
   - EVM: canonical transaction receipt exists, receipt succeeded, log index is explicit and matches the transfer event, token contract and recipient match the configured asset/address, amount is derived from the canonical log, and the receipt block remains canonical.
   - Bitcoin/Litecoin: transaction is found on the intended network, the exact output index/address/value are read from the canonical transaction, block inclusion and confirmations are independently derived from trusted chain data, and the transaction is not conflicting or orphaned.
3. Use a single canonical output/event identity for idempotency. Never default a missing EVM log index or UTXO output index to zero.
4. For Litecoin, do not credit until **12 independently verified confirmations**. Reject lower, missing, malformed, or contradictory counts. Recheck chain inclusion before final credit where the architecture supports pending deposits.
5. The database RPC must validate all immutable identity fields against existing `deposits`, `onchain_deposits`, and ledger records. A replay with changed user/address/asset/network/amount/contract/output identity must fail without changing balances.
6. Ensure all balance, deposit, on-chain record, and ledger writes are atomic. Ledger failure must abort the transaction. Keep unique constraints and transaction-level locking.
7. Handle reorganizations explicitly: only credit at the configured threshold; if credited deposits can be invalidated by a reorg, define an accounting-safe compensating workflow rather than deleting ledger history.
8. Keep webhook authentication as a separate prerequisite. Provider header/signature capabilities still need verification against each provider's actual documentation/configuration.

## Staging gates before writing an executable replacement migration
- Provision a dedicated isolated staging project with schema/migrations matching the target production contract; do not clone production financial data.
- Capture and review the exact deployed function definition, owner, search_path, execute grants, table columns, triggers, constraints, and indexes.
- Reconcile the 12-confirmation policy across app configuration, provider processing, database RPC, UI/status labels, and tests.
- Create synthetic fixtures only: valid deposit; under-threshold LTC; fake/inflated webhook confirmations; unknown transaction; wrong chain; wrong address; wrong token contract; mismatched amount; missing output/log index; duplicate callback; duplicate identity with changed fields; concurrent duplicate callbacks; transaction rollback when ledger insert fails; reorg/orphaned transaction.
- Verify no synthetic test can affect a real wallet or any production project.
- Run SQL regression tests, application tests, build, lint, and typecheck; record results before requesting approval for any production change.

## Explicit non-actions
- No production SQL was executed and no production configuration was changed.
- No live coin/chain transaction was submitted or used for testing.
- No executable SQL replacement was included because the staging project has no usable schema and the full deployed function contract must be reconciled first.
- No merge, deployment, or production financial-row access.

## Current outcome
The Litecoin policy decision is resolved at 12 confirmations. The implementation is **not complete**: independent chain verification, staging schema provisioning, executable RPC remediation, and regression tests remain blockers. This document is a design gate, not a fix or production-readiness certification.
