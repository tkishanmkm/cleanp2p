# Phase 01 Step 12 — Isolated staging schema readiness audit

**Status:** Read-only inventory and release gate. No schema was created or changed.

## Findings
- The connected staging Supabase project `tazvjyrdondcrdrkggqe` currently reports **zero tables in public** and **zero recorded migrations**.
- The repository `main` tree contains **108 files under `supabase/migrations/`**.
- At least two migration version prefixes are duplicated:
  - `20260919050000` appears in `20260919050000_fix_enum_trade_status_all_variants.sql` and `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`.
  - `20261002010000` appears in `20261002010000_p2p_enum_typecast_hotfix.sql` and `20261002010000_remove_legacy_trade_escrow_trigger.sql`.
- The production schema was previously found to diverge materially from some repository migrations. Therefore, applying all 108 files directly to staging or production without migration-history and dependency analysis is unsafe.

## Decision
Do **not** execute the migration chain yet. An empty staging database does not establish that the repository's full historical migration sequence applies cleanly or produces a schema compatible with the deployed deposit RPC.

## Required next actions
1. Inventory every migration filename/version and identify duplicate versions, ordering assumptions, references to missing objects, destructive statements, external extensions, secrets, and network-specific/testnet logic.
2. Compare the migration history and current schema from the repository with the production contract already documented, using catalog metadata only for production.
3. Establish a disposable, isolated staging project/database with no production financial data; document its reset/rollback path.
4. Resolve duplicate migration version prefixes in a dedicated migration-history cleanup proposal without rewriting already-applied production history.
5. Replay a reviewed, coherent baseline on disposable staging, capture schema and function signatures, then run the synthetic deposit RPC regression plan.
6. Only after schema parity is demonstrated should a candidate deposit RPC migration be authored and tested.

## Scope and non-actions
- Read-only inspection of staging table/migration inventory and repository migration paths.
- No production SQL, no staging DDL, no real financial rows, no live coins, no secrets, no merge, no deployment.
- This audit does not certify the codebase or wallet flows as production-ready.

## Acceptance criteria
- A deterministic, documented migration order with no unresolved duplicate versions.
- Disposable staging can be rebuilt from the reviewed baseline without manual undocumented steps.
- Schema/function contract matches the intended target contract.
- Synthetic duplicate, mismatch, concurrency, rollback, low-confirmation, and reorg test cases pass.
