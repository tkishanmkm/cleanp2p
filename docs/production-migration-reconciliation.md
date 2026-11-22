# Paxones production migration reconciliation audit

**Checked:** 8 November 2026
**Project:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)
**Repository:** `tkishanmkm/cleanp2p`
**Branch at inspection:** `fix/production-typecheck-batch-1`

## Executive finding

**Production migration execution remains NO-GO.** The Supabase migration ledger stops at `20261103204401` (137 recorded migrations). There are 90 untracked historical SQL files with versions at or before that recorded head, two modified older SQL files, and a long sequence of later tracked migrations. Their exact effects cannot be inferred safely from names or file presence.

The audit also confirmed that several current application paths call RPCs/tables which are absent from the live catalog. These are real operational gaps, not merely untracked-file bookkeeping. Thirteen narrow forward migrations now cover the presence heartbeat, seller-online guard, user/admin 2FA contracts, support-admin emergency mode, the missing restricted account enum, guarded administrator/trade actions and supporting platform tables. The five deposit/withdrawal control migrations are also prepared in the ordered release plan. All remain unapplied.

No production DDL or financial operation was executed.

## 1. Migration inventory and provenance

Live `supabase_migrations.schema_migrations`:

- Applied migration count: **137**
- Latest version: `20261103204401`
- Latest name: `lock_admin_audit_logs_to_verified_server_routes`

Local inventory immediately before the current supporting-table batch:

- **72** tracked, clean SQL files newer than the production head (including the earlier presence, trade-opening, 2FA/support and admin-action forward migrations).
- **90** untracked historical SQL files dated from `20261017010000` through `20261102000003`, all at or before the production head.
- **2** modified older SQL files:
  - `20260928020000_withdrawal_hardened_rpcs.sql`
  - `20260928070000_canonical_p2p_state_machine_and_rpcs.sql`

Thirteen forward files are now prepared after the production head:

- `20261108014000_restore_authenticated_presence_rpc.sql`
- `20261108020000_guard_offline_ad_trade_opening.sql`
- `20261108030000_restore_2fa_rate_limit_contracts.sql`
- `20261108031000_restore_atomic_user_2fa_contracts.sql`
- `20261108032000_restore_atomic_admin_2fa_contracts.sql`
- `20261108033000_restore_support_admin_emergency_contracts.sql`
- `20261108040000_add_restricted_user_status.sql`
- `20261108041000_restore_admin_user_action_contracts.sql`
- `20261108042000_restore_admin_mark_paid_authorized_rpc.sql`
- `20261108043000_restore_atomic_admin_dispute_settlement.sql`
- `20261108050000_restore_trade_event_and_chat_limit_tables.sql`
- `20261108051000_restore_admin_wallet_and_deposit_address_registries.sql`
- `20261108052000_restore_account_deletion_grace_period.sql`

The supporting-table batch adds three forward migration files to the 72-file newer inventory; after commit, the local release inventory will contain **75** files newer than the production head.

The 90 historical file versions are absent from the production migration ledger. That establishes missing migration provenance, but not that every contained schema change is absent: some effects exist via other applied migrations or live catalog changes. Do not apply, delete, rename, or mark historical files applied without a file-by-file code/catalog comparison.

### Confirmed examples of superseded or non-blocking candidates

- `20261101130000_align_live_didit_webhook_schema_and_event_leases.sql`: the production `kyc_webhook_events` table and webhook claim/finish RPCs are already present. The exact old migration version is absent, but its functional effect is at least partly represented by another deployed change. It is not safe to run it again blindly.
- `20261019180000_add_idempotent_withdrawal_wrapper.sql`: `withdrawal_idempotency_keys` table is absent, but the currently installed `request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)` function does not reference that table. The old candidate is not evidence of the current production implementation.
- `20261024170000_withdrawal_worker_lease.sql`: this file is explicitly a no-op draft. The actual `src/jobs/withdrawalWorkerLease.ts` helper has no active callsites, and the current withdrawal dispatcher uses `claim_pending_withdrawals(p_limit,p_worker_id)` with per-withdrawal leases. The old singleton lease table/RPCs are not a proven current withdrawal-dispatch blocker.

## 2. Confirmed current application / production catalog gaps

The following RPCs were found in application code, but the exact RPCs were absent from the live `public` function catalog at audit time:

| Missing RPC | Current code reference | Impact |
|---|---|---|
| `register_pending_deposit(...)`, `claim_pending_deposit_confirmations(...)`, `release_pending_deposit_confirmation_claim(...)`, `process_deposit_atomic_with_lease(...)`, `claim_deposit_integrity_checks(...)`, `complete_deposit_integrity_check(...)` | Deposit scanners, `src/jobs/confirmationsWorker.ts`, `src/jobs/depositIntegrityWorker.ts` | Pending deposits cannot be registered/claimed/credited through the lease path, and chain-integrity checks cannot be claimed/completed. The raw legacy credit RPC remains directly executable by `service_role` until the ACL migration is applied. |
| `record_ad_offline_open_attempt(text,text)` | `src/lib/ad-owner-availability.ts` | All four trade-opening API routes call this guard before escrow initiation; errors return HTTP 503. |
| `set_my_presence(boolean)` | `src/components/providers/UserPresenceProvider.tsx`, `src/hooks/usePresence.ts`, `src/hooks/usePresenceHeartbeat.ts` | Presence heartbeat cannot update seller availability timestamps. |
| `check_admin_2fa_rate_limit(uuid)`, `reset_admin_2fa_rate_limit(uuid)` | `src/lib/admin-2fa-rate-limit.ts` | Admin 2FA challenges/recovery fail closed when rate-limit state cannot be checked or reset. |
| `check_user_2fa_rate_limit(uuid)`, `reset_user_2fa_rate_limit(uuid)` | `src/lib/user-2fa-rate-limit.ts` | User 2FA verification/enrollment protection fails closed. |
| `enable_user_2fa_atomic`, `disable_user_2fa_atomic` | User 2FA API routes | Enrollment/disable lifecycle cannot complete. |
| `enable_admin_2fa_atomic`, `disable_admin_2fa_atomic`, `recover_admin_2fa_atomic`, `rotate_admin_2fa_recovery_atomic` | Admin 2FA API routes | Admin 2FA lifecycle and recovery operations cannot complete. |
| `consume_user_2fa_recovery_code_with_audit` | `src/lib/user-2fa-crypto.ts` | Atomic recovery-code consumption and audit path unavailable. |
| `admin_freeze_user_authorized`, `admin_unfreeze_user_authorized` | `src/app/adminnarayan/users/actions.ts` | Emergency freeze/unfreeze actions fail. |
| `admin_mark_trade_paid_authorized` | `src/app/api/admin/trades/[tradeId]/route.ts` | Admin mark-paid action fails. |
| `admin_resolve_trade_dispute_atomic` | `src/lib/admin-dispute-settlement.ts` | Atomic admin dispute settlement path unavailable. |
| `admin_update_user_role_authorized`, `admin_update_user_status_authorized` | `src/app/api/admin/users/[userId]/route.ts` | Actor-bound admin account mutations fail. |
| `configure_support_admin`, `activate_support_admin_emergency`, `revoke_support_admin_emergency`, `is_active_full_admin_actor` | `src/app/api/admin/support-admins/*` | Support-admin grants, emergency activation/revocation and full-admin actor checks are unavailable. |

The application code uses these direct RPC names. The audit did not execute the routes or perform live financial actions.

### Confirmed current application / production table gaps

The following tables were absent from `public` at audit time. The listed application routes use them directly:

| Missing table | Current code reference | Impact |
|---|---|---|
| `support_admin_grants` | `src/lib/server-admin-auth.ts`, support-admin API/UI | Support-admin authorization/configuration cannot resolve a grant. |
| `support_admin_emergency_sessions` | `src/lib/server-admin-auth.ts`, support-admin status route | Emergency support-session lookup fails closed. |
| `support_admin_activity` | `src/lib/server-admin-auth.ts`, support-admin API | Emergency actions/read auditing cannot be written. |
| `trade_system_events` | `src/lib/trade-system-messages.ts`, system-message route | Separate durable system-event persistence fails. |
| `trade_chat_limit_requests` | `src/app/api/trades/[tradeId]/chat-limit-support/route.ts` | Chat-limit support request reservation/status persistence fails. |
| `account_deletion_cleanup_queue` | `src/app/api/cron/process-account-deletion-cleanup/route.ts` | Account-deletion media-cleanup queue processing cannot persist its work. |
| `platform_wallets` | `src/app/adminnarayan/wallet/page.tsx` | Platform custody-address registry page cannot query its expected table. |
| `crypto_deposit_addresses` | `src/app/adminnarayan/settings/deposit-address-sets/page.tsx` | Admin rotating deposit-address-set page cannot query its expected table. |
| `admin_2fa_rate_limits` | 2FA rate-limit RPC candidates | Durable administrator 2FA attempt counters unavailable. |
| `user_2fa_rate_limits` | 2FA rate-limit RPC candidates | Durable user 2FA attempt counters unavailable. |

Other absent legacy-candidate tables were `ad_offline_open_attempts` (now addressed by the new forward candidate), `withdrawal_idempotency_keys` (not referenced by current deployed idempotent RPC), and `withdrawal_worker_leases` (old helper has no active callsites). Do not assume every absent table is a current production blocker.

## 3. Core trade-opening blocker and safe forward fix

Four current routes call `checkAdOwnerAvailability()` before calling `initiate_trade_with_escrow`:

- `src/app/api/trades/route.ts`
- `src/app/api/trades/initiate/route.ts`
- `src/app/api/trades/create/route.ts`
- `src/app/api/p2p/orders/create/route.ts`

That helper calls `record_ad_offline_open_attempt`. Production lacks the RPC and its backing table, so these trade-opening routes return HTTP 503 before escrow initiation.

The offline-advertiser guard also depends on a fresh seller heartbeat. Production lacked `set_my_presence(boolean)`, which is used by the current client heartbeat components.

### Prepared forward migrations

1. `20261108014000_restore_authenticated_presence_rpc.sql`
   - Restores only `set_my_presence(boolean)`.
   - The RPC derives the target profile from `auth.uid()`; it accepts no caller-supplied user ID.
   - It updates only `is_online` and `last_seen_at` for the authenticated user.
   - It is postgres-owned, SECURITY DEFINER, empty search path, and executable only by authenticated users/postgres.
   - It intentionally does not change profile SELECT policies or create the separate `public_profiles` view.

2. `20261108020000_guard_offline_ad_trade_opening.sql`
   - Adds idempotent offline-opening evidence, counters on `ads` and `p2p_ads`, the authenticated `record_ad_offline_open_attempt(text,text)` RPC, the database-level seller-online insert trigger, and 30-day evidence retention.
   - Uses a 120-second heartbeat freshness window and pauses an ad after three eligible offline attempts.
   - The RPC resolves the owner from the stored ad, blocks self-trading and restricted buyers, and serializes attempt updates by ad key.
   - Seller-online decisions require both an explicit `is_online=true` state and a fresh timestamp within 120 seconds; the timestamp is `GREATEST(last_seen,last_seen_at)` so a stale legacy column cannot mask the heartbeat. Explicit sign-out is respected immediately.
   - **Dependency:** apply the presence migration first. Seller freshness must use the newer of `last_seen` and `last_seen_at`, not `COALESCE(last_seen,last_seen_at)`, so a stale non-null `last_seen` cannot shadow the fresh heartbeat timestamp.

Preflights:
- `supabase/tests/authenticated_presence_rpc_preflight.sql`
- `supabase/tests/offline_ad_trade_opening_preflight.sql`

The two forward migrations and both preflights passed a combined rollback-only rehearsal against the production schema. After rollback, the presence RPC, offline-attempt table, offline-attempt RPC, seller-guard function/trigger and cron job were all still absent. No production object was retained.

## 4. 2FA lifecycle and support-admin contract gaps

The live database catalog confirmed that all four rate-limit RPCs, user/admin lifecycle RPCs, support-admin RPCs and the three support-admin tables were absent. The existing user enrollment/recovery tables and profile 2FA columns were present, with RLS enabled and no browser-role SELECT access.

### Prepared forward migrations

1. `20261108030000_restore_2fa_rate_limit_contracts.sql`
   - Creates persistent user/admin attempt-counter tables and four server-only rate-limit RPCs.
   - Uses atomic upserts to reserve each challenge attempt, a 15-minute window and a five-attempt limit; successful verification clears the actor's counter.
   - Tables use RLS and have no direct browser-role grants. Functions are postgres-owned SECURITY DEFINER functions with empty search paths and service-role-only execution.

2. `20261108031000_restore_atomic_user_2fa_contracts.sql`
   - Restores atomic user enrollment/rotation, disable and recovery-code consumption RPCs.
   - Enrollment requires a current, unexpired pending secret and exactly eight distinct 64-hex recovery hashes; profile flags, encrypted secret, recovery rows, pending-row deletion and audit are committed together.
   - Adds a partial unique index over active recovery hashes. The disable RPC consumes both legacy/current aliases in a single transaction when the same code has both representations, avoiding a false result after a recovery row has already been mutated.
   - The current API also had a code-path defect: a wrong six-digit TOTP was passed to the recovery-code hash helper and could return HTTP 500. The route now validates recovery-code format first, writes the failed-attempt audit and returns HTTP 400 instead.

3. `20261108032000_restore_atomic_admin_2fa_contracts.sql`
   - Restores admin 2FA enable, disable, recovery and recovery-password rotation RPCs.
   - Each function verifies the actor through the canonical `verify_admin_login` function, locks the profile row, and rejects banned, suspended, restricted, on-hold, frozen, minor-restricted or non-active admin accounts.
   - The functions are postgres-owned SECURITY DEFINER functions with empty search paths and service-role-only execution.

4. `20261108033000_restore_support_admin_emergency_contracts.sql`
   - Creates `support_admin_grants`, `support_admin_emergency_sessions` and `support_admin_activity` with RLS and service-role-only direct table access.
   - Full-admin actors are verified through canonical admin resolution and active account state; support targets are checked for active status and excluded if they resolve as full administrators.
   - Enforces one unrevoked emergency session per support user, a maximum three-hour session, one-use counter accounting and mandatory 2FA.
   - Disabling a support-admin grant revokes every unrevoked emergency session before the grant update; re-enabling cannot resurrect the old session.
   - The grant change and its `admin_audit_logs` entry are written in the same database transaction. The API no longer performs a separate follow-up audit insert.

Preflight:
- `supabase/tests/two_factor_support_admin_contract_preflight.sql`

A read-only live catalog check found zero duplicate active user recovery-hash groups before adding the partial unique index. The four migrations plus the combined preflight passed a rollback-only rehearsal against the production schema. A subsequent read-only catalog check confirmed the new rate-limit/support tables, recovery index and representative user/admin/support RPCs were all absent after rollback. No production object was retained and no production migration was applied.

## 5. Admin account, emergency-freeze and trade-action contracts

The live catalog confirmed that the six current server-side admin-action RPCs were absent. It also exposed two schema mismatches between old candidates and the deployed database: `user_status_enum` did not contain the `restricted` label required by the current API, and the deployed `app_admins` registry has only `user_id` and `granted_at` (no `role` or `created_at` columns).

### Prepared forward migrations

1. `20261108040000_add_restricted_user_status.sql`
   - Adds the `restricted` enum label used by `src/app/api/admin/users/[userId]/route.ts`.
   - It is intentionally an enum-only migration and must be committed/applied before the next migration parses or casts that enum label.

2. `20261108041000_restore_admin_user_action_contracts.sql`
   - Restores `admin_update_user_role_authorized`, `admin_update_user_status_authorized`, `admin_freeze_user_authorized` and `admin_unfreeze_user_authorized`.
   - All four use the strict internal `is_active_full_admin_actor(uuid)` helper, which resolves a canonical full-admin identity and rejects inactive, restricted, suspended, banned, on-hold, emergency-frozen or minor-restricted accounts.
   - Role changes take a transaction-scoped advisory lock; demoting an administrator is rejected when it would leave no other active full administrator. Promotion is restricted to active, unrestricted accounts.
   - The role mutation writes only the deployed `app_admins(user_id, granted_at)` columns, updates the profile and server-managed Auth app metadata in one transaction, and writes its audit row.
   - Account-status changes reject full-admin targets (which must be demoted through the dedicated role operation), synchronize profile flags/account status, pause offers in all three deployed marketplace stores (`advertisements`, `ads`, and `p2p_ads`), and revoke/disable any support-admin emergency access for restricted/suspended/banned users.
   - Emergency freeze uses the same strict actor guard, mandatory audit, pauses offers in all three marketplace stores and disables support-admin grants/sessions. Unfreeze invalidates stale sessions but deliberately does not reactivate offers; reactivation is a separate controlled action.

3. `20261108042000_restore_admin_mark_paid_authorized_rpc.sql`
   - Restores the service-only admin mark-paid wrapper with a strict active full-admin actor check, reason validation and mandatory audit.
   - It delegates the trade state transition to the canonical `mark_p2p_trade_paid` RPC. It does not directly modify wallet balances or escrow ledger entries.

4. `20261108043000_restore_atomic_admin_dispute_settlement.sql`
   - Restores the service-only atomic dispute wrapper with strict active full-admin actor validation, one-open-dispute/trade/winner guards and mandatory same-transaction audit.
   - It delegates buyer/seller settlement to the existing canonical dispute resolver, which uses the canonical escrow release/cancel functions; the wrapper checks the final dispute and trade state before committing.
   - Optional system chat/notification writes are isolated from the mandatory settlement/audit transaction.
   - **Runtime gate:** keep `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED` disabled until this path receives a separately approved isolated financial validation. No settlement path was invoked in this audit.

Preflight:
- `supabase/tests/admin_user_trade_action_contract_preflight.sql`

The four migrations, together with the 2FA/support base migration required by the strict actor helper, passed a combined rollback-only schema rehearsal with the admin-action preflight. The preflight also verifies restricted/suspended/banned statuses and emergency freeze pause all three marketplace ad stores, while unfreeze does not silently reactivate offers. A read-only post-rollback catalog check confirmed the `restricted` enum value, six admin-action RPCs and support-admin tables were still absent and the production migration ledger remained at 137 records / `20261103204401`. No production DDL was retained and no financial function was called.

## 6. Trade events, chat support, admin registries and account deletion

The live production catalog confirmed these application dependencies were absent: `trade_system_events`, `trade_chat_limit_requests`, `platform_wallets`, `crypto_deposit_addresses`, `account_deletion_cleanup_queue`, and the three account-deletion timestamp columns on `profiles`.

### Prepared forward migrations

1. `20261108050000_restore_trade_event_and_chat_limit_tables.sql`
   - Restores `trade_system_events` with a foreign key to `trades(id)`, object-only metadata, bounded message/type/dedupe fields and unique `(trade_id, dedupe_key)` idempotency.
   - The table is service-role-only, RLS-enabled and deliberately excluded from Supabase Realtime publication.
   - Restores `trade_chat_limit_requests` with its `(trade_id, user_id)` idempotency constraint and service-role-only table grants. The route continues to record support tickets separately.

2. `20261108051000_restore_admin_wallet_and_deposit_address_registries.sql`
   - Restores `platform_wallets` as a read-only registry for authenticated full administrators; authenticated users cannot insert/update/delete rows.
   - Restores `crypto_deposit_addresses` for rotating address-set management. The admin page uses browser-client CRUD, so the table grants CRUD to `authenticated` but the RLS policy calls a no-argument postgres-owned helper which derives identity exclusively from `auth.uid()` and the strict full-admin actor check. No caller can supply an administrator UUID.
   - It stores only public addresses/metadata; it contains no private-key or signing material.

3. `20261108052000_restore_account_deletion_grace_period.sql`
   - Adds the three deletion timestamps consumed by the current account-deletion route, the partial due-deletion index and a server-only cleanup queue.
   - Restores an account-status trigger that pauses `advertisements`, `ads` and `p2p_ads` as soon as an account enters `DELETION_PENDING` or `DELETED`.
   - Restores the daily postgres-owned 20-day finalizer with a transaction advisory lock, row locking and a fail-closed guard: if either Vault secret is absent, it returns without anonymizing any profile.
   - The finalizer, HTTP invoker and media-cron scheduling helper are postgres-only; service_role cannot directly invoke the destructive finalizer.
   - The media-cleanup cron is deliberately not scheduled by this migration. The live project currently lacks both `paxones_app_url` and `paxones_cron_secret`; after those values are configured in Vault and the cron secret matches the deployed app's `CRON_SECRET`, schedule it once using `SELECT public.schedule_account_deletion_media_cleanup();` as postgres. Until then, due accounts remain pending and the finalizer does not anonymize them.

Preflights:
- `supabase/tests/trade_admin_registry_contract_preflight.sql`
- `supabase/tests/account_deletion_grace_period_preflight.sql`

The three migrations and both preflights passed a combined rollback-only schema rehearsal, including the prerequisite support-admin migration that creates the strict full-admin helper. A read-only post-rollback catalog check confirmed the tables, profile columns, policies, functions, trigger and cron job were all absent again; the migration ledger remained at 137 records / `20261103204401`. No production DDL was retained, no deletion finalizer was invoked, and no media cleanup request or financial operation was run.

## 7. Deposit registration, confirmation and credit safety

The live public catalog confirms that the six current deposit RPC contracts are absent:

- `register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`
- `claim_pending_deposit_confirmations(text,integer,integer)`
- `release_pending_deposit_confirmation_claim(uuid,text)`
- `process_deposit_atomic_with_lease(uuid,text,text,text,text,numeric,text,integer,bigint,text,text,integer,text,text)`
- `claim_deposit_integrity_checks(text,integer,integer)`
- `complete_deposit_integrity_check(uuid,text,text,text,text,jsonb,integer)`

The underlying `process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)` remains executable by `service_role` in production. This direct credit path must be revoked **only after** the pending-registration and lease-protected credit wrappers have been installed and their ownership/ACL preflight passes. No application source callsite directly invokes this raw RPC; all ingress paths use `register_pending_deposit`, and only the confirmation worker uses the lease-protected credit wrapper.

### Verified confirmation boundary

- Deposit scanners register new observations with `p_confirmations = 0`; that is a pending registration, not a verified chain confirmation.
- The live canonical credit function requires positive network-specific confirmation thresholds: BTC **3**, LTC **6**, ETH **12**, ERC20 **12**, BEP20 **15**, TRC20 **19**. The canonical credit function uses the independently submitted verification count and compares it to that threshold; a zero-count scanner registration cannot satisfy it.
- `src/jobs/confirmationsWorker.ts` separately verifies chain confirmation depth, acquires a per-deposit claim, and invokes `process_deposit_atomic_with_lease`. Its cleanup path releases any unconsumed lease token after provider failures or below-threshold results.
- The integrity monitor requires agreement from at least two independent HTTPS RPC origins before recording a verified block-hash result. An inconclusive/mismatched result is retried; a proven reorg is durably recorded and alerted, with **no automatic wallet-balance reversal**.

### Approved release order and preflights

The existing forward migration sequence is:

1. `20261104120000_withdrawal_confirmation_and_control_flags.sql`
2. `20261104130000_deposit_confirmation_contract.sql`
3. `20261107210306_guard_terminal_deposit_registration_replay.sql`
4. `20261107211754_revoke_direct_deposit_credit_rpc_execution.sql`
5. `20261108013000_deposit_chain_integrity_monitor.sql`

The first four migrations establish the control flags, pending-registration and lease contracts, terminal replay guard, then remove direct service-role execution on the raw credit RPC. The integrity-monitor migration follows, with these read-only preflights:

- `supabase/tests/deposit_confirmation_contract_preflight.sql`
- `supabase/tests/terminal_deposit_registration_replay_preflight.sql`
- `supabase/tests/deposit_credit_rpc_acl_preflight.sql`
- `supabase/tests/deposit_chain_integrity_monitor_preflight.sql`

The confirmation preflight now verifies the exact positive network thresholds above, the zero-confirmation pending-registration contract, leased-worker execution and the canonical credit/replay guards. The five migrations and all four preflights passed a combined `BEGIN; ... ROLLBACK;` rehearsal against the live schema. A read-only catalog check afterwards confirmed all six new RPCs, the integrity table and its indexes remained absent; the raw credit RPC remained service-role executable; and the production ledger remained at 137 migrations / `20261103204401`.

No production DDL was retained. No deposit was credited, no worker was invoked and no financial operation was run. The deposit release remains a **production blocker** until the exact migration sequence is reconciled with all intervening migrations, applied in order by an authorized release operator, and the four preflights pass on the deployed schema.

## 8. Profile public projection remains a separate review

Production `profiles` has RLS enabled but still has a broad `Public profiles are viewable by everyone` SELECT policy. Anon has column-level SELECT grants for trader-card fields; authenticated has column-level SELECT and UPDATE grants for profile fields. Production lacks the `public_profiles` view and the `set_my_presence` RPC.

The old `20261101125944_secure_profile_public_projection.sql` combines several profile policy/grant changes with the presence RPC. Do not apply the whole historical migration merely to restore presence. The new narrow `20261108014000` migration restores the heartbeat without changing the public profile projection. The app's public-profile query paths and column-grant compatibility still require a separate migration/code review.

## 9. Deployment gate and next reconciliation work

**Current status: NO-GO for production migration execution.**

Before applying anything:
1. Reconcile the 90 historical untracked SQL files one by one against the applied ledger, live catalog, current source references and later replacement migrations.
2. Review the two modified older migrations separately.
3. Replay the exact approved migration release against a schema-faithful disposable database; do not mark historical migrations applied just to bypass history gaps.
4. Include all approved intervening migrations in version order. The presence, offline-ad, 2FA, support-admin, restricted-enum, admin/trade and supporting-table forward candidates must be applied only after the prior historical-release reconciliation and in exact version order. Configure Vault and match the deployed `CRON_SECRET` before scheduling account-deletion media cleanup.
5. Keep `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED` disabled until a separately approved isolated financial validation of the admin dispute wrapper has been completed.
6. Deploy compatible application code and verify all thirty-three SQL preflights before resuming deposit, sweep, gas-funding or trade-opening workers/routes.

A production migration being absent does not authorize a code workaround that bypasses authorization, idempotency, financial fencing, or audit guarantees. Preserve fail-closed behavior until the matching database contract is installed.

## 10. Trade/KYC SECURITY DEFINER dependency search paths

A read-only production catalog review on 8 November 2026 found five functions used by the canonical escrow and trade-expiry paths that remain postgres-owned SECURITY DEFINER functions with a public/auth search path:

| Function | Current production search path | Execution boundary |
|---|---|---|
| public.get_user_kyc_tier(uuid) | public, pg_temp | service_role and postgres |
| public.get_user_cumulative_buy_volume(uuid) | public, pg_temp | service_role and postgres |
| public.has_pending_withdrawal_approval(uuid) | public, auth, pg_temp | postgres only |
| public.expire_p2p_trade(uuid) | public, pg_temp | service_role and postgres |
| public.cancel_expired_p2p_trades() | public, pg_temp | service_role and postgres |

The canonical initiate_trade_with_escrow already has an empty search path and calls the two KYC helpers plus the pending-withdrawal helper. The expiry functions are part of the same trade lifecycle. Read-only inspection confirmed all five function bodies use schema-qualified non-catalog references (public.* and, where applicable, auth.users/auth.*); their application object references do not rely on an implicit public or auth path.

The existing historical candidate 20261019150000_harden_security_definer_search_paths.sql covers a different six-function set and does not include these five current escrow dependencies. It is not a substitute for this narrow forward fix.

### Prepared forward hardening

- 20261108180000_empty_trade_dependency_search_paths.sql
  - Requires the exact production owner, SECURITY DEFINER flag, current search path, qualified source references and established grants before changing anything.
  - Sets search_path to empty on exactly these five functions.
  - Verifies prosrc (the function body), owner, SECURITY DEFINER flag and proacl are unchanged, and confirms the expected execution boundary after the change.
  - Does not change financial behavior, table data, function signatures or execution grants.

- supabase/tests/trade_dependency_search_path_preflight.sql
  - Verifies all five functions are postgres-owned SECURITY DEFINER functions with an empty search_path.
  - Verifies expected schema-qualified object references and that anon/authenticated cannot execute them; service_role access matches the reviewed contract.

The migration and preflight parse as PostgreSQL statements, and the read-only production precondition query passed for all five targets. No migration was applied or rehearsed with DDL against production. The broader set of SECURITY DEFINER functions using public search paths remains a separate database-wide audit item; this migration makes no claim to resolve all such functions.

## 11. Database-wide SECURITY DEFINER search-path inventory

A read-only catalog inventory on 8 November 2026 found:

- **176** public-schema SECURITY DEFINER functions.
- All 176 have an explicit function-level search_path setting; none relies on an unset/default function-level path.
- **45** functions have an explicit path that includes public, auth or pg_temp.
- For those 45 functions, anon and authenticated do not have execution permission and there is no PUBLIC EXECUTE grant. A subset is service-role executable; the rest are postgres-only. This is a path-hardening inventory, not a claim that all 45 are exploitable.
- The catalog review did not find a reason to alter any function's business body as part of a search-path-only pass.

### Prepared search-path-only batches

**Batch 1 — 20261108180000_empty_trade_dependency_search_paths.sql**

Covers the five trade/escrow dependencies:
- get_user_kyc_tier(uuid)
- get_user_cumulative_buy_volume(uuid)
- has_pending_withdrawal_approval(uuid)
- expire_p2p_trade(uuid)
- cancel_expired_p2p_trades()

Their production owners, SECURITY DEFINER flags, exact existing paths, grants and qualified references were checked read-only. supabase/tests/trade_dependency_search_path_preflight.sql checks the resulting empty paths and role boundaries.

**Batch 2 — 20261108190000_empty_profile_trigger_search_paths.sql**

Covers 13 reviewed profile/KYC/trigger helpers:
- check_kyc_review_timeout(uuid)
- generate_random_username()
- generate_system_username()
- get_admin_security_status(uuid)
- get_user_remaining_buy_allowance(uuid)
- handle_new_user_profile()
- handle_new_user_wallets()
- handle_new_user()
- handle_profile_status_operation_ownership()
- handle_trade_status_sync()
- handle_trade_volume_update()
- prevent_usd_value_at_trade_update()
- fn_update_user_trade_metrics()

The read-only production precondition query confirmed all 13 have the expected postgres owner, SECURITY DEFINER flag, exact existing search_path, execution grants and no PUBLIC EXECUTE. Exact body anchors for their schema-qualified references or trigger/builtin-only behavior were checked. The apparent EXECUTE match in fn_update_user_trade_metrics() is a comment phrase, not a dynamic SQL statement. supabase/tests/profile_trigger_search_path_preflight.sql asserts the post-change configuration and grants.

The first two batches alter only each function's search_path; they preserve prosrc, owner, SECURITY DEFINER status and proacl. Both migration files and both preflights parse as PostgreSQL statements.

**Batch 3 — 20261108200000_empty_wallet_provisioning_search_path.sql**

Covers the active application RPC `provision_user_wallets_atomic(uuid,integer,text,text,text,text)`. The production precondition query confirmed its postgres owner, SECURITY DEFINER flag, exact prior `search_path=public, auth, pg_temp`, service_role execute grant, no anon/authenticated/PUBLIC execute, all 11 required schema-qualified dependency anchors, no `auth.` source dependency and no dynamic SQL token. Its application callsite in `src/lib/hd-derivation-engine.ts` uses the service-role client. The migration alters only the function search_path and verifies that `prosrc`, owner, SECURITY DEFINER status and ACL are unchanged. `supabase/tests/wallet_provisioning_search_path_preflight.sql` checks the post-change source anchors, path and grant boundary.

All three new migrations and their three SQL preflights parse as PostgreSQL statements. These are local release candidates only: none has been applied or DDL-rehearsed against production.

### Remaining 26 functions with existing migration dependencies or retirement review

The following 26 functions still have one of the inventoried public/auth/temp paths and are not included in the three new search-path-only batches above. Several already have dedicated hardening or retirement migrations in the ordered release; they must be reconciled against those migrations rather than patched a second time:

- acquire_withdrawal_worker_lock()
- admin_adjust_balance(text,uuid,text,text,numeric)
- allocate_hot_wallet_nonce(integer)
- allocate_hot_wallet_nonce(text,text,bigint)
- claim_next_deposit_sweep(text,integer)
- credit_confirmed_deposit(character varying,integer,character varying,uuid,character varying,numeric)
- ensure_user_balance_wallet(uuid,text)
- execute_internal_transfer(uuid,text,text,numeric,text)
- execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)
- extend_sweep_lease(uuid,text,integer)
- ingest_and_credit_deposit(text,integer,text,text,numeric,text,integer)
- initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
- initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)
- mark_gas_funded(uuid,text)
- mark_swept(uuid,text)
- persist_signed_evm_transaction(uuid,text,text,bigint,text,text,integer)
- process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)
- process_user_deposit(uuid,text,numeric,text,text,text,text)
- process_user_deposit(uuid,text,text,text,numeric,text)
- record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)
- release_withdrawal_worker_lock()
- reserve_utxos_for_sweep(uuid,text,jsonb,integer)
- sync_didit_kyc_status(uuid,text,text,jsonb)
- update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)
- verify_and_lock_pre_broadcast_cleanup(uuid,text)
- verify_sweep_ownership(uuid,text,text)

These remaining functions include direct deposit-credit, transfer, admin-balance, sweep, gas-funding, signed-transaction and legacy state paths. A subset is already covered by explicit, ordered forward candidates documented in Section 12; the others remain legacy/owner-only or require caller-graph review. Do not add a duplicate path-only migration or batch them based on the absence of an obvious unqualified table reference alone.

The local audit also corrected false positives from simple text scanning: SQL aliases, trigger NEW/OLD fields, SET clauses, comment text and parameter names can look like unqualified relation references. A function is not approved for an empty path solely because a regex scan returns no obvious table name.

**Current inventory disposition:** 19 of the 45 public/auth/temp-path functions have prepared search-path-only forward candidates across three new migrations; the remaining 26 are either mapped to earlier forward hardening/retirement candidates or retained for caller-graph review. The audit does not replace the 90-file historical migration reconciliation requirement and does not change the production NO-GO decision.

## 12. Financial SECURITY DEFINER functions: existing forward-migration mapping

The remaining path findings are not a reason to create one blanket ALTER FUNCTION migration. The current local release already contains ordered candidates that change search paths, replace obsolete signatures, or revoke direct execution. The following mappings were reconciled against the checked-in migration sources and the read-only production catalog where noted.

### Canonical deposit credit and legacy credit routines

process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)

- Production currently reports postgres ownership, SECURITY DEFINER, search_path=public, pg_temp, and service_role execution. The registration and lease-protected credit wrappers are absent in the live catalog.
- 20261104130000_deposit_confirmation_contract.sql creates the pending-registration, claim/release and lease-protected credit wrappers, and changes the canonical credit function to search_path=pg_catalog.
- 20261107210306_guard_terminal_deposit_registration_replay.sql is the dependent terminal-replay guard. Its live read-only preflight markers were checked: the exact current definition path marker, ledger replay guard, ledger reference identity, pending state and existing-row replay markers are present. Normalize CRLF to LF when comparing pg_get_functiondef; a raw line-ending comparison falsely reports the valid source anchors as missing.
- 20261107211754_revoke_direct_deposit_credit_rpc_execution.sql then removes service_role from the raw credit primitive. It requires the wrappers and the postgres-owned SECURITY DEFINER/pg_catalog path to exist first.
- Do not add another path migration or apply the direct-credit ACL revocation early. The three candidates are ordered as wrapper installation, terminal replay hardening, then direct service-role ACL revocation. Keep all deposit workers paused until the wrappers and final ACL preflight are present.

The legacy credit_confirmed_deposit(...), ingest_and_credit_deposit(...) and both listed process_user_deposit(...) overloads currently have no anon/authenticated/service-role execution grant in the production catalog; their execution boundary is postgres-only. The older candidate 20261013231919_revoke_unverified_legacy_deposit_credit_rpcs.sql records their direct-service revocation. A source search found no direct application callsite for these legacy RPC names in src. Preserve the postgres-only boundary and complete a database caller-graph check before considering deletion or any body change.

### Canonical internal transfer and legacy wallet-transfer retirement

execute_internal_transfer(uuid,text,text,numeric,text)

- Production currently reports postgres ownership, SECURITY DEFINER, search_path=public, pg_temp, and service_role execution.
- 20261105220000_reconcile_authoritative_fee_configuration.sql is the configured-fee/receipt migration. Its production preconditions were checked read-only: public.app_settings and its unique key contract exist, and every exact source anchor in the live transfer definition matched after normalizing CRLF to LF. Those anchors include the search-path marker, caller identity guard, fee-rate declaration, replay guard/receipt, calculation block, request fingerprint and final receipt.
- That migration changes the function path to pg_catalog, enforces the caller-identity guard, reads the configured fee from public.app_settings, and aligns replay and receipt fields. 20261107170000_snapshot_transfer_fee_rate_in_authoritative_receipt.sql depends on that configured-fee and receipt contract.
- 20261107160000_restrict_legacy_financial_mutation_helpers.sql and 20261107180000_restrict_legacy_trade_kyc_helper_execution.sql provide later path/ACL restrictions on the canonical transfer and its supporting helpers. Do not replace these with a duplicate path-only patch.

execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)

- Production still contains the legacy postgres-owned SECURITY DEFINER routine with search_path=pg_catalog, public, pg_temp and service_role execution.
- 20261106050000_retire_legacy_wallet_transfer_rpc_and_verify_transfer_contract.sql explicitly retires it by revoking execution from public client roles and service_role; its preconditions require the configured-fee canonical transfer receipt, search_path=pg_catalog, and the unique sender/idempotency index. The live unique index was confirmed present. A source search found no application callsite for this legacy RPC.
- Do not apply this retirement before 20261105220000 and its required downstream contract. The retirement is safer than trying to rehabilitate a second balance/receipt implementation.

### Shared legacy financial mutation helpers

20261107160000_restrict_legacy_financial_mutation_helpers.sql is the mapped hardening candidate for:
- admin_adjust_balance(...) overloads
- ensure_user_balance_wallet(uuid,text)
- mark_gas_funded(uuid,text)
- mark_swept(uuid,text)
- record_platform_ledger_entry(...)

The live read-only preconditions were checked: the overload owners are postgres; the legacy helper caller scan found no PL/pgSQL function callers for the first four names; and the ledger-entry helper is called by complete_onchain_withdrawal and process_failed_withdrawal, both postgres-owned SECURITY DEFINER functions. The migration sets reviewed paths to empty and restricts direct service-role access. It must be kept in the ordered release; do not add a second generic helper migration.

### Wallet nonce, sweep lifecycle and signed-transaction routines

The following checked-in candidates already implement empty-path hardening, stronger state/lease fencing, replacement signatures, or direct-execution revocation. They must be reconciled/applied in their existing dependency order rather than copied into a new path migration:

- allocate_hot_wallet_nonce(integer) and allocate_hot_wallet_nonce(text,text,bigint) — 20261107120000_revoke_direct_hot_wallet_nonce_allocators.sql; pins their paths and removes direct service-role execution in favour of the server-owned allocation flow.
- claim_next_deposit_sweep(text,integer), extend_sweep_lease(uuid,text,integer) and verify_sweep_ownership(uuid,text,text) — 20261106114027_fence_sweeper_worker_leases_and_gas_funding_claims.sql.
- update_sweep_operation_status(...), verify_and_lock_pre_broadcast_cleanup(uuid,text) and initialize_resource_delegation(...) — 20261107150000_harden_sweep_status_and_tron_cleanup_rpcs.sql.
- persist_signed_evm_transaction(...) — the older seven-argument signature is replaced by the intent-bound signature in 20261105110000_bind_evm_sweep_intent.sql; do not harden an obsolete overload instead of reconciling the replacement.
- reserve_utxos_for_sweep(...) — later UTXO lifecycle migrations use the intent-bound overload and preserve reserved values; reconcile the old four-argument compatibility signature separately rather than broadening its execution grants.
- acquire_withdrawal_worker_lock() and release_withdrawal_worker_lock() — 20261103094840_retire_orphaned_withdrawal_helpers_and_restrict_networks.sql is the historical retirement/restriction candidate. The live catalog currently shows no anon/authenticated/service-role execute grant; do not revive these helpers for worker coordination.

The matching source files contain empty-search-path settings for the intended hardened implementations, but the local catalog review in this step did not execute or DDL-rehearse those migrations. Their exact dependencies and signatures still require the normal production-catalog preflight at the time the approved release is reconciled.

### Legacy KYC status writer

sync_didit_kyc_status(uuid,text,text,jsonb) is covered by 20261108001000_retire_legacy_didit_kyc_status_writer.sql, which checks callers, retires the old status writer, pins the path and revokes direct execution. Do not create a competing path-only change; apply the retirement only after its replacement webhook/session contract is installed.

initiate_p2p_trade(...) is similarly a legacy wrapper covered by 20261107180000_restrict_legacy_trade_kyc_helper_execution.sql; that migration hardens its path and removes direct execution so trade creation flows through the canonical escrow RPC.

Result: the new empty-path batches now cover 19 of the 45 inventoried functions (5 trade dependencies, 13 profile/trigger helpers and the active wallet-provisioning RPC). The remaining 26 are mapped above to existing ordered forward hardening/retirement candidates or explicitly retained for legacy caller-graph review. This is an inventory and dependency mapping only: no migration from this section was applied to production, no production DDL was run, and the overall release remains NO-GO pending historical migration reconciliation and full ordered preflight.

## 13. Sweeper worker signed-intent and EVM gas-funding contract reconciliation

A read-only production catalog review on 8 November 2026 compared the current source in src/jobs/sweeperWorker.ts with the live public function signatures, ACLs, search paths, columns and triggers. This found a release-critical mismatch: the current worker source uses newer intent-bound RPC contracts, but production still has older overloads and lacks their supporting schema.

### Current worker call contracts

The current worker calls the following RPCs and supplies the named payloads:

- persist_signed_evm_transaction with the 12-argument intent-bound signature, including asset, token contract, recipient, raw amount and chain ID.
- persist_signed_btc_ltc_transaction with the seven-argument signature that includes a JSONB signed_utxo_intent containing all input outpoints and values, destination script, output amount and fee.
- allocate_gas_funding_nonce(uuid,text,text,text,bigint) before signing any EVM gas-funding transaction.
- record_evm_gas_funding_receipt with the nine-argument, confirmation-depth-aware receipt payload.
- record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text) for an observed nonce conflict.
- The same worker also uses the lease-aware claim, lease-extension, ownership-verification, sweep-state and value-bound UTXO-reservation APIs.

The BTC/LTC and EVM signing paths persist the exact signed transaction before broadcast. A missing intent-bound RPC therefore causes that worker path to fail before its broadcast step; the old overload is not a compatible fallback. The operation-bound gas nonce allocator is called before EVM gas-funding signing and is also a hard prerequisite.

### Live production findings

The live catalog returned these exact conditions:

1. EVM signed persistence
   - Present: the old seven-argument persist_signed_evm_transaction(uuid,text,text,bigint,text,text,integer).
   - Its current path is public, pg_temp; it is postgres-owned SECURITY DEFINER and remains executable by service_role.
   - Missing: the 12-argument intent-bound overload used by the current worker.
   - The live sweep_operations table lacks signed_asset_code, signed_token_contract, signed_recipient, signed_amount_raw and signed_chain_id.

2. BTC/LTC signed persistence and reservation values
   - Present: the old six-argument persist_signed_btc_ltc_transaction(uuid,text,text,text,text,integer), postgres-owned SECURITY DEFINER with empty search_path and service_role execution.
   - Missing: the seven-argument JSONB-intent overload called by the current worker.
   - sweep_operations lacks signed_utxo_intent.
   - utxo_reservations lacks value_sat.
   - The currently available five-argument reserve_utxos_for_sweep(uuid,text,text,jsonb,integer) has empty search_path and service_role execution, but its live body has no value_sat handling. It therefore does not yet bind each reservation to its independently verified previous-output value.
   - The live catalog lacks the signed-intent immutability trigger and the UTXO reservation-value matching trigger. The signed-sweep failure and protected reservation lifecycle triggers from the later candidates are also required before resuming.

3. EVM gas-funding nonce and receipt
   - Present: claim_gas_funding_operation, persist_signed_gas_funding and update_gas_funding_operation_status, each postgres-owned SECURITY DEFINER with empty search_path and service_role execution.
   - Missing: allocate_gas_funding_nonce(uuid,text,text,text,bigint).
   - Missing: the finality-aware record_evm_gas_funding_receipt(uuid,text,text,smallint,integer,numeric,numeric,bigint,text).
   - Missing: record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text).
   - gas_funding_operations currently lacks funding_wallet_address, actual_funding_tx_gas_used, actual_funding_tx_effective_gas_price, actual_funding_tx_fee, funding_receipt_status, funding_receipt_block_number, funding_receipt_block_hash and funding_receipt_confirmations.
   - hot_wallet_nonces exists with chain_id/current_nonce, but the operation-bound gas allocator is not installed.

4. Sweep worker lease and generic nonce boundaries
   - claim_next_deposit_sweep, verify_sweep_ownership and extend_sweep_lease exist, but all three still use public, pg_temp and are service_role executable. The 20261106114027 forward migration replaces them with empty-path lease-fenced definitions.
   - update_sweep_operation_status and verify_and_lock_pre_broadcast_cleanup exist, but still use public, pg_temp and are service_role executable. The 20261107150000 candidate replaces/hardens those RPCs and pins their paths.
   - initialize_resource_delegation remains service_role executable with public, pg_temp. The same 20261107150000 candidate leaves this legacy helper postgres-only and points current workers to claim_or_initialize_resource_delegation.
   - Both generic allocate_hot_wallet_nonce overloads still have service_role execution in production. The 20261107120000 migration sets empty paths and revokes direct execution from API/runtime roles.
   - These findings are not fixed by the wallet-provisioning search-path migration; they are separate worker functions and must follow the sweep dependency chain.

A final read-only marker query confirmed all five missing current worker RPCs above, the absence of signed intent columns and key triggers, the live reservation function's lack of value_sat handling, and direct service_role execution on both generic nonce allocator overloads. No DDL or financial operation was run.

### Required ordered migration candidates

The exact migration candidates that establish the current worker contracts are already in the local release inventory:

- 20261104160000_restore_deposit_sweep_nonce_allocator.sql
- 20261104170000_bind_hot_wallet_nonces_to_funding_operations.sql
- 20261104180000_record_evm_gas_funding_receipts.sql
- 20261105100000_harden_signed_evm_sweep_persistence.sql
- 20261105110000_bind_evm_sweep_intent.sql
- 20261105120000_bind_btc_ltc_sweep_intent.sql
- 20261105130000_protect_signed_utxo_reservations.sql
- 20261105160000_bind_reserved_utxo_values.sql
- 20261105170000_preserve_reserved_withdrawal_nonces.sql
- 20261105180000_serialize_shared_evm_hot_wallet_nonce_stream.sql
- 20261105190000_require_persisted_evm_withdrawal_receipts.sql
- 20261105200000_record_unresolved_evm_withdrawal_nonce_incidents.sql
- 20261105210000_record_unresolved_evm_gas_funding_nonce_incidents.sql
- 20261106112502_harden_evm_gas_funding_receipt_finality.sql
- 20261106114027_fence_sweeper_worker_leases_and_gas_funding_claims.sql
- 20261107100000_fence_shared_evm_nonce_recovery_claims.sql
- 20261107120000_revoke_direct_hot_wallet_nonce_allocators.sql
- 20261107130000_revoke_direct_nonce_and_sweeper_table_writes.sql
- 20261107140000_repair_sweep_operations_ready_to_broadcast_status.sql
- 20261107150000_harden_sweep_status_and_tron_cleanup_rpcs.sql
- 20261107160000_restrict_legacy_financial_mutation_helpers.sql

They must be reconciled and applied with all intervening migrations in strict version order. The signed-intent migration depends on the earlier EVM persistence definition; BTC/LTC intent persistence precedes reservation-value binding and lifecycle triggers; receipt finality and nonce incidents build on the operation-bound nonce/receipt tables; and generic nonce access is revoked only after operation-bound allocators are in place. Do not apply a later ACL revocation or resume workers while an earlier contract is missing.

### Preflight coverage

Existing release preflights already cover the operation-bound EVM nonce stream, nonce recovery claims, legacy generic nonce ACLs, worker-table RLS/grants, sweep lease fencing, READY_TO_BROADCAST status and TRON cleanup:

- supabase/tests/evm_gas_funding_nonce_stream_preflight.sql
- supabase/tests/evm_hot_wallet_nonce_recovery_claims_preflight.sql
- supabase/tests/legacy_hot_wallet_nonce_allocator_acl_preflight.sql
- supabase/tests/nonce_and_sweeper_table_acl_preflight.sql
- supabase/tests/sweeper_worker_lease_fencing_preflight.sql
- supabase/tests/sweep_operations_ready_to_broadcast_status_preflight.sql
- supabase/tests/sweep_status_and_tron_cleanup_preflight.sql

The new supabase/tests/signed_sweep_intent_contract_preflight.sql covers the gap left by those checks: exact current EVM/BTC/LTC signature overloads, retirement of old persistence signatures, empty-path/service-only execution, intent and value columns, value-bound reserve RPC body, enabled integrity triggers and trigger-function privileges. It is a read-only catalog/schema preflight; it creates no transaction, nonce, reservation, receipt or broadcast.

### Release decision for sweep workers

The current worker release is not compatible with the live sweep catalog yet. Keep sweep and EVM gas-funding workers paused until the complete ordered migration inventory is reconciled, the new signed-intent preflight and all existing nonce/lease/status preflights pass, and the matching worker code is deployed. The current RPC mismatch fails closed before the normal signed-transaction broadcast step, but it will prevent sweeping/gas funding from completing. Do not bypass the missing contracts with direct table writes, old persistence overloads or generic nonce allocation.

No migration from this section was applied to production. The production decision remains NO-GO pending full historical migration reconciliation, the ordered migration release and the complete 33-preflight gate.
