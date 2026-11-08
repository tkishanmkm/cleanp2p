# Paxones deposit migration production runbook

**Status:** Prepared; production changes have not been applied

**Checked:** 8 November 2026

**Supabase project:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)

**Region:** `ap-northeast-1`

**Application release required:** branch `fix/production-typecheck-batch-1`, current verified code baseline `1b8e23ade5ecf2282be486bb4c6c4510f8778cad` (superseded by the current batch commit after it is pushed)

## 1. Current production snapshot

The live project reports `ACTIVE_HEALTHY` on PostgreSQL 17.6. The migration history contains 137 records and its latest applied version is:

- Version: `20261103204401`
- Name: `lock_admin_audit_logs_to_verified_server_routes`

The following deposit APIs are absent in production:

- `register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`
- `claim_pending_deposit_confirmations(text,integer,integer)`
- `release_pending_deposit_confirmation_claim(uuid,text)`
- `process_deposit_atomic_with_lease(uuid,text,text,text,text,numeric,text,integer,bigint,text,text,integer,text,text)`
- `claim_deposit_integrity_checks(text,integer,integer)`
- `complete_deposit_integrity_check(uuid,text,text,text,text,jsonb,integer)`

The canonical `process_deposit_atomic(...)` function is currently executable by `service_role`. The direct execution grant is intentionally revoked by the final deposit ACL migration below. Do not treat the deposit worker as safely fenced until that migration and its ACL preflight have succeeded.

### Migration-history reconciliation is a hard deployment gate

The local working tree was inventoried against the live latest migration version:

- 68 tracked SQL migration files were already present with versions newer than the production head before this admin-action batch; that inventory includes the prior presence, trade-opening, 2FA and support-admin forward migrations.
- 90 untracked historical SQL migration files have versions at or before the production head.
- This admin-action batch adds four more forward migrations after the production head, bringing the newer tracked release inventory from 68 to **72** once this batch is committed.
- Two older SQL migration files are modified locally:
  - `20260928020000_withdrawal_hardened_rpcs.sql`
  - `20260928070000_canonical_p2p_state_machine_and_rpcs.sql`

Those 90 older files may be unapplied historical changes, superseded scripts, or local drafts. Their presence alone does not prove which case applies. Reconcile every file against `supabase_migrations.schema_migrations` and the live catalog before deployment. Do not apply them blindly, delete them, mark them as applied, or skip them based on filename alone. Review the two modified migrations separately.

**STOP:** Do not run `supabase db push`, apply only a partial subset of the mapped deposit/trade/identity/admin migrations, or resume financial workers until this inventory is reconciled and the exact ordered release set is committed and approved. A newer migration can depend on an older schema change even when the older file is absent from the recorded history.

## 2. Required migration order (deposit, trade, identity and admin)

After the full migration-history reconciliation, execute all approved pending migrations in ascending version order. The deposit and coupled trade-opening dependency sequence is:

| Order | Migration | Purpose |
|---:|---|---|
| Prior | `20261104120000_withdrawal_confirmation_and_control_flags.sql` | Earlier pending migration in the local release inventory; apply in version order before the deposit schema migration |
| 1 | `20261104130000_deposit_confirmation_contract.sql` | Adds confirmation leases and canonical block identity; creates registration, claim, release and leased-credit RPCs |
| 2 | `20261107210306_guard_terminal_deposit_registration_replay.sql` | Makes terminal deposit replay idempotent and fail-closed |
| 3 | `20261107211754_revoke_direct_deposit_credit_rpc_execution.sql` | Removes direct `service_role` execution of the canonical credit primitive; leaves only guarded wrappers |
| 4 | `20261108013000_deposit_chain_integrity_monitor.sql` | Adds integrity-check leases, durable mismatch events, and deduplicated critical alerts |
| 5 | `20261108014000_restore_authenticated_presence_rpc.sql` | Restores the authenticated, caller-bound presence heartbeat needed by seller availability checks |
| 6 | `20261108020000_guard_offline_ad_trade_opening.sql` | Restores the missing pre-trade availability RPC, durable offline-attempt counter, seller-online DB trigger, and retention job |
| 7 | `20261108030000_restore_2fa_rate_limit_contracts.sql` | Restores persistent, atomic user/admin 2FA challenge counters with server-only grants |
| 8 | `20261108031000_restore_atomic_user_2fa_contracts.sql` | Restores atomic user 2FA enrollment, disable and recovery-code consumption; enforces unique active recovery hashes |
| 9 | `20261108032000_restore_atomic_admin_2fa_contracts.sql` | Restores atomic admin 2FA enrollment, disable and recovery with canonical admin identity and account-state checks |
| 10 | `20261108033000_restore_support_admin_emergency_contracts.sql` | Restores support grants, bounded emergency sessions, session revocation on disable, and transaction-bound audit |
| 11 | `20261108040000_add_restricted_user_status.sql` | Adds the `restricted` value already exposed by the admin API; this enum-only migration must commit before the status RPC migration |
| 12 | `20261108041000_restore_admin_user_action_contracts.sql` | Restores strict-actor admin role/status and freeze/unfreeze wrappers; serializes role changes and protects the last active administrator |
| 13 | `20261108042000_restore_admin_mark_paid_authorized_rpc.sql` | Restores the server-only mark-paid wrapper around the canonical trade state transition with mandatory audit |
| 14 | `20261108043000_restore_atomic_admin_dispute_settlement.sql` | Restores audited admin dispute settlement via canonical release/cancel RPCs; its runtime feature flag must remain off pending isolated financial validation |

This table shows the currently mapped ordered deposit, trade-opening, identity, support-admin and administrator-action remediation sequence, **not permission to skip other pending migrations**. In the actual release, all approved migration versions between the current production head and the latest listed migration must be reconciled and applied in ascending order. In particular, the direct-credit ACL revocation must complete before any deposit scanner or confirmation worker is restarted.

Apply each migration file separately using the approved Supabase migration mechanism and confirm its version appears in migration history before proceeding. The enum-only `20261108040000_add_restricted_user_status.sql` is a standalone migration and must be fully committed before `20261108041000` is applied. Stop on the first error; do not continue with later migrations.

## 3. Pre-deployment gates

Before opening a production migration window:

1. Reconcile the 90 untracked older migration files and the two modified older migrations. Record for every file whether it is pending, already represented by an applied migration, superseded with an identified replacement, or intentionally excluded. Do not infer this from names.
2. Compare local and production migration history again. Confirm the approved release contains every required SQL file and the release commit is pushed to the intended branch.
3. Confirm a recent recoverable Supabase backup/PITR restore point and the incident owner who can authorize recovery.
4. Identify every running deposit ingestion, webhook, confirmation and scanner process, including standalone workers and scheduled jobs. Prepare a pause procedure and verify the pause has taken effect.
5. Pause deposit ingestion and confirmation workers before changing the RPC contract. Keep them paused through the ACL migration, SQL preflights and compatible application deployment. Do not allow an old worker to keep calling `process_deposit_atomic` directly.
6. Pause all three trade-opening API routes while `record_ad_offline_open_attempt` and `set_my_presence` are absent. Do not bypass the missing availability check or create trades by calling the escrow RPC manually.
7. Do not bypass missing administrator RPCs with direct table writes or direct calls to legacy admin/escrow helpers; all account/mark-paid/dispute actions must pass through the actor-bound wrappers.
8. Keep `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED` disabled until a separately approved isolated financial validation is completed.
9. Do not run live deposits, credits, transfers, withdrawals, sweeps, nonce allocation or broadcasts as a deployment check.

If any pre-deployment gate cannot be verified, stop without applying migrations.

## 4. Apply sequence and pause boundary

1. Pause the deposit-related workers and the three trade-opening API routes. Preserve pending rows; do not manually edit deposit status or balances.
2. Apply the full approved migration set in version order, including the three deposit contract/replay/ACL migrations above and the other approved intervening migrations.
3. Confirm `20261107211754_revoke_direct_deposit_credit_rpc_execution.sql` is recorded as applied. At this point `service_role` must no longer be able to execute the raw credit primitive.
4. Apply `20261108013000_deposit_chain_integrity_monitor.sql` only after the block identity columns from `20261104130000` exist.
5. Apply `20261108014000_restore_authenticated_presence_rpc.sql`.
6. Apply `20261108020000_guard_offline_ad_trade_opening.sql` only after the presence RPC migration; its online decision depends on the fresh `last_seen_at` heartbeat.
7. Apply `20261108030000_restore_2fa_rate_limit_contracts.sql` before enabling any user/admin 2FA challenge or support emergency flow.
8. Apply `20261108031000_restore_atomic_user_2fa_contracts.sql` to install the user enrollment, disable and one-time recovery RPCs.
9. Apply `20261108032000_restore_atomic_admin_2fa_contracts.sql` after confirming the canonical `verify_admin_login(uuid,uuid)` function is present.
10. Apply `20261108033000_restore_support_admin_emergency_contracts.sql` after the 2FA rate-limit and admin lifecycle contracts; support configuration and session events are audited transactionally.
11. Apply `20261108040000_add_restricted_user_status.sql` as a separate committed enum migration. Do not combine it with a migration that immediately uses the new enum label in the same transaction.
12. Apply `20261108041000_restore_admin_user_action_contracts.sql` only after the restricted enum and support-admin tables are present; it restores actor-bound account/role/freeze operations.
13. Apply `20261108042000_restore_admin_mark_paid_authorized_rpc.sql` after verifying the canonical mark-paid and strict full-admin helper dependencies.
14. Apply `20261108043000_restore_atomic_admin_dispute_settlement.sql` after verifying canonical escrow/dispute functions. Keep `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED` disabled until separately-approved isolated financial validation.
15. Run all eight SQL preflights in Section 5. Do not resume workers or trade-opening routes on a failure.
16. Deploy the compatible application release containing the leased deposit worker path, integrity monitor/quorum logic, 2FA, support-admin and admin-action contracts.
17. Confirm the deployed worker is running the intended release, then resume deposit ingestion, confirmation workers and trade-opening routes gradually while observing logs and database errors.

Do not roll the application back to a version that calls the raw canonical credit RPC after the ACL migration has revoked that permission. If the new release fails after the ACL migration, leave deposit workers paused and deploy a forward fix.

## 5. Required SQL preflights and post-deployment checks

Run these read-only preflights only after all approved migrations in Section 2 have been applied, especially after the final financial ACL migration:

1. `supabase/tests/deposit_confirmation_contract_preflight.sql`
2. `supabase/tests/terminal_deposit_registration_replay_preflight.sql`
3. `supabase/tests/deposit_credit_rpc_acl_preflight.sql`
4. `supabase/tests/deposit_chain_integrity_monitor_preflight.sql`
5. `supabase/tests/authenticated_presence_rpc_preflight.sql`
6. `supabase/tests/offline_ad_trade_opening_preflight.sql`
7. `supabase/tests/two_factor_support_admin_contract_preflight.sql`
8. `supabase/tests/admin_user_trade_action_contract_preflight.sql`

The first preflight also asserts the final server-only credit ACL, so do not use it as a pass criterion immediately after migration 1; run it after migration 3.

### Expected schema/API state

Verify all of the following:

- `onchain_deposits` has `confirmation_worker_id`, `confirmation_lease_expires_at`, `block_number`, `block_hash`, `integrity_check_owner`, `integrity_check_lease_expires_at`, `integrity_check_last_at`, and `integrity_check_next_at`.
- `deposits.block_hash` exists.
- The four deposit-confirmation RPCs and both integrity-monitor RPCs exist with the exact signatures in Section 1.
- The registration, claim, release, leased-credit and integrity-monitor wrappers are postgres-owned `SECURITY DEFINER` functions with empty `search_path`.
- The canonical `process_deposit_atomic` is postgres-owned, `SECURITY DEFINER`, and uses `search_path=pg_catalog`.
- `service_role` can execute registration/claim/release/leased-credit/integrity RPCs, but cannot execute `process_deposit_atomic` directly.
- `anon` and `authenticated` cannot execute any privileged deposit RPC.
- `deposit_chain_integrity_events` exists with RLS enabled and no direct table grants to public client roles or `service_role`.
- The active alert deduplication index `uq_system_alerts_active_dedupe_key` exists.
- `idx_onchain_deposits_confirmation_claim`, `idx_onchain_deposits_confirmed_block_identity`, and `idx_onchain_deposits_integrity_claim` exist.
- `admin_2fa_rate_limits` and `user_2fa_rate_limits` exist with RLS, service-role-only table access and the four exact rate-limit RPCs.
- User 2FA enrollment, disable and recovery-code RPCs exist with the exact signatures listed in the new 2FA/support preflight; the active recovery-code hash index is unique.
- Admin 2FA enable, disable, recovery and rotation RPCs exist and use canonical `verify_admin_login` actor resolution.
- The three support-admin tables exist with RLS and service-only direct table access; emergency sessions are limited to three hours with one unrevoked session per support account.
- Disabling a support-admin grant revokes its active sessions and the same RPC transaction writes the `CONFIGURE_SUPPORT_ADMIN` administrator audit entry.
- The `restricted` enum label exists before the account-status RPC is created.
- Admin role/status/freeze functions are postgres-owned SECURITY DEFINER functions, use the strict full-admin actor helper and remain inaccessible to PUBLIC/anon/authenticated; the last active full administrator cannot be demoted.
- Admin role changes match the deployed `app_admins(user_id, granted_at)` schema.
- Restricted/suspended/banned statuses and emergency freeze pause offers in `advertisements`, `ads` and `p2p_ads`; unfreeze does not reactivate them.
- Admin mark-paid uses the canonical mark-paid transition and writes the required audit without a direct wallet mutation.
- Admin dispute settlement checks the final dispute/trade state and has mandatory same-transaction audit; its runtime feature flag remains disabled pending separately approved isolated financial validation.

A successful migration command alone is not proof that the grants, function ownership, search paths and RLS state are correct. The SQL preflights must complete without exception.

### Legacy rows

The block-identity migration intentionally does not guess block hashes for historical credited deposits. Rows with null block identity will not be selected by the integrity monitor. Handle historical reconciliation as a separately evidenced manual review; never backfill a guessed hash or reverse customer balances automatically.

## 6. Chain provider configuration

The integrity monitor requires at least two independent HTTPS origins to agree on a canonical block hash before it records a mismatch.

- Ethereum and BNB Smart Chain use distinct origins from the configured chain RPC lists.
- Bitcoin requires `BTC_MEMPOOL_BACKUP_API`.
- Litecoin requires `LTC_MEMPOOL_BACKUP_API`.
- TRON requires `TRON_BACKUP_RPC_URL`.

Backup sources must be independent providers on the same mainnet and expose the matching block-height lookup endpoint. Two URLs on the same host are not independent. Without a quorum, the monitor must return `INCONCLUSIVE` and retry; it must not create a reorganisation alert.

## 7. Recovery and rollback safeguards

- Each migration has its own transaction. If it fails before commit, stop and inspect the error; that migration's transaction should roll back.
- If an earlier migration has committed and a later migration fails, keep deposit workers paused. Do not attempt a blind multi-migration reverse or continue the sequence.
- Use a reviewed forward-fix migration for ordinary schema or function corrections.
- Never restore `service_role` execution on the raw canonical credit RPC as a quick rollback.
- Never manually change deposit balances, ledger rows, deposit statuses, transaction hashes, block identities or worker leases to make a deployment appear healthy.
- Do not automatically reverse a customer's credited balance when a block mismatch is detected. Create an incident, preserve evidence and require a separately approved, audited manual resolution.
- Use Supabase PITR/backup restoration only under an explicit database incident plan; restoring financial state requires ledger and external-chain reconciliation before workers resume.

## 8. Go-live acceptance

Resume the deposit workers only when:

- migration history is reconciled and the approved ordered release is fully applied;
- all eight SQL preflights pass;
- the direct raw-credit grant is absent and guarded wrapper grants are correct;
- the compatible application commit is deployed;
- the required provider quorum variables are configured for the supported chains;
- worker logs show successful claims/completions without missing-RPC, ACL, lease or schema errors;
- the authenticated presence preflight passes before the offline-ad trade-opening guard is enabled;
- all three trade-opening routes can resolve advertiser availability through the installed RPC contract;
- admin role/status/freeze RPC preflight passes and the last active full administrator is protected;
- admin mark-paid RPC preflight passes; and
- dispute settlement remains feature-disabled until a separate, explicitly approved isolated financial validation.

No live financial transaction is required to establish these database and code-level acceptance conditions. The monitor is not operational until its migration is applied and its worker is running with valid provider quorum configuration.

---

**Current decision:** **NO-GO for production migration execution.** The historical migration-file reconciliation gate remains open, and confirmed application dependencies (deposit confirmation/integrity RPCs, presence, offline-ad trade-opening, 2FA lifecycle/rate-limit, support-admin and guarded admin account/trade RPCs) remain absent in production. The ten forward migrations and eight preflights are prepared and rollback-rehearsed only; no production migration has been applied. Keep admin dispute settlement feature-disabled.

See [the production migration reconciliation audit](production-migration-reconciliation.md) for confirmed missing RPC/table dependencies and superseded historical candidates.

## Appendix A. Tracked local migration files newer than the production head

Inventory only; this list records the 72 tracked local SQL files with versions greater than `20261103204401` after the current forward migrations are committed. It is **not** a blanket approval to apply them. Each file remains subject to the historical-file reconciliation and review gates above. If the release inventory changes, regenerate this list before a production window.

```text
20261104120000_withdrawal_confirmation_and_control_flags.sql
20261104130000_deposit_confirmation_contract.sql
20261104140000_least_privilege_financial_reads.sql
20261104150000_claim_sweep_reconciliation.sql
20261104160000_restore_deposit_sweep_nonce_allocator.sql
20261104170000_bind_hot_wallet_nonces_to_funding_operations.sql
20261104180000_record_evm_gas_funding_receipts.sql
20261104202853_restrict_direct_check_is_admin_rpc_access.sql
20261105100000_harden_signed_evm_sweep_persistence.sql
20261105110000_bind_evm_sweep_intent.sql
20261105120000_bind_btc_ltc_sweep_intent.sql
20261105130000_protect_signed_utxo_reservations.sql
20261105140000_proven_utxo_conflict_resolution.sql
20261105150000_require_utxo_finality_proof.sql
20261105160000_bind_reserved_utxo_values.sql
20261105170000_preserve_reserved_withdrawal_nonces.sql
20261105180000_serialize_shared_evm_hot_wallet_nonce_stream.sql
20261105190000_require_persisted_evm_withdrawal_receipts.sql
20261105200000_record_unresolved_evm_withdrawal_nonce_incidents.sql
20261105210000_record_unresolved_evm_gas_funding_nonce_incidents.sql
20261105220000_reconcile_authoritative_fee_configuration.sql
20261105230000_admin_platform_controls_atomic.sql
20261105240000_enforce_verified_registration.sql
20261105250000_atomic_buy_ad_creation.sql
20261105260000_withdrawal_replay_before_market_checks.sql
20261105270000_persist_admin_2fa_rate_limits.sql
20261105280000_restore_support_admin_emergency_mode.sql
20261105300000_harden_marketplace_rls_and_dml.sql
20261105310000_enforce_sell_ad_escrow_interlock.sql
20261105320000_restrict_financial_table_dml.sql
20261105330000_harden_remaining_financial_and_feedback_policies.sql
20261106000000_harden_paired_withdrawal_settlement.sql
20261106010000_restrict_legacy_trade_chat_client_writes.sql
20261106020000_lock_trade_counterparty_withdrawal_state.sql
20261106030000_retire_legacy_admin_escrow_rpcs_and_harden_expiry_search_path.sql
20261106040000_install_atomic_admin_dispute_settlement.sql
20261106050000_retire_legacy_wallet_transfer_rpc_and_verify_transfer_contract.sql
20261106060000_harden_withdrawal_admin_review_identity_and_paired_state.sql
20261106070000_prevent_refund_with_durable_withdrawal_state.sql
20261106080000_gate_stale_withdrawal_claims_on_nonce_state.sql
20261106112502_harden_evm_gas_funding_receipt_finality.sql
20261106114027_fence_sweeper_worker_leases_and_gas_funding_claims.sql
20261106115041_withdrawal_reconciliation_canonical_aggregation.sql
20261106121000_fence_withdrawal_confirmation_scheduler_claims.sql
20261107100000_fence_shared_evm_nonce_recovery_claims.sql
20261107120000_revoke_direct_hot_wallet_nonce_allocators.sql
20261107130000_revoke_direct_nonce_and_sweeper_table_writes.sql
20261107140000_repair_sweep_operations_ready_to_broadcast_status.sql
20261107150000_harden_sweep_status_and_tron_cleanup_rpcs.sql
20261107160000_restrict_legacy_financial_mutation_helpers.sql
20261107170000_snapshot_transfer_fee_rate_in_authoritative_receipt.sql
20261107180000_restrict_legacy_trade_kyc_helper_execution.sql
20261107200000_retire_legacy_trade_escrow_mutation_rpcs.sql
20261107210000_harden_trade_expiry_search_path.sql
20261107210306_guard_terminal_deposit_registration_replay.sql
20261107211754_revoke_direct_deposit_credit_rpc_execution.sql
20261107220000_guard_admin_trade_cancellation_on_open_dispute.sql
20261107230000_restore_admin_mark_paid_authorized_rpc.sql
20261107235500_restore_didit_webhook_event_leases.sql
20261108001000_retire_legacy_didit_kyc_status_writer.sql
20261108002000_secure_didit_kyc_session_initiation.sql
20261108013000_deposit_chain_integrity_monitor.sql
20261108014000_restore_authenticated_presence_rpc.sql
20261108020000_guard_offline_ad_trade_opening.sql
20261108030000_restore_2fa_rate_limit_contracts.sql
20261108031000_restore_atomic_user_2fa_contracts.sql
20261108032000_restore_atomic_admin_2fa_contracts.sql
20261108033000_restore_support_admin_emergency_contracts.sql
20261108040000_add_restricted_user_status.sql
20261108041000_restore_admin_user_action_contracts.sql
20261108042000_restore_admin_mark_paid_authorized_rpc.sql
20261108043000_restore_atomic_admin_dispute_settlement.sql
```
