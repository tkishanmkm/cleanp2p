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
| `record_ad_offline_open_attempt(text,text)` | `src/lib/ad-owner-availability.ts` | All three trade-opening API routes call this guard before escrow initiation; errors return HTTP 503. |
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

Three current routes call `checkAdOwnerAvailability()` before calling `initiate_trade_with_escrow`:

- `src/app/api/trades/route.ts`
- `src/app/api/trades/initiate/route.ts`
- `src/app/api/trades/create/route.ts`

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
6. Deploy compatible application code and verify all ten SQL preflights before resuming routes/workers.

A production migration being absent does not authorize a code workaround that bypasses authorization, idempotency, financial fencing, or audit guarantees. Preserve fail-closed behavior until the matching database contract is installed.
