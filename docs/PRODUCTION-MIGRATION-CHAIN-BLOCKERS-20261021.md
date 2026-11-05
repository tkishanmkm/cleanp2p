# Production Migration-Chain Blockers — 2026-10-21

## Scope and safety

Read-only comparison of the connected production project's Supabase migration history with the checked-out `supabase/migrations` directory. No database writes, migration applications, commits, pushes, or deployments were performed.

## Findings

1. **Production history diverges from the local migration directory.** The production project `eaiwgfxoiwxepinvcykg` reports 81 applied migration versions, ending at `20261016013425` (`restrict_dispute_resolution_to_trusted_backend`). None of those 81 version IDs are represented by a matching local migration filename. The local directory contains a separate sequence through `20261009000000`, then skips to `20261017010000`; this means a normal local-to-production migration push cannot be treated as a safe, reviewed incremental rollout.
2. **Local migration filename preflight fails.** 134 SQL migration files were scanned; 131 unique valid 14-digit version prefixes were found. The preflight identified three blockers:
   - `20260908_schema_and_metrics_patch.sql` has a nonstandard 8-digit version prefix.
   - `20260919050000_fix_enum_trade_status_all_variants.sql` and `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql` share version `20260919050000`.
   - `20261002010000_p2p_enum_typecast_hotfix.sql` and `20261002010000_remove_legacy_trade_escrow_trigger.sql` share version `20261002010000`. The former replaces three escrow RPC bodies and grants execution; the latter removes a legacy trigger. They are not interchangeable, so do not resolve this by deleting either file without first confirming deployment history and dependent function/trigger state.
3. **Staging is not a usable rehearsal database.** The connected staging project `tazvjyrdondcrdrkggqe` reports zero migration history entries, and earlier read-only checks found expected app tables absent.
4. **No migration runtime is available on the connected Windows workstation.** `supabase`, `docker`, and `psql` were not found on PATH, so a local PostgreSQL replay could not be performed in this step.
5. **The chat-limit support migration remains unapplied.** Production does not have `public.trade_chat_limit_requests`; therefore the chat-limit support ticket/email flow must not be represented as live-ready.

## Guard added

`scripts/check-migration-versions.mjs` now checks that every local SQL migration has a 14-digit version prefix and that version prefixes are unique. It is wired into `.github/workflows/quality-security.yml` as a dedicated CI job and currently exits nonzero on the three known blockers. The PowerShell version remains a local helper; the Node.js version is the cross-platform CI gate.

## Required safe sequence

1. Recover and version-control the exact SQL source corresponding to the production's 81 recorded migration entries, or establish a reviewed, schema-accurate baseline without rewriting production history.
2. Resolve filename/version conflicts only after determining whether the affected local migrations have been applied anywhere; do not rename historical migrations blindly.
3. Provision an isolated, schema-matched disposable PostgreSQL/Supabase environment and replay the reconciled chain from a clean state.
4. Run database-level tests for function signatures/ACLs, RLS, financial RPC authorization, escrow and withdrawal idempotency, trade/message caps, and support email dispatch.
5. Review the diff against production and require explicit deployment approval before applying any DDL to production.

**Release decision: BLOCKED.** Migration history and naming must be reconciled before any migration deployment. This is a safety stop, not a claim that the application build itself failed.
