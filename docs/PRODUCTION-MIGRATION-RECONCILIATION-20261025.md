# Paxones migration-chain reconciliation — 2026-10-25

## Release-blocking finding

Live migration metadata was queried read-only. Production reports 81 applied migration versions, from 20261011152650 through 20261016013425. The local `supabase/migrations` directory contains 144 `.sql` files, from 20260831000000 through 20261025100000. One production-applied migration file was recovered byte-for-byte from an authoritative reachable Git commit during this step.

- **80 of 81 production-applied version IDs still have no corresponding local SQL file.**
- **143 local version IDs are absent from the production migration ledger.** This does not automatically mean all are safe to apply; many are later intended changes, and the history must be reconciled first.
- The staging project's migration ledger currently contains **0** applied migrations and its schema is uninitialized. It is not a valid schema-matched integration target yet.
- The local version-format preflight only checks filename syntax and uniqueness; it does not prove correspondence with production history.

## Production-applied migrations missing locally

- `20261011160153` — `wallet_hardening_followup`
- `20261011160335` — `wallet_deposit_rpc_restrictions`
- `20261011160457` — `wallet_legacy_deposit_overload`
- `20261011161643` — `secure_wallet_provisioning_trigger`
- `20261011161817` — `enforce_atomic_withdrawal_limits`
- `20261011163228` — `restrict_wallet_lock_functions`
- `20261011163807` — `fix_wallet_transfer_search_path`
- `20261013202306` — `restrict_sensitive_escrow_and_sweep_rpc_execution`
- `20261013202340` — `restrict_sensitive_escrow_release_and_refund_rpcs`
- `20261013202420` — `restrict_unauthorized_admin_status_and_escrow_rpcs`
- `20261013202555` — `revoke_anon_access_to_p2p_trade_financial_rpcs`
- `20261013231919` — `revoke_unverified_legacy_deposit_credit_rpcs`
- `20261013232410` — `revoke_unverified_process_confirmed_deposit`
- `20261014022154` — `grant_service_role_process_deposit_atomic`
- `20261014023325` — `deposits_amount_must_be_positive`
- `20261014032736` — `harden_process_deposit_atomic_existing_identity`
- `20261015075956` — `ads_owner_insert_policy`
- `20261015080244` — `revoke_unattached_p2p_ads_trigger_function`
- `20261015080421` — `restrict_privileged_trade_rpcs`
- `20261015080715` — `repair_trade_expiry_accounting`
- `20261015080904` — `fail_closed_duplicate_wallet_assets`
- `20261015081007` — `delegate_expired_trade_cancellation`
- `20261015081159` — `fail_closed_missing_trade_asset`
- `20261015081306` — `idempotent_trade_expiry_refunds`
- `20261015081431` — `restrict_legacy_trade_cancellation`
- `20261015081602` — `remove_user_metadata_admin_trust_from_trade_cancel`
- `20261015081635` — `remove_user_metadata_admin_trust_from_escrow_release`
- `20261015081753` — `unique_trade_settlement_ledger_refs`
- `20261015082919` — `harden_legacy_process_trade_escrow_search_path`
- `20261015083653` — `harden_kyc_initiation_authorization`
- `20261015084029` — `restrict_direct_trade_trigger_function_execution`
- `20261015084120` — `restrict_hd_wallet_index_rpc`
- `20261015084314` — `restrict_seller_trade_stats_rpc`
- `20261015084355` — `restrict_user_block_counts_rpc`
- `20261015084456` — `restrict_kyc_failure_rpcs`
- `20261015084549` — `restrict_custom_access_token_hook`
- `20261015084643` — `restrict_handle_new_user_rpc`
- `20261015084748` — `restrict_orphaned_user_trigger_functions`
- `20261015084929` — `restrict_profile_status_trigger_function`
- `20261015085016` — `restrict_trade_volume_trigger_function`
- `20261015085058` — `restrict_unauthorized_profile_update_trigger`
- `20261015085143` — `restrict_usd_value_trade_trigger`
- `20261015085227` — `restrict_resolve_trade_ad_id_trigger`
- `20261015085315` — `restrict_sync_auth_metadata_trigger`
- `20261015085342` — `restrict_sync_trade_user_ids_trigger`
- `20261015085536` — `restrict_generate_random_username_rpc`
- `20261015085629` — `restrict_generate_system_username_rpc`
- `20261015085720` — `restrict_resolve_system_alert_rpc`
- `20261015085841` — `restrict_sync_didit_kyc_status_rpc`
- `20261015085934` — `restrict_update_user_presence_rpc`
- `20261015090026` — `restrict_sync_user_reputation_trigger_function`
- `20261015090116` — `harden_custom_trade_status_lower_search_path`
- `20261015090145` — `restrict_rls_auto_enable_event_trigger_function`
- `20261015090241` — `restrict_sync_profile_username_trigger_function`
- `20261015090443` — `harden_admin_update_user_role_audit_identity`
- `20261015090700` — `restrict_profile_mutations_and_protect_privileged_columns`
- `20261015090749` — `remove_server_managed_profile_column_updates`
- `20261015090828` — `restrict_profile_country_and_birthdate_updates`
- `20261015090923` — `protect_profile_kyc_status_from_public_reads`
- `20261015091019` — `protect_profile_country_from_public_reads`
- `20261015091105` — `restrict_public_profile_verification_flags`
- `20261015091148` — `restrict_public_profile_last_seen_timestamp`
- `20261015091409` — `harden_profile_update_trigger_search_path`
- `20261015091457` — `harden_transfer_immutability_trigger_search_path`
- `20261015091849` — `restrict_check_is_admin_rpc_to_trusted_callers`
- `20261015092011` — `harden_emergency_admin_rpc_search_paths`
- `20261015092105` — `harden_bulk_account_admin_rpc_search_paths`
- `20261015092153` — `harden_admin_role_and_login_rpc_search_paths`
- `20261015092309` — `restrict_unsafe_trade_settlement_rpcs`
- `20261015093122` — `enforce_trade_escrow_account_eligibility`
- `20261015093442` — `fail_closed_trade_escrow_account_status`
- `20261015100457` — `enforce_ad_fiat_limits_and_payment_methods`
- `20261015101100` — `fail_closed_invalid_trade_ad_price`
- `20261015102053` — `restrict_legacy_release_seller_escrow_rpc`
- `20261015102335` — `restrict_legacy_initiate_p2p_trade_rpc`
- `20261015102528` — `restrict_legacy_trade_completion_rpcs`
- `20261016013222` — `restrict_atomic_trade_cancellation_rpc`
- `20261016013259` — `restrict_escrow_trade_rpc_anonymous_access`
- `20261016013341` — `restrict_escrow_participant_rpcs_anonymous_access`
- `20261016013425` — `restrict_dispute_resolution_to_trusted_backend`

## Required safe remediation sequence

1. Freeze all deployment and `db push` activity. Do not attempt to apply the 143 local files in bulk.
2. Recover the exact historical SQL for the 81 production-applied versions from the authoritative source/backup/repository history, without guessing from current database definitions.
3. Compare file contents and checksums against the source that was actually deployed; restore files only after provenance is verified.
4. Reconcile locally renamed/deleted historical files and the newer pending migrations without editing already-applied production history.
5. Provision a schema-matched disposable staging database, replay the verified chain there, then test pending migrations in order and run auth/financial integration and concurrency tests.
6. Re-query the production migration ledger and privilege state read-only before any release proposal. Production changes require a separately reviewed deployment plan.

## Safety

No production SQL was written and no migration was applied by this audit. No push or deployment was performed.
## Recovery performed during this step

- Recovered `supabase/migrations/20261011152650_wallet_rpc_execute_restrictions.sql` from reachable Git commit `d27078952dd702937162fdbd2a3e05493c5d32d2` (`Record applied wallet RPC privilege lockdown`, 2026-10-11).
- Verified the restored file's Git blob hash is exactly `f85c343002a2bcb93f1fcfb212011f8bfcf8c12c`, matching the source commit.
- The file is restored in the working tree but remains untracked/unstaged; no commit or push was made.
- A scan of reachable migration-path history found only this one exact production version; the other 80 applied migration bodies still require authoritative recovery.

## Alternate-name source search (all reachable Git history)

A second pass compared the **migration names**, ignoring the 14-digit version prefix. This is more informative than exact filename matching, but it is not enough to certify deployed SQL body identity.

- **71 of 81** production migration names have at least one same-name SQL file in reachable Git history under a different timestamp prefix.
- **10 of 81** production migration names have no same-name SQL file in reachable Git history.
- The recovered exact-version migration `20261011152650_wallet_rpc_execute_restrictions.sql` is byte-for-byte verified against Git blob `f85c343002a2bcb93f1fcfb212011f8bfcf8c12c`.
- Do not rename or copy the 71 alternate-prefix candidates to production version IDs until commit provenance, blob hashes, and deployed behavior are checked. Name equality alone is not proof of body equality.

### Alternate-prefix candidate map

- Production `20261011152650` `wallet_rpc_execute_restrictions` → candidate(s): `20261011000000_wallet_rpc_execute_restrictions.sql`, `20261011152650_wallet_rpc_execute_restrictions.sql`
- Production `20261011160153` `wallet_hardening_followup` → candidate(s): `20261011170000_wallet_hardening_followup.sql`
- Production `20261011160335` `wallet_deposit_rpc_restrictions` → candidate(s): `20261011171000_wallet_deposit_rpc_restrictions.sql`
- Production `20261011160457` `wallet_legacy_deposit_overload` → candidate(s): `20261011172000_wallet_legacy_deposit_overload.sql`
- Production `20261011161643` `secure_wallet_provisioning_trigger` → candidate(s): `20261011173000_secure_wallet_provisioning_trigger.sql`
- Production `20261011161817` `enforce_atomic_withdrawal_limits` → candidate(s): `20261011174000_enforce_atomic_withdrawal_limits.sql`
- Production `20261011163228` `restrict_wallet_lock_functions` → candidate(s): `20261011175000_restrict_wallet_lock_functions.sql`
- Production `20261011163807` `fix_wallet_transfer_search_path` → candidate(s): `20261011164000_fix_wallet_transfer_search_path.sql`
- Production `20261013231919` `revoke_unverified_legacy_deposit_credit_rpcs` → candidate(s): `20261014000000_revoke_unverified_legacy_deposit_credit_rpcs.sql`
- Production `20261013232410` `revoke_unverified_process_confirmed_deposit` → candidate(s): `20261014010000_revoke_unverified_process_confirmed_deposit.sql`
- Production `20261014032736` `harden_process_deposit_atomic_existing_identity` → candidate(s): `20261014040000_harden_process_deposit_atomic_existing_identity.sql`
- Production `20261015075956` `ads_owner_insert_policy` → candidate(s): `20261015000200_ads_owner_insert_policy.sql`
- Production `20261015080244` `revoke_unattached_p2p_ads_trigger_function` → candidate(s): `20261015000300_revoke_unattached_p2p_ads_trigger_function.sql`
- Production `20261015080421` `restrict_privileged_trade_rpcs` → candidate(s): `20261015000400_restrict_privileged_trade_rpcs.sql`
- Production `20261015080715` `repair_trade_expiry_accounting` → candidate(s): `20261015000500_repair_trade_expiry_accounting.sql`
- Production `20261015080904` `fail_closed_duplicate_wallet_assets` → candidate(s): `20261015000600_fail_closed_duplicate_wallet_assets.sql`
- Production `20261015081007` `delegate_expired_trade_cancellation` → candidate(s): `20261015000700_delegate_expired_trade_cancellation.sql`
- Production `20261015081159` `fail_closed_missing_trade_asset` → candidate(s): `20261015000800_fail_closed_missing_trade_asset.sql`
- Production `20261015081306` `idempotent_trade_expiry_refunds` → candidate(s): `20261015000900_idempotent_trade_expiry_refunds.sql`
- Production `20261015081431` `restrict_legacy_trade_cancellation` → candidate(s): `20261015001000_restrict_legacy_trade_cancellation.sql`
- Production `20261015081602` `remove_user_metadata_admin_trust_from_trade_cancel` → candidate(s): `20261015001100_remove_user_metadata_admin_trust_from_trade_cancel.sql`
- Production `20261015081635` `remove_user_metadata_admin_trust_from_escrow_release` → candidate(s): `20261015001200_remove_user_metadata_admin_trust_from_escrow_release.sql`
- Production `20261015081753` `unique_trade_settlement_ledger_refs` → candidate(s): `20261015001300_unique_trade_settlement_ledger_refs.sql`
- Production `20261015082919` `harden_legacy_process_trade_escrow_search_path` → candidate(s): `20261015081840_harden_legacy_process_trade_escrow_search_path.sql`
- Production `20261015083653` `harden_kyc_initiation_authorization` → candidate(s): `20261015090000_harden_kyc_initiation_authorization.sql`
- Production `20261015084029` `restrict_direct_trade_trigger_function_execution` → candidate(s): `20261015091000_restrict_direct_trade_trigger_function_execution.sql`
- Production `20261015084120` `restrict_hd_wallet_index_rpc` → candidate(s): `20261015092000_restrict_hd_wallet_index_rpc.sql`
- Production `20261015084314` `restrict_seller_trade_stats_rpc` → candidate(s): `20261015094000_restrict_seller_trade_stats_rpc.sql`
- Production `20261015084355` `restrict_user_block_counts_rpc` → candidate(s): `20261015095000_restrict_user_block_counts_rpc.sql`
- Production `20261015084456` `restrict_kyc_failure_rpcs` → candidate(s): `20261015100000_restrict_kyc_failure_rpcs.sql`
- Production `20261015084549` `restrict_custom_access_token_hook` → candidate(s): `20261015101000_restrict_custom_access_token_hook.sql`
- Production `20261015084643` `restrict_handle_new_user_rpc` → candidate(s): `20261015102000_restrict_handle_new_user_rpc.sql`
- Production `20261015084748` `restrict_orphaned_user_trigger_functions` → candidate(s): `20261015103000_restrict_orphaned_user_trigger_functions.sql`
- Production `20261015084929` `restrict_profile_status_trigger_function` → candidate(s): `20261015105000_restrict_profile_status_trigger_function.sql`
- Production `20261015085016` `restrict_trade_volume_trigger_function` → candidate(s): `20261015110000_restrict_trade_volume_trigger_function.sql`
- Production `20261015085058` `restrict_unauthorized_profile_update_trigger` → candidate(s): `20261015111000_restrict_unauthorized_profile_update_trigger.sql`
- Production `20261015085143` `restrict_usd_value_trade_trigger` → candidate(s): `20261015112000_restrict_usd_value_trade_trigger.sql`
- Production `20261015085227` `restrict_resolve_trade_ad_id_trigger` → candidate(s): `20261015113000_restrict_resolve_trade_ad_id_trigger.sql`
- Production `20261015085315` `restrict_sync_auth_metadata_trigger` → candidate(s): `20261015114000_restrict_sync_auth_metadata_trigger.sql`
- Production `20261015085342` `restrict_sync_trade_user_ids_trigger` → candidate(s): `20261015115000_restrict_sync_trade_user_ids_trigger.sql`
- Production `20261015085536` `restrict_generate_random_username_rpc` → candidate(s): `20261015120000_restrict_generate_random_username_rpc.sql`
- Production `20261015085629` `restrict_generate_system_username_rpc` → candidate(s): `20261015121000_restrict_generate_system_username_rpc.sql`
- Production `20261015085720` `restrict_resolve_system_alert_rpc` → candidate(s): `20261015122000_restrict_resolve_system_alert_rpc.sql`
- Production `20261015085841` `restrict_sync_didit_kyc_status_rpc` → candidate(s): `20261015123000_restrict_sync_didit_kyc_status_rpc.sql`
- Production `20261015085934` `restrict_update_user_presence_rpc` → candidate(s): `20261015124000_restrict_update_user_presence_rpc.sql`
- Production `20261015090026` `restrict_sync_user_reputation_trigger_function` → candidate(s): `20261015125000_restrict_sync_user_reputation_trigger_function.sql`
- Production `20261015090116` `harden_custom_trade_status_lower_search_path` → candidate(s): `20261015130000_harden_custom_trade_status_lower_search_path.sql`
- Production `20261015090145` `restrict_rls_auto_enable_event_trigger_function` → candidate(s): `20261015131000_restrict_rls_auto_enable_event_trigger_function.sql`
- Production `20261015090241` `restrict_sync_profile_username_trigger_function` → candidate(s): `20261015132000_restrict_sync_profile_username_trigger_function.sql`
- Production `20261015090443` `harden_admin_update_user_role_audit_identity` → candidate(s): `20261015133000_harden_admin_update_user_role_audit_identity.sql`
- Production `20261015090700` `restrict_profile_mutations_and_protect_privileged_columns` → candidate(s): `20261015134000_restrict_profile_mutations_and_protect_privileged_columns.sql`
- Production `20261015090749` `remove_server_managed_profile_column_updates` → candidate(s): `20261015135000_remove_server_managed_profile_column_updates.sql`
- Production `20261015090828` `restrict_profile_country_and_birthdate_updates` → candidate(s): `20261015140000_restrict_profile_country_and_birthdate_updates.sql`
- Production `20261015090923` `protect_profile_kyc_status_from_public_reads` → candidate(s): `20261015141000_protect_profile_kyc_status_from_public_reads.sql`
- Production `20261015091019` `protect_profile_country_from_public_reads` → candidate(s): `20261015142000_protect_profile_country_from_public_reads.sql`
- Production `20261015091105` `restrict_public_profile_verification_flags` → candidate(s): `20261015143000_restrict_public_profile_verification_flags.sql`
- Production `20261015091148` `restrict_public_profile_last_seen_timestamp` → candidate(s): `20261015144000_restrict_public_profile_last_seen_timestamp.sql`
- Production `20261015091409` `harden_profile_update_trigger_search_path` → candidate(s): `20261015150000_harden_profile_update_trigger_search_path.sql`
- Production `20261015091457` `harden_transfer_immutability_trigger_search_path` → candidate(s): `20261015151000_harden_transfer_immutability_trigger_search_path.sql`
- Production `20261015091849` `restrict_check_is_admin_rpc_to_trusted_callers` → candidate(s): `20261015162000_restrict_check_is_admin_rpc_to_trusted_callers.sql`
- Production `20261015092011` `harden_emergency_admin_rpc_search_paths` → candidate(s): `20261015164000_harden_emergency_admin_rpc_search_paths.sql`
- Production `20261015092105` `harden_bulk_account_admin_rpc_search_paths` → candidate(s): `20261015165000_harden_bulk_account_admin_rpc_search_paths.sql`
- Production `20261015092153` `harden_admin_role_and_login_rpc_search_paths` → candidate(s): `20261015170000_harden_admin_role_and_login_rpc_search_paths.sql`
- Production `20261015092309` `restrict_unsafe_trade_settlement_rpcs` → candidate(s): `20261015171000_restrict_unsafe_trade_settlement_rpcs.sql`
- Production `20261015093122` `enforce_trade_escrow_account_eligibility` → candidate(s): `20261015181000_enforce_trade_escrow_account_eligibility.sql`
- Production `20261015093442` `fail_closed_trade_escrow_account_status` → candidate(s): `20261015183000_fail_closed_trade_escrow_account_status.sql`
- Production `20261015100457` `enforce_ad_fiat_limits_and_payment_methods` → candidate(s): `20261015190000_enforce_ad_fiat_limits_and_payment_methods.sql`
- Production `20261015101100` `fail_closed_invalid_trade_ad_price` → candidate(s): `20261015133000_fail_closed_invalid_trade_ad_price.sql`
- Production `20261015102053` `restrict_legacy_release_seller_escrow_rpc` → candidate(s): `20261015194500_restrict_legacy_release_seller_escrow_rpc.sql`
- Production `20261015102335` `restrict_legacy_initiate_p2p_trade_rpc` → candidate(s): `20261015200000_restrict_legacy_initiate_p2p_trade_rpc.sql`
- Production `20261015102528` `restrict_legacy_trade_completion_rpcs` → candidate(s): `20261015201500_restrict_legacy_trade_completion_rpcs.sql`

### No same-name file found in reachable history

- `20261013202306` — `restrict_sensitive_escrow_and_sweep_rpc_execution`
- `20261013202340` — `restrict_sensitive_escrow_release_and_refund_rpcs`
- `20261013202420` — `restrict_unauthorized_admin_status_and_escrow_rpcs`
- `20261013202555` — `revoke_anon_access_to_p2p_trade_financial_rpcs`
- `20261014022154` — `grant_service_role_process_deposit_atomic`
- `20261014023325` — `deposits_amount_must_be_positive`
- `20261016013222` — `restrict_atomic_trade_cancellation_rpc`
- `20261016013259` — `restrict_escrow_trade_rpc_anonymous_access`
- `20261016013341` — `restrict_escrow_participant_rpcs_anonymous_access`
- `20261016013425` — `restrict_dispute_resolution_to_trusted_backend`

### Next safe recovery gate

For each alternate-prefix candidate, trace the commit that introduced it and any later timestamp rename, inspect its blob hash and SQL body, and compare the resulting authorization/schema effects with read-only production catalogs. Only restore historical SQL when the exact deployed body can be established from an authoritative artifact. For the ten unmatched names, seek the original deployment bundle, CI artifact, PR attachment, or verified backup; do not reconstruct from the live schema.
## Candidate-source triage — not yet accepted as historical replacements

A follow-up commit-subject/path review found several related SQL sources, but their version prefixes differ from production's ledger. These are leads for forensic comparison only; they must not be copied or renamed into the active migration directory as if they were exact deployed files.

| Production ledger entry still missing exact file | Related reachable Git source | Evidence | Decision |
|---|---|---|---|
| `20261014023325 deposits_amount_must_be_positive` | Commit `9eb85e139bf61e97a02079fef88c36a588431947`, file `20261014030000_deposits_amount_positive_check.sql` | Related migration committed 2026-10-14, but version prefix and name differ | Candidate only; compare SQL body and deployed constraint |
| `20261013202306 restrict_sensitive_escrow_and_sweep_rpc_execution` | Commit `7822c18570746f1825d57ccdda70e9aab5ba5bb1`, file `20261012000200_restrict_high_risk_financial_rpcs.sql` | Earlier proposal to restrict high-risk financial RPCs | Candidate only; must prove the deployed grants/body match |
| `20261013202340 restrict_sensitive_escrow_release_and_refund_rpcs` | Commit `088188ce54f86d56210a026d80e7bab816e988da`, file `20261015194500_restrict_legacy_release_seller_escrow_rpc.sql` | Related legacy escrow RPC restriction committed 2026-10-15 | Candidate only; date/name/body not identical |
| `20261013202420 restrict_unauthorized_admin_status_and_escrow_rpcs` | Commit `e9c1e29beaf44ea954115f7bfd08d93a2774771a`, file `20261015120000_enforce_trade_account_restrictions_in_escrow.sql` | Related escrow account restrictions | Candidate only; not proof of deployed migration identity |
| `20261013202555 revoke_anon_access_to_p2p_trade_financial_rpcs` | Commit `ddd9b899b2110e23f3c8a6e426f5d58e5f113e1a`, file `supabase/tests/p2p_financial_rpc_security_checks.sql` | Regression assertions exist; this is a test file, not the missing migration | Test evidence only; no migration body recovered |
| `20261014022154 grant_service_role_process_deposit_atomic` | Current repository contains `20261001000000_canonical_process_deposit_atomic_part6k7.sql` | Related deposit RPC implementation, but different version and broad scope | Candidate only; do not treat as exact deployed grant migration |
| `20261016013222 restrict_atomic_trade_cancellation_rpc` | Existing local cancellation/authorization migrations dated 2026-10-03 and later | Similar authorization area exists in repo history | No exact historical source verified |
| `20261016013259 restrict_escrow_trade_rpc_anonymous_access` | Existing local escrow hardening migrations dated 2026-09-28 and later | Similar RPC access controls exist | No exact historical source verified |
| `20261016013341 restrict_escrow_participant_rpcs_anonymous_access` | Existing local escrow hardening migrations dated 2026-09-28 and later | Similar RPC access controls exist | No exact historical source verified |
| `20261016013425 restrict_dispute_resolution_to_trusted_backend` | Commit history contains `20261015000100_restrict_dispute_resolution_rpc.sql` and `20261015000101_restrict_dispute_resolution_rpc.sql` | Related dispute RPC migrations have different prefixes and names | Candidate only; must compare body, grants, and deployed function signature |

The candidate rows above do **not** reduce the count of missing exact historical migration bodies. They are not restored into the active migration chain. Production remains read-only.

## Read-only production RPC revalidation — 2026-10-25

A targeted read-only query against production catalog metadata rechecked key RPCs and EXECUTE grants. No database writes were performed.

| RPC | anon | authenticated | service_role | Assessment |
|---|---:|---:|---:|---|
| process_deposit_atomic(...) | No | No | Yes | Service-only grant is present. Body validates positive amounts and network/token constraints; caller/provider and deployed-body provenance still require review. |
| admin_resolve_dispute(...) | No | No | Yes | Grant is service-only, but body trusts caller-supplied p_admin_id when checking admin profile. Server caller identity must be enforced. |
| finalize_p2p_release(...) | No | No | Yes | Grant is service-only. Function mutates wallet/trade state without checking caller identity itself; preserve service-only boundary and audit call sites. |
| mark_p2p_trade_paid(...) | No | Yes | Yes | Authenticated execution remains enabled. Body references raw_user_meta_data->>'role' as an admin check; user-editable metadata must not grant admin authority. |
| raise_trade_dispute(...) | No | Yes | Yes | Authenticated execution remains enabled. Body also checks raw_user_meta_data->>'role' as an admin signal. |
| cancel_p2p_trade(...) | No | Yes | Yes | Authenticated execution remains enabled; continue reviewing identity/ownership checks and caller contract. |
| initiate_didit_kyc(uuid,text) | No | Yes | Yes | Authenticated execution remains enabled. Body references auth.uid(), but metadata alone does not prove supplied target user ID is bound to caller. |
| verify_admin_login(uuid,uuid) | No | Yes | Yes | Authenticated execution remains enabled; signature accepts two caller-supplied UUIDs, so identity binding must be verified in body and tested. |
| initiate_trade_with_escrow(...) | No | Yes | Yes | Authenticated execution remains enabled; verify caller identity is derived from session rather than trusted from arguments. |

### Security advisor snapshot

The production security advisor returned:
- 18 SECURITY DEFINER functions executable by authenticated (warning category; each requires review against intended client/service caller design).
- 3 tables with RLS enabled and no policies: user_2fa_pending_enrollments, user_2fa_recovery_codes, and user_security_audit_logs. This may be intentionally deny-all for server-only tables, but intended access must be documented and tested rather than adding broad policies.
- Advisor snapshot timestamp: 2026-10-25T05:05:47Z. Findings are not proof of exploitability by themselves.

### Gate / disposition

- Production remains read-only; no grants, policies, function definitions, or rows were changed.
- Do not apply local remediation migrations yet. Migration history is not reconciled, and grant-only changes can break legitimate callers if the caller map is incomplete.
- Next action: inspect deployed definitions and application call sites for initiate_didit_kyc, verify_admin_login, mark_p2p_trade_paid, raise_trade_dispute, and cancel_p2p_trade; then add authenticated negative tests and a server-only caller test plan before drafting a forward-only migration.

## Application caller-map checkpoint — 2026-10-25

Call-site inspection established the following contracts in the current worktree:

- KYC initiation API route uses getSupabaseAdminClient() for the atomic initiate_didit_kyc RPC after authenticating the user and requiring verifyServerAdmin for cross-user requests. The proposed service_role-only grant is consistent with this caller, subject to end-to-end environment validation.
- Admin login page calls verify_admin_login with only user_uuid equal to the freshly authenticated Supabase user ID. The local prepared migration checks both optional UUID parameters against auth.uid() for non-service callers; the single-argument named call is compatible with that shape.
- The P2P mark-paid route authenticates via supabase.auth.getUser() and calls mark_p2p_trade_paid with p_caller_id set to the authenticated user ID. It uses the anon/publishable client with the user's session, so authenticated EXECUTE must remain for this user-facing RPC unless the route is deliberately redesigned.
- The P2P dispute route similarly authenticates via getUser() and passes the authenticated user ID to raise_trade_dispute; authenticated EXECUTE is part of its current contract.

Static regression checks run in this step:
- trusted caller fallback migration contract tests: 2 passed
- trade RPC user-metadata admin trust migration contract checks: passed
- verify_admin_login migration contract checks: passed
- Didit RPC restriction migration contract checks: passed
- Didit initiation config-guard tests: 4 passed

These are static tests only. They do not execute the candidate migrations in PostgreSQL or prove runtime behavior. The live grant snapshot and local caller contracts are now documented; the remaining gate is isolated-database execution against a reconciled schema, including negative tests for cross-user KYC, spoofed admin metadata, arbitrary UUID admin probes, and authenticated non-participant trade actions.

## Follow-up: security-advisor refresh and caller-contract review

Read-only production Security Advisor snapshot refreshed at **2026-10-25T05:08:52.666Z**:

- 18 `SECURITY DEFINER` functions remain executable by `authenticated`. The advisor reports this as a warning; each must be evaluated against the intended caller model rather than blanket-revoked.
- The warning list explicitly includes `cancel_p2p_trade`, `initiate_didit_kyc`, `initiate_trade_with_escrow`, `mark_p2p_trade_paid`, `raise_trade_dispute`, and `verify_admin_login`, as well as admin operations. This confirms that the previously prepared local KYC EXECUTE restriction has **not** been applied to production as of this snapshot.
- Three RLS-enabled tables still have no policies: `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. This may be an intentional deny-all design for server-managed security data; do not add broad policies solely to silence the advisor.

### API caller contract observations

Inspected the current worktree route handlers:

- `src/app/api/p2p/trades/[tradeId]/cancel/route.ts` authenticates with `supabase.auth.getUser()` and sends the session user's ID as `p_caller_id` to `cancel_p2p_trade`.
- `src/app/api/p2p/trades/[tradeId]/pay/route.ts` authenticates and sends the session user's ID to `mark_p2p_trade_paid`.
- `src/app/api/p2p/trades/[tradeId]/dispute/route.ts` authenticates and sends the session user's ID to `raise_trade_dispute`.

These route checks are useful but are **not sufficient on their own**: PostgREST RPCs can be called directly by an authenticated client, bypassing these application routes. Each function must derive the caller from the verified session (`auth.uid()`) or reject a supplied caller ID that differs from it; admin-only actions need a trusted server-side/admin-role check inside the function or a service-only boundary. Current production function bodies and deployed migration bodies must be reconciled before this contract can be certified.

### Scope and limits

- Production remains read-only; no policy, grant, function, or data changes were made.
- This is a refreshed advisor snapshot plus static application call-site inspection, not an end-to-end authorization test.
- The historical migration-chain gap remains release-blocking. No candidate migration was renamed or applied.


## Follow-up: privileged RPC caller-path audit

A read-only production catalog summary was taken for the named privileged/escrow RPCs. All listed functions are `SECURITY DEFINER`. Production bodies show:

- `admin_resolve_dispute(uuid,uuid,text,text)`: references `app_admins`/admin checks but does not reference `auth.uid()`. This can be acceptable only while EXECUTE remains restricted to `service_role` and every service caller independently verifies the administrator; do not grant it to authenticated clients without identity-binding changes.
- `finalize_p2p_release(uuid,uuid,numeric,text)`: does not reference `auth.uid()` or a detected admin check. Keep its existing service-role-only boundary; it must never become a client-callable RPC without a full identity/participant authorization redesign.
- `admin_freeze_user`, `admin_unfreeze_user`, `admin_set_emergency_mode`, `admin_update_user_role`, `execute_bulk_ban_atomic`, and `execute_bulk_unban_atomic` reference `auth.uid()` and server-controlled admin-check logic in their deployed definitions. They still need negative authorization tests, especially mismatched supplied admin IDs, non-admin authenticated callers, and self-role changes.

### Application caller observations

- Admin dispute-resolution route `src/app/api/admin/disputes/[tradeId]/route.ts` uses `verifyServerAdmin(req)` before calling service-role escrow/cancel RPCs and passes the verified admin ID. The server action in `src/app/adminnarayan/disputes/actions.ts` also calls `verifyServerAdmin()` first.
- Seller-facing release routes `src/app/api/p2p/trades/[tradeId]/release/route.ts` and `src/app/api/p2p/trade/release/route.ts` authenticate the session, enforce configured 2FA, then call `release_trade_escrow` with the session user ID through a service-role client. This route-level authentication is not a substitute for the database function's participant/role checks. Verify the deployed function enforces that the supplied caller is the trade's authorized seller (or a verified admin) before any settlement.
- `src/lib/services/escrowService.ts` exports `createTradeWithEscrow`, which calls `initiate_trade_with_escrow` through a service-role client but does not pass `p_caller_id`. A repository search found no callers of this helper beyond its own export, so it appears unused today; if it is reintroduced, it must accept a server-verified user ID and pass it explicitly, or be removed. The prepared trusted-caller migration would reject a null caller for service-role execution.
- Four user-session trade creation routes were inspected. Three explicitly pass the authenticated `user.id`; `src/app/api/trades/route.ts` relies on the authenticated session's `auth.uid()` and does not pass a caller ID. That is acceptable only if it continues using the session-bound client and the deployed RPC derives identity from `auth.uid()`.

### Tests and limitations

- `tests/trusted-caller-fallback-migration.test.ts`: 2 passed.
- `tests/trade-rpc-admin-metadata-migration.test.ts`: passed.
- `tests/server-admin-auth-metadata.test.ts`: passed.
- These tests validate source/migration contracts, not deployed PostgreSQL execution or live authorization behavior. Production remains read-only and the migration-chain reconciliation is still a release blocker.


## Follow-up: live transfers write-boundary recheck

A read-only production catalog check on 2026-10-25 found:

- The `transfers` table still has an INSERT RLS policy named `Users can insert transfers as sender`, whose check only binds `sender_id = auth.uid()`. This policy is weaker than the intended immutable financial-history design and should be removed during a verified migration.
- The same table currently has multiple overlapping service-role policies and duplicate/overlapping SELECT policies. They should be normalized only after the deployed migration baseline is recovered.
- The table grants query returned **no INSERT privilege for `anon` or `authenticated`**, while `service_role` has INSERT. Thus the residual user INSERT policy is presently not sufficient by itself to insert rows through normal PostgREST privileges. Keep the finding open because policy/grant drift can recur and the policy remains contrary to the intended contract.
- Production was not modified.

Targeted local checks:
- `tests/financial-write-guard-migration.test.ts`: passed (static migration-contract check).
- `tests/transfer-rpc-validation.test.ts`: 4 passed.
- `git diff --check`: passed; Git emitted only line-ending conversion warnings.

### Release implication

The local migration `20261018110000_restrict_public_financial_write_policies.sql` contains the intended removal of the user INSERT policy and revocation of client INSERT privileges, but the production migration ledger does not establish that this file was deployed under that version. Do not mark the production fix as applied based on local code alone. Resolve exact migration provenance and compare the resulting schema before any production change.


## Follow-up: internal wallet transfer RPC contract

Reviewed the local canonical transfer migration and its API route.

- `src/app/api/wallet/transfer/route.ts` derives the sender from `supabase.auth.getUser()`, requires an idempotency key, calls `execute_internal_transfer` through the server-side admin client, and validates the returned sender, recipient, asset, amount, fee, and balance fields before reporting success.
- Local migration `20261002000000_canonical_internal_transfer_and_platform_fee.sql` defines the five-argument RPC, uses a fixed search path, has a non-service caller identity check, takes an idempotency advisory lock, and revokes execute from PUBLIC/anon/authenticated while granting it to service_role/postgres.
- Added `tests/internal-transfer-security-contract.test.ts` as a static regression guard for this route/migration contract.
- Tests: internal transfer contract 3/3 passed; transfer response validation 4/4 passed; `git diff --check` passed with existing line-ending warnings.

**Important limitation:** this confirms local source contracts only. Production migration reconciliation remains unresolved, so this does not prove the same function body/grants are deployed in production. No production database changes were made.


## Follow-up: deployed trade RPC authorization gaps (read-only production check)

- `release_trade_escrow(uuid,uuid)` is SECURITY DEFINER and its live ACL is limited to `postgres` and `service_role`. The seller release API routes authenticate the session before invoking it through the service-role client.
- `cancel_p2p_trade(uuid,uuid,text)` is executable by `authenticated` and `service_role`. Its live body trusts `p_caller_id` when `auth.uid()` is NULL without first requiring service-role execution. The prepared local fallback-hardening migration is not reflected in the live body.
- `mark_p2p_trade_paid(uuid,uuid,text)` is executable by `authenticated` and `service_role`. Its live body has the same caller-ID fallback and checks `raw_user_meta_data->>'role'` as an admin signal. User-editable metadata must not grant admin authority.
- `raise_trade_dispute(uuid,uuid,text)` is executable by `authenticated` and `service_role`. Its live body trusts a supplied user ID when `auth.uid()` is NULL and includes user-editable Auth metadata and profile role fields in admin checks.
- Prepared local migrations `20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql` and `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql` target these issues, but remain unapplied/unverified pending migration reconciliation and isolated PostgreSQL testing.

### Targeted checks
- `tests/trusted-caller-fallback-migration.test.ts`: 2/2 passed.
- `tests/trade-rpc-admin-metadata-migration.test.ts`: passed.
- `git diff --check`: passed with line-ending warnings.

### Priority
Treat caller-ID fallback and user-metadata admin checks as release-blocking database authorization findings until the migrations are proven deployed and negative authorization tests pass. Production remained read-only.


## Follow-up: pre-deployment validation caught a flaw in the prepared escrow hardening migration

Before attempting any schema change, compared `20261019170000_harden_release_cancel_escrow_rpc_auth.sql` against the live read-only definitions of `release_trade_escrow(uuid,uuid)` and `cancel_p2p_trade(uuid,uuid,text)`.

Two blockers were found in the prepared migration:

1. **It does not match the deployed function body.** The migration searches for the exact assignment `v_effective_caller := COALESCE(p_caller_id, v_auth_uid);`, but both live functions use an `IF v_auth_uid IS NOT NULL ... ELSE ... v_effective_caller := p_caller_id; END IF` branch. The migration should fail closed rather than patch these deployed functions, so it cannot currently remediate the live finding.
2. **The proposed trust guard is unsafe inside SECURITY DEFINER.** It allows the condition to be bypassed when `current_user` is `postgres` or `service_role`; `current_user` reflects the function owner under SECURITY DEFINER, not necessarily the request's original caller. Therefore this check cannot safely distinguish an authenticated user from a service-role caller.

Do not deploy this migration as written. Replace the caller check with a guard based on verified request identity/role (and the actual deployed body shape), then validate the resulting migration and negative authorization cases in an isolated PostgreSQL environment. No production changes were made.


## Follow-up: corrected escrow caller migration (static validation only)

Reworked `20261019170000_harden_release_cancel_escrow_rpc_auth.sql` to target the verified live caller block in `release_trade_escrow(uuid,uuid)` and `cancel_p2p_trade(uuid,uuid,text)`. The patch now fails closed unless the expected block occurs exactly once in each function, uses `auth.role() = 'service_role'` for the unauthenticated trusted-caller fallback, and removes the unsafe `current_user` ownership test. Added `tests/release-cancel-escrow-caller-hardening.test.ts`.

Checks: new migration contract test passed; trusted-caller fallback tests 2/2 passed; admin-metadata migration contract test passed; `git diff --check` passed with existing line-ending warnings.

**Important limitation:** These are static source-contract checks only. The machine currently has no Docker, Podman, `psql`, or PostgreSQL server available, so the SQL migration has not been executed against a disposable PostgreSQL instance and no live authorization behavior has been tested. Keep this migration unapplied until isolated SQL replay and negative caller tests pass. Production remains unchanged.


### Second pass: made escrow caller patch less brittle

Further reviewed the migration against the original local escrow migration and relaxed the caller-block matcher to tolerate the deployed functions' differing exception text while still requiring exactly one structurally matching IF/ELSE block per target. Removed the unrelated user-metadata rewrite from this migration; admin-metadata cleanup remains a separate migration concern. The caller guard still derives authenticated identity from `auth.uid()` and permits the fallback only when `auth.role()` is `service_role`; it does not use `current_user` as an authorization signal.

Retests: `tests/release-cancel-escrow-caller-hardening.test.ts` passed; trusted-caller migration tests 2/2 passed; `git diff --check` passed with line-ending warnings. A test assertion initially failed because it flagged an explanatory comment mentioning `current_user`; the assertion was narrowed to reject executable identity checks, and the tests then passed.

Still not runtime-validated: no local PostgreSQL/container runtime is installed. Do not apply this migration until a disposable database replay confirms both target function definitions match the regex and negative authorization tests pass.


## Follow-up: staging transaction test of escrow caller guard

Used the separate `cleanp2p-staging` Supabase project (`tazvjyrdondcrdrkggqe`) for a transaction-scoped SQL test. The test created temporary minimal SECURITY DEFINER functions matching the live caller-block shape, applied the migration's regex patch logic, asserted the resulting guards, and rolled the transaction back. A follow-up query confirmed both test functions were absent after rollback.

Behavior checks passed in the disposable transaction: an `authenticated`-role request with no user ID was denied for both release and cancellation; a mismatched authenticated caller ID was denied; a matching authenticated identity was accepted; and the service-role fallback was accepted. This validates the guard logic against controlled stubs, not the complete financial RPC behavior.

Also ran a read-only query against the live production function definitions. The exact caller-block matcher returned exactly one match for both `public.release_trade_escrow(uuid,uuid)` and `public.cancel_p2p_trade(uuid,uuid,text)`; both are SECURITY DEFINER and return JSONB. No production changes were made.

**Remaining gate:** the transaction test used minimal stub functions, not the complete production bodies. Before deployment, replay the full migration against a disposable schema with the exact current function definitions and verify grants/ACLs remain correct; then execute the full authorization/financial regression suite. Do not apply to production yet.


## Follow-up: exact production signature and permission review

Read-only production inspection confirmed the prepared migration's structural caller-block matcher matches exactly once in each full deployed function definition. Both target functions are SECURITY DEFINER with `search_path=public, pg_temp`. ACLs differ: `release_trade_escrow(uuid,uuid)` is executable by `postgres` and `service_role` only; `cancel_p2p_trade(uuid,uuid,text)` is also executable by `authenticated`. Keep this distinction in regression tests: the caller guard must reject authenticated JWT contexts without `auth.uid()` while still allowing a matching real authenticated identity.

Fetched the current Supabase Security Advisor snapshot (observed 2026-10-25 05:20 UTC): 18 SECURITY DEFINER RPCs are executable by `authenticated`, including admin freeze/unfreeze/role/emergency-mode functions, bulk ban/restrict/unban/unrestrict RPCs, `get_user_2fa_status`, `initiate_didit_kyc`, `initiate_trade_with_escrow`, `mark_p2p_trade_paid`, `raise_trade_dispute`, `verify_admin_login`, and the two escrow functions. Three RLS-enabled tables have no policies: `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. These may intentionally be deny-all; verify expected access patterns rather than blindly adding policies. Advisor details are recorded for the next authorization pass.

No production writes or migration applications were performed. Full SQL replay against the exact deployed function bodies remains outstanding; staging currently has no applied migrations and cannot serve as a full app schema without setup. Next audit target: authorization checks and EXECUTE ACLs for admin-management RPCs, prioritizing role changes, account freeze, and emergency mode.


## Follow-up: admin role and emergency-freeze migration review (local code only)

Reviewed `20260928050000_kyc_and_admin_security_hardening.sql`, `20261005020000_canonical_individual_emergency_freeze.sql`, and `20260910000000_strict_typecasting_and_rls_hardening.sql` locally.

Positive findings:
- `public.is_admin()` uses `public.app_admins` membership or server-managed `auth.users.raw_app_meta_data` (`role` / `is_admin`); it does not use user-editable `raw_user_meta_data`.
- `prevent_unauthorized_profile_updates()` is installed as a BEFORE UPDATE trigger and rejects ordinary-user changes to protected privilege, KYC, ban, and withdrawal-control columns. It delegates admin status to `public.is_admin()` and permits service-role writes.
- `admin_update_user_role()` checks service-role execution or a non-null authenticated identity plus `public.is_admin()`, validates role values, blocks self-role changes for authenticated callers, and updates `profiles` plus `app_admins` atomically within the function transaction.
- `admin_freeze_user()` / `admin_unfreeze_user()` include internal administrator checks, reject unauthorised callers, validate target existence, and log audit events.

Open concerns:
- `admin_update_user_role()` does not bind `p_admin_id` to `auth.uid()` when called by an authenticated caller; authorization still uses the real session, but the audit actor ID can be spoofed. Reject mismatched non-null `p_admin_id` for authenticated execution or always record `auth.uid()` as actor.
- Freeze/unfreeze RPCs include `current_setting('role', true) = 'service_role'` as a service-role check in addition to `auth.role()`. This should be validated against the exact deployed PostgreSQL/PostgREST execution context; do not rely on it as a security boundary without an isolated integration test.
- The source migrations are local candidates, not proof of the live deployed function bodies. Production migration history is mismatched; no assumption of deployment should be made.

No code or database changes were made in this step. Next: inspect the remainder of freeze/unfreeze and emergency-mode RPC definitions and add isolated tests for non-admin denial, authenticated actor-ID mismatch, service-role execution, and audit actor correctness. Production remains untouched.


## Follow-up: admin RPC actor-integrity regression guard (2026-10-25)

Added `tests/admin-rpc-actor-integrity.test.ts` as a local static regression harness covering internal authorization checks and the identified actor-attribution / `current_setting('role', true)` patterns in admin role, bulk account-control, freeze and emergency-mode migrations. This is a source-contract check only; it is not a runtime authorization test and does not prove production matches local SQL.

Additional source finding confirmed: `admin_update_user_role()` authorizes the session using `auth.uid()` and `public.is_admin()`, but writes `COALESCE(p_admin_id, v_caller_id)` to `admin_audit_logs`; it does not reject a mismatched supplied `p_admin_id`. The bulk functions similarly authorize the actual caller but use supplied `p_admin_id` and `p_admin_email` for snapshots and audit events.

Attempted to run the test suite through the authorized desktop terminal, but process execution was blocked by tool safety checks. Therefore test execution status is **not run**, not passed. No production changes or deployment were made. The static test file should be treated as a draft guard pending execution and refinement alongside a fix that derives human audit actors from verified identity.


## Follow-up: privileged bulk-action call path review (2026-10-25)

Inspected `src/lib/platform-bulk-actions.ts` around `banAllUsers`, `unbanAllUsers`, and `restrictAllUsers`. These helpers call the bulk SQL RPCs through `getSupabaseAdminClient()` (service-role client) and forward `adminId`/`adminEmail` as `p_admin_id`/`p_admin_email`. In that execution mode, the database may not have an authenticated end-user `auth.uid()` to bind those values to; therefore the SQL functions' internal admin check alone does not establish the human actor's identity. The caller's server-side authorization and verified actor provenance must be traced and enforced before these helpers are used.

A search for direct invocations of `banAllUsers`, `unbanAllUsers`, `restrictAllUsers`, and `unrestrictAllUsers` under `src` returned only the function definitions in the initial results; no call site was found in that search pass. Treat this as **unverified call-path coverage**, not proof that the helpers are unreachable (dynamic imports, other names, and UI/server actions may exist). Before fixing signatures or behavior, map every entry point and confirm it performs `getUser()` plus admin authorization and derives the audit actor from that verified identity.

No code change to privileged behavior was made because changing actor semantics without mapping all callers could break emergency operations. Runtime tests remain unrun due terminal execution being blocked. No production database changes, push, or deployment occurred.


## Follow-up: bulk admin route identity trace (2026-10-25)

Traced `src/app/adminnarayan/settings/PlatformSettingsSwitchboard.tsx` to `POST /api/admin/platform-controls/bulk` in `src/app/api/admin/platform-controls/bulk/route.ts`, then through `src/lib/platform-bulk-actions.ts` to the four privileged bulk user-management RPCs. The route calls `verifyServerAdmin(req)` before dispatch and derives `adminId` from the verified auth result (ultimately `user.id`) and `adminEmail` from the verified user's email; it does not take actor identity from the JSON request body. This is a positive control for the UI-to-route path reviewed.

`src/lib/server-admin-auth.ts` verifies the session with Supabase `getUser()`, checks server-managed `app_metadata` / profile / `app_admins` / configured `ADMIN_EMAILS`, explicitly excludes user-editable `user_metadata`, and validates the signed admin 2FA session when the profile indicates 2FA is enabled.

Added `tests/bulk-admin-route-identity.test.ts` as a static regression guard for these properties. Execution was not possible because terminal process execution remains blocked; tests are **not run**. Remaining issue: the SQL RPCs are also granted to `authenticated` and still accept caller-supplied audit actor fields, so direct authorized-admin RPC calls can potentially falsify audit attribution even though this API route passes the verified identity. Fix must bind SQL audit identity to `auth.uid()` for authenticated calls and use a separately defined trusted service-role audit context for backend calls. Before altering signatures, verify all actual RPC call sites and production definitions because migration history is not reconciled.


## Follow-up: bulk admin audit-actor hardening migration drafted (2026-10-25)

Created `supabase/migrations/20261025070000_harden_bulk_admin_audit_actor.sql`. It targets the four existing bulk ban/unban/restrict/unrestrict RPC signatures, fetches their current definitions via `pg_get_functiondef`, and aborts if a function is missing, already patched, lacks the expected delimiter, or lacks the expected declaration/body structure. For authenticated calls it binds the actor ID to `auth.uid()`, compares the supplied ID and email against the verified profile/JWT email, and substitutes the effective actor values into the existing function body. For service-role calls it requires an explicit actor ID and treats supplied actor context as trusted backend attribution.

Added/updated `tests/bulk-admin-audit-actor-migration.test.ts`. Ran the three focused static suites: **7/7 passed**. `git diff --check` completed with only existing LF/CRLF working-tree warnings.

Important limitation: these are static source-contract tests only. The SQL migration has **not** been applied or executed against staging; its dynamic patching logic still needs a disposable transactional integration test against function definitions matching the actual deployed shape. Production migration history is still unreconciled, so this migration must not be applied to production yet. No production changes, pushes, or deployments were made.


## Follow-up: dynamic SQL validation attempt (2026-10-25)

Reworked the draft patcher after the first isolated test exposed a real implementation issue: `DECLARE` belongs to the function body returned by `pg_get_functiondef`, not the function header. The migration now inserts its effective-actor variables into the body declaration section. Focused static tests were rerun: **7/7 passed**.

Attempted a transactional staging harness for the four exact function signatures. The staging project has no `public.execute_bulk_*` functions and no `public.profiles` table, so the harness used disposable stubs and a minimal profile table inside an explicit transaction. The first attempt correctly failed closed on the missing declaration assumption before the migration was corrected; the next harness attempt did not complete because its test SQL block had a syntax error. No successful runtime result is claimed. The isolated SQL declaration-regex expression itself was verified read-only. Because the harness ended in errors, no test functions/table were intentionally committed; verify staging object absence before any further test.

Status: candidate migration remains **unapplied and not runtime-validated**. Next task is to fix the transactional test harness and validate the patcher against multiline stub definitions, including authenticated actor self-match, mismatched ID/email rejection, service-role actor attribution, and cleanup/rollback. Do not apply this migration to production while the production migration ledger remains unreconciled.


## Follow-up: local bulk RPC signature and compatibility review (2026-10-25)

Inspected the complete local migration `20261004010000_safe_bulk_user_snapshots.sql`. The four target signatures match the candidate migration exactly: `execute_bulk_ban_atomic(uuid,text,text)`, `execute_bulk_unban_atomic(uuid,text)`, `execute_bulk_restrict_atomic(uuid,text,text)`, and `execute_bulk_unrestrict_atomic(uuid,text)`. All four are PL/pgSQL `SECURITY DEFINER` functions with a `DECLARE` section and `AS $$` bodies, which the candidate patcher is intended to handle. Their bodies use `p_admin_id`/`p_admin_email` for snapshots, audit logs, and (ban/restrict) target exclusion; substituting the effective actor variables should preserve the target exclusion semantics for a valid actor.

Focused static tests were rerun and passed **7/7**; `git diff --check` reported only LF/CRLF working-tree warnings. The attempted staging SQL harness has still not produced a successful runtime result, so function compilation and behavior remain unverified. No staging objects were intentionally committed; prior test attempts used explicit rollback but object absence should be checked before any further staging run.

Security boundary note: for service-role calls, the database cannot independently prove that the supplied human administrator ID came from `verifyServerAdmin`; it can only trust the service-role backend. The API route currently derives that ID from verified auth. The candidate migration therefore provides strong identity binding for direct authenticated RPC calls, while service-role attribution remains dependent on the trusted server path. Production remains untouched and the migration must not be applied until staging runtime validation and migration-history reconciliation are complete.


## Follow-up: transactional actor-guard smoke test (2026-10-25)

Fixed the BEGIN-detection expression after the disposable staging harness exposed that the prior newline-oriented regex did not match the `pg_get_functiondef` output. The candidate migration now detects the `BEGIN` token using a whitespace-boundary expression; the focused static test remains green.

Ran a disposable, explicit-transaction staging harness with temporary `profiles` and stub versions of all four exact bulk RPC signatures. The harness applied the same dynamic patching logic, compiled all four rewritten function definitions, and exercised the actor guard: authenticated matching actor ID/email accepted; mismatched actor ID rejected; mismatched email rejected; service-role call with explicit actor ID accepted; service-role call without actor ID rejected. The SQL execution returned successfully. A follow-up query confirmed the transaction rollback removed the temporary profile table and all four test RPCs (`false` for all five existence checks).

Focused TypeScript regression suite: **7/7 passed**. `git diff --check` showed only existing LF/CRLF working-tree warnings. This is a meaningful transactional smoke test, not a full integration test against the actual production function bodies or a migration application test against the real staging schema. The staging project still lacks these RPCs and `public.profiles`, so the candidate migration itself remains unapplied. Continue to keep production untouched until migration history is reconciled and the real staging schema is reconstructed/validated.


## Follow-up: historical source recovery probe (2026-10-25)

Checked the local Git object history and remote `main` migration tree for the sampled production migration names. Most exact production version/name files are absent from the current local migration directory and the remote `main` tree. A superficially similar historical file was recovered from commit `b64609206f1c920e6bd1a588cc1ed02ea219eada`: `20261011170000_wallet_hardening_followup.sql`. Its content is specifically a `trigger_withdrawal_worker()` Vault-secret change and does **not** match the production ledger entry `20261011160153_wallet_hardening_followup`; the similar suffix is not proof of equivalence. This demonstrates why matching only migration names or guessing alternate prefixes is unsafe.

The sampled production entries therefore remain unreconciled. Do not substitute the recovered file, do not mark the ledger reconciled, and do not apply pending migrations based on filename similarity. Next step is to recover the exact historical SQL from the actual deployment source or verified database definitions, then compare content/function ACLs before creating a baseline. No database changes, commits, pushes, or deployments were made.


## Follow-up: live production SECURITY DEFINER inventory (2026-10-25)

Read-only inspection of production function catalog (`eaiwgfxoiwxepinvcykg`) captured current deployed definition fingerprints and effective EXECUTE privileges. No DDL was run.

| Function | EXECUTE for authenticated | EXECUTE for service_role | Security note |
|---|---:|---:|---|
| `cancel_p2p_trade(uuid,uuid,text)` | Yes | Yes | Deployed body allows caller-ID fallback when `auth.uid()` is NULL without a service-role-only guard; body also checks `raw_app_meta_data` for admin role. |
| `mark_p2p_trade_paid(uuid,uuid,text)` | Yes | Yes | Same NULL-session fallback concern; body checks both `raw_user_meta_data` and `raw_app_meta_data` admin-role fields. |
| `raise_trade_dispute(uuid,uuid,text)` | Yes | Yes | Same NULL-session fallback concern; body checks both user and app metadata admin-role fields. |
| `initiate_trade_with_escrow(...)` | Yes | Yes | References `auth.uid()` and has a service-role guard pattern; exact full body and actor binding still require manual comparison with the local hardening migration. |
| `initiate_didit_kyc(uuid,text)` | Yes | Yes | SECURITY DEFINER and accepts a target user ID; verify explicit session-to-target identity binding before considering it safe. |
| `verify_admin_login(uuid,uuid)` | Yes | Yes | SECURITY DEFINER, authenticated executable, and references app metadata; verify both supplied UUIDs are bound to the authenticated user and that the admin check uses trusted data. |
| `release_trade_escrow(uuid,uuid)` | No | Yes | Service-role-only EXECUTE boundary observed; retain this restriction. |
| `admin_resolve_dispute(uuid,uuid,text,text)` | No | Yes | Service-role-only EXECUTE boundary observed, but function body trusts `p_admin_id` after checking `profiles.is_admin`; server must derive it from verified admin identity. |
| `finalize_p2p_release(uuid,uuid,numeric,text)` | No | Yes | Service-role-only EXECUTE boundary observed; keep it server-only and verify API authorization. |

Definition fingerprints captured during this read-only snapshot: `cancel_p2p_trade` `41053b5f002329bc64b1c9e07c2d56f2`; `mark_p2p_trade_paid` `bfa4b4acff93486054fb549d64aad5dd`; `raise_trade_dispute` `dc261c0e8399f1b17c76faf2d595ebac`; `initiate_trade_with_escrow` `143c4e7020a125a8dbb21415eae6b806`; `initiate_didit_kyc` `bb37799ee0276dc83df0c16196155eeb`; `verify_admin_login` `fcdef49c39bf1508cef6679d5a34fe65`. These hashes are audit comparison markers, not proof of safety or migration provenance.

**Next action:** inspect and compare the exact deployed bodies for the four authenticated-callable identity-sensitive RPCs (`cancel_p2p_trade`, `mark_p2p_trade_paid`, `raise_trade_dispute`, `verify_admin_login`) against local candidate hardening migrations and their API routes. Then add regression tests for mismatched caller ID, missing auth context, and forged metadata. Do not apply changes until source reconciliation and schema-faithful staging validation are available.


## Follow-up: `verify_admin_login` identity-binding candidate (2026-10-25)

Production body inspection confirmed `public.verify_admin_login(uuid,uuid)` initializes `v_uid := COALESCE(p_user_uuid, user_uuid, auth.uid())`. Because authenticated users can execute this SECURITY DEFINER function and the body does not first bind supplied UUIDs to `auth.uid()`, a caller may attempt to check another user's admin state. This is a concrete identity-binding risk requiring immediate remediation before soft launch.

Prepared local-only candidate migration `supabase/migrations/20261025080000_bind_verify_admin_login_to_session.sql`. It fails closed if the deployed function signature/body shape differs, rejects either supplied user ID when it differs from `auth.uid()`, derives authenticated calls' target exclusively from `auth.uid()`, and permits explicit target IDs only when `auth.role()` is `service_role`. Added `tests/verify-admin-login-identity-migration.test.ts`.

Validation: 7/7 focused static contract tests passed across the new candidate and existing trusted-caller/admin-metadata/escrow migration contracts. `git diff --check` was run for the new files. These are source-level tests only; the candidate has **not** been executed against PostgreSQL or applied to any database. The staging schema remains unsuitable for validating this function because it lacks the required production schema. Do not treat the finding as fixed until the migration is tested against a schema-faithful isolated database, the API caller paths are reviewed, and deployment is explicitly authorized.


## Follow-up: use the existing admin-login identity migration (2026-10-25)

A further local-source review found an existing, more direct candidate: `supabase/migrations/20261019110000_harden_verify_admin_login_identity.sql`, plus `tests/verify-admin-login-migration.test.ts`. It explicitly binds authenticated requests to `auth.uid()`, rejects either supplied UUID when it differs, requires a caller identity for non-service-role execution, and permits explicit target IDs only to service-role calls. The production function body still has the old `COALESCE(p_user_uuid, user_uuid, auth.uid())` initializer and lacks this binding, so the existing candidate is not reflected in the live production definition.

The previously drafted dynamic patch duplicated the existing migration and would fail its own expected-shape check if the earlier migration were applied first. To avoid a second active migration with conflicting assumptions, that newly drafted migration and its test were moved out of the migrations/tests directories into `docs/disabled-candidate-verify-admin-login-identity.sql.txt` and `docs/disabled-candidate-verify-admin-login-identity.test.txt`; they are not active migration or test files. The existing migration's static contract test passed. A disposable PostgreSQL harness for the dynamic draft had passed identity mismatch, anonymous/non-service-role rejection, matching authenticated identity, and explicit service-role target checks, and rollback was confirmed to leave no stub function or `profiles` table. That harness validates the draft's guard behavior, not the full existing migration or production schema. A follow-up attempt to execute the full existing migration in staging was blocked before execution, so no SQL from that attempt was run.

**Decision:** continue with the existing migration as the primary candidate; do not apply either candidate to production yet. Remaining work is a schema-faithful PostgreSQL test of the existing migration, review of the four UI/middleware call sites, and reconcile the migration chain before any application. No production changes, pushes, commits, or deployments were made.


## Follow-up: admin authorization call-site review (2026-10-25)

Reviewed the UI/middleware call sites of `verify_admin_login` and production definitions of `check_is_admin` / `is_admin`.

- Admin login page calls `verify_admin_login` with the signed-in `data.user.id`; its existing-session check also uses the session user's ID. These UI call sites are identity-aligned, but the database RPC must still enforce the boundary because clients can call RPCs directly.
- `src/app/adminnarayan/dashboard/layout.tsx` tries `verify_admin_login`, then `check_is_admin`, then uses a service-role client to read `profiles` and authorizes when `role='admin'` and `is_suspended` is false. This fallback does not check `is_banned`, `is_on_hold`, or `status='banned'/'suspended'`, so it can contradict the primary RPC's suspension decision. It should fail closed or apply the same complete ban/suspension policy.
- `src/middleware.ts` authorizes admin routes from `user.app_metadata.role` or `profiles.role/is_admin` before its `check_is_admin` fallback. The production `check_is_admin(uuid,uuid)` ACL is `postgres,service_role,supabase_auth_admin` (not `authenticated`), so a normal client call is not an available verification path. The middleware's direct metadata/profile checks therefore need a unified policy review, especially for suspension/ban state.
- `src/app/adminnarayan/admin-shell.tsx` also falls back to `check_is_admin` after `verify_admin_login`; the production ACL means that client RPC fallback may fail. It does not itself grant access based on the failed result, but can create inconsistent behavior.
- Production `check_is_admin` has `v_uid := COALESCE(p_user_id, user_uuid, auth.uid())` and no explicit session-to-supplied-ID binding. Its current ACL is service-role-only, limiting direct authenticated exposure; if the ACL changes, identity binding must be added before enabling authenticated execution.

**Next fix candidate:** unify admin authorization and suspension/banned checks across middleware, dashboard layout, and admin shell; remove permissive fallback authorization when the canonical check fails. Add regression tests for banned/suspended admins and RPC errors. No application code or database changes were made in this step; findings were appended to the audit report.


## Follow-up: middleware admin authorization unified to canonical RPC (2026-10-25)

Updated `src/middleware.ts` to use `verify_admin_login` as the sole admin authorization decision for protected `/adminnarayan/*` (excluding login) and `/api/admin/*` routes. Removed the direct `app_metadata.role` / `profiles.role` fallback and the `check_is_admin` fallback, which production ACL inspection showed is not executable by normal authenticated users. RPC errors now fail closed: API requests receive HTTP 503 with `ADMIN_VERIFICATION_UNAVAILABLE`; page requests redirect to the admin login with `verification_unavailable`. A false verification result is denied.

Added `tests/middleware-admin-authorization.test.ts`. Validation command `npx tsx --test tests/middleware-admin-authorization.test.ts tests/verify-admin-login-migration.test.ts tests/server-admin-auth-metadata.test.ts` passed 5/5 tests. `git diff --check -- src/middleware.ts tests/middleware-admin-authorization.test.ts` ran without reported whitespace errors.

Scope limitation: this is a middleware code change only; it does not fix the deployed `verify_admin_login` RPC's supplied-ID identity binding, nor does it unify the dashboard layout/admin shell fallbacks yet. Because the canonical RPC is still vulnerable if a caller can supply a different ID, this change alone is not a complete admin-security fix. The existing local identity-hardening migration must be validated and deployed via a verified migration chain before treating this boundary as secure. No DB changes, commit, push, or deployment was made.


## Follow-up: dashboard layout authorization and account lifecycle checks (2026-10-25)

Replaced the dashboard layout's permissive fallback chain with a fail-closed flow: require a verified authenticated session; require `verify_admin_login` to return `is_valid === true`; then read the account profile using the server-only admin client and deny access if profile lookup fails. Removed `check_is_admin` fallback and role-only fallback authorization. Added explicit restrictions for `is_banned`, `is_suspended`, status values `banned`, `suspended`, `on_hold`, `hold`, and account-status values `BANNED`, `SUSPENDED`, `ON_HOLD`, `HOLD`, `DELETED`, and `DELETION_PENDING`. The edit also added the missing `createClient` import previously referenced by this layout.

Added `tests/admin-dashboard-layout-authorization.test.ts`. Combined focused test run with dashboard layout, middleware, verify-admin-login migration contract, and server/client metadata checks passed 9/9. `git diff --check` produced no whitespace errors; it emitted only a normal LF-to-CRLF working-copy warning.

Caveats: tests are static contract tests, not full Next.js integration tests. The canonical `verify_admin_login` database identity-binding vulnerability and migration provenance remain unresolved; therefore these changes do not establish full production security. The admin shell still has a client-side `check_is_admin` secondary path to remove in a follow-up. No database changes, commit, push, or deployment was made.


## Follow-up: admin shell canonical verification and fail-closed UI (2026-10-25)

Updated `src/app/adminnarayan/admin-shell.tsx` to remove the `adminEmail` prop shortcut that marked the shell authorized without checking the current session, use `auth.getUser()` instead of only reading the cached session, and use `verify_admin_login` as the sole client-side authorization RPC. Removed the `check_is_admin` secondary fallback. RPC/auth verification failures now enter a dedicated `verification-unavailable` state with a retry/login UI; the shell does not render its admin controls in that state. A negative verification result remains denied.

Added `tests/admin-shell-authorization.test.ts`. Its focused run passed 3/3 tests; dashboard-layout and middleware regression tests passed 7/7 in a separate run. `git diff --check -- src/app/adminnarayan/admin-shell.tsx tests/admin-shell-authorization.test.ts` passed without output. A full TypeScript build/typecheck was attempted but the process launch was blocked by the remote tool's safety checks, so typecheck status is unverified.

Important security caveat remains: client and middleware calls to `verify_admin_login` depend on the database RPC's session-identity binding. The production definition was previously found to accept caller-supplied UUIDs and needs a verified migration deployment. These changes are defense-in-depth, not a claim of complete admin security. No database changes, commit, push, or deployment was made.


## Follow-up: production identity-RPC reconciliation (2026-10-25)

Read-only inspection of production `public.verify_admin_login(uuid,uuid)` reconfirmed deployed definition MD5 `fcdef49c39bf1508cef6679d5a34fe65`, `SECURITY DEFINER`, empty `search_path`, and EXECUTE granted to `authenticated`, `service_role`, `postgres`, and `supabase_auth_admin` (anon denied). The live body still selects the effective target as `COALESCE(p_user_uuid, user_uuid, auth.uid())` without binding either supplied UUID to `auth.uid()`, so the identity-binding issue is confirmed and remains a production blocker.

Read-only inspection confirmed the production `profiles` table contains the columns used by the candidate migration: `id`, `role`, `is_admin`, `is_suspended`, `is_on_hold`, `is_banned`, `status`, and `account_status`. Updated local migration `20261019110000_harden_verify_admin_login_identity.sql` to treat `status` values `on_hold`/`hold` and account-status values `SUSPENDED`, `ON_HOLD`, `HOLD`, and `BANNED` as restricted states, in addition to the existing boolean and status checks. Expanded `tests/verify-admin-login-migration.test.ts` to assert these restrictions.

Validation: `npx tsx --test tests/verify-admin-login-migration.test.ts` passed 1/1; `npx tsx --test tests/admin-shell-authorization.test.ts` passed 3/3; `git diff --check` passed. These are static contract tests, not execution of the migration against a faithful isolated production schema.

No migration was applied. Staging remains unsuitable as a validation baseline because its migration ledger is empty and its schema is missing required production objects; production migration provenance is still unreconciled. The next safe step is to recover/reconcile the exact deployed migration chain or create a faithful isolated database fixture, execute the candidate migration and adversarial identity/status tests there, then plan a separately reviewed deployment. No database changes, commit, push, or deployment was made.


## Follow-up: admin dashboard fail-closed handling and typecheck (2026-10-25)

Reviewed the admin dashboard layout and found that `redirect()` was called inside broad `try/catch` blocks. Since Next.js redirects throw a framework control-flow signal, those catches could swallow redirect behavior and send users to a different failure route. Reworked the layout so authentication, canonical admin-RPC verification, and service-role profile lookup record failures inside `try/catch` and perform redirects only after leaving the catches. The layout continues to fail closed for missing sessions, failed/false admin verification, profile lookup failure, and banned/suspended/on-hold/deleted accounts.

Also corrected `src/lib/supabase/admin.ts`: its previous implementation referenced `createClient` without importing it and duplicated service-role client creation. It now delegates to the validated, cached `getSupabaseAdminClient()` implementation in `src/lib/supabase/server.ts`. Added a regression assertion for redirect placement and made the dashboard test explicitly import `test` from `node:test`.

Validation results: combined focused admin layout, shell, middleware, and identity-migration tests passed 12/12; `git diff --check` passed (only Git line-ending notices); `npx tsc --noEmit --pretty false` completed with exit code 0. This validates TypeScript compilation, not a full production build or live authorization behavior.

No production database changes, commits, pushes, or deployments were made. The deployed `verify_admin_login` identity-binding issue and migration-history mismatch remain blockers. Next: validate the candidate database migration with an isolated, faithful schema and adversarial tests before any deployment decision.
