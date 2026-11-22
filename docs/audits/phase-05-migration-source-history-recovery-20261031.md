# Phase 05 — Production migration source history recovery (2026-10-31)

## Result

A full Git history scan improved the source inventory substantially, but did **not** prove that all 81 SQL bodies originally applied to production have been recovered.

- Production migration ledger: **81** records.
- Unique migration SQL paths found across local/remote Git history: **249**.
- Production names with an exact filename-stem match somewhere in Git history: **71 of 81**.
- Historical candidate paths for those names: **72** (one production name has two path candidates).
- Names with at least one candidate commit timestamp no later than the production version timestamp (parsed as UTC): **33**.
- Names with only later Git commit evidence: **38**.
- Production names with no exact filename-stem match in the available Git history: **10**.

The timestamp comparison is evidence of chronology only. It does not prove that the candidate SQL body is the exact SQL submitted to the production migration runner or that it was applied unchanged.

## Evidence manifests

- `phase-05-migration-source-history-candidates-20261031.json`: filename/path candidates and commit chronology.
- `phase-05-migration-source-history-hashed-20261031.json`: 72 candidate rows with source path, commit SHA, commit UTC, commit subject, Git blob SHA-1, exact-content SHA-256, and byte length.
- The hash pass completed with all 72 Git blob SHA-1 and SHA-256 fields validated.

The JSON hash manifest must be treated as a **candidate-source manifest**, not an authoritative deployment manifest.

## Ten production entries still lacking an exact filename-stem source

1. `20261013202306 restrict_sensitive_escrow_and_sweep_rpc_execution`
2. `20261013202340 restrict_sensitive_escrow_release_and_refund_rpcs`
3. `20261013202420 restrict_unauthorized_admin_status_and_escrow_rpcs`
4. `20261013202555 revoke_anon_access_to_p2p_trade_financial_rpcs`
5. `20261014022154 grant_service_role_process_deposit_atomic`
6. `20261014023325 deposits_amount_must_be_positive`
7. `20261016013222 restrict_atomic_trade_cancellation_rpc`
8. `20261016013259 restrict_escrow_trade_rpc_anonymous_access`
9. `20261016013341 restrict_escrow_participant_rpcs_anonymous_access`
10. `20261016013425 restrict_dispute_resolution_to_trusted_backend`

## Related SQL found under different filenames (not confirmed replacements)

- `20261012000200_restrict_high_risk_financial_rpcs.sql` revokes API-role execution and grants service-role execution for several high-risk escrow/trade RPCs. Live production ACLs for the listed functions are consistent with service-only access.
- `20261014030000_deposits_amount_positive_check.sql` contains `ALTER TABLE public.deposits ADD CONSTRAINT deposits_amount_positive_check CHECK (amount > 0)`. This is a semantic candidate for the positive-deposit migration, but its commit chronology/content must still be reconciled with the recorded production entry.
- `20261015000101_restrict_dispute_resolution_rpc.sql` revokes public/anon/authenticated execution of `resolve_trade_dispute` and grants service-role execution. The live function is service-role-only.
- Deposit RPC hardening/grants also appear inside other canonical deposit migrations, including `20260924000000_canonical_deposit_rpc_v2.sql`, `20261014000000_guard_deposit_identity_consistency.sql`, `20261014070000_atomic_deposit_block_hash_persistence.sql`, and `20261016000004_lock_canonical_deposit_rpc_to_server_roles.sql`. None is certified as the exact source of the separately named production grant migration.
- Other related cancellation, escrow, and participant ACL source files exist under different names, but their signatures and full SQL bodies are not yet sufficient to assign one-to-one replacements to all four missing trade/escrow entries.

## Remaining release gates

1. Recover the actual source SQL for each production ledger entry from the authoritative deployment artifact, original apply record, or verified backup.
2. Compare recovered bodies, byte hashes and object signatures with the candidate Git history manifest.
3. Resolve the ten missing source entries explicitly; do not infer source from migration names or similar SQL snippets.
4. Only after provenance is established, produce a reviewed forward-only baseline and replay it in an isolated schema-matched PostgreSQL environment.
5. Run financial transaction, ACL, RLS, concurrency and rollback tests before any production change.

## Scope and non-actions

- Production migration ledger and function ACL catalog were read only.
- No SQL/DDL/DML was executed against production or staging.
- No migrations were applied, no staging reset/restore was attempted, no project/branch was created, and no GitHub Actions workflow was run.
- No Git commit, push, merge or deployment was made.

**Decision:** source recovery is partially improved, but production migration provenance and replay readiness remain blocked.
