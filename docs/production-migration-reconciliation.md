# Paxones production migration reconciliation audit

**Checked:** 8 November 2026
**Project:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)
**Repository:** `tkishanmkm/cleanp2p`
**Branch at inspection:** `fix/production-typecheck-batch-1`

## Executive finding

**Production migration execution remains NO-GO.** The Supabase migration ledger stops at `20261103204401` (137 recorded migrations). There are 90 untracked historical SQL files with versions at or before that recorded head, two modified older SQL files, and a long sequence of later tracked migrations. Their exact effects cannot be inferred safely from names or file presence.

The audit also confirmed that several current application paths call RPCs/tables which are absent from the live catalog. These are real operational gaps, not merely untracked-file bookkeeping. Two narrow forward migrations have been prepared and rehearsed for the trade-opening path (presence heartbeat + seller-online guard), but neither has been applied.

No production DDL or financial operation was executed.

## 1. Migration inventory and provenance

Live `supabase_migrations.schema_migrations`:

- Applied migration count: **137**
- Latest version: `20261103204401`
- Latest name: `lock_admin_audit_logs_to_verified_server_routes`

Local inventory observed before the two new forward migrations in this audit:

- **62** tracked, clean SQL files newer than the production head.
- **90** untracked SQL files dated from `20261017010000` through `20261102000003`, all at or before the production head.
- **2** modified older SQL files:
  - `20260928020000_withdrawal_hardened_rpcs.sql`
  - `20260928070000_canonical_p2p_state_machine_and_rpcs.sql`

Two new forward files prepared during this audit are newer than the production head:

- `20261108014000_restore_authenticated_presence_rpc.sql`
- `20261108020000_guard_offline_ad_trade_opening.sql`

The 90 historical file versions are absent from the production migration ledger. That establishes missing migration provenance, but not that every contained schema change is absent: some effects exist via other applied migrations or live catalog changes. Do not apply, delete, rename, or mark historical files applied without a file-by-file code/catalog comparison.

### Confirmed examples of superseded or non-blocking candidates

- `20261101130000_align_live_didit_webhook_schema_and_event_leases.sql`: the production `kyc_webhook_events` table and webhook claim/finish RPCs are already present. The exact old migration version is absent, but its functional effect is at least partly represented by another deployed change. It is not safe to run it again blindly.
- `20261019180000_add_idempotent_withdrawal_wrapper.sql`: `withdrawal_idempotency_keys` table is absent, but the currently installed `request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)` function does not reference that table. The old candidate is not evidence of the current production implementation.
- `20261024170000_withdrawal_worker_lease.sql`: this file is explicitly a no-op draft. The actual `src/jobs/withdrawalWorkerLease.ts` helper has no active callsites, and the current withdrawal dispatcher uses `claim_pending_withdrawals(p_limit,p_worker_id)` with per-withdrawal leases. The old singleton lease table/RPCs are not a proven current withdrawal-dispatch blocker.

## 2. Confirmed current application / production catalog gaps

The following RPCs were found in application code, but the exact RPCs were absent from the live `public` function catalog at audit time:

| Missing RPC | Current code reference | Impact |
|---|---|---|
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
| `configure_support_admin` | `src/app/api/admin/support-admins/route.ts` | Support-admin configuration fails. |

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

## 4. Profile public projection remains a separate review

Production `profiles` has RLS enabled but still has a broad `Public profiles are viewable by everyone` SELECT policy. Anon has column-level SELECT grants for trader-card fields; authenticated has column-level SELECT and UPDATE grants for profile fields. Production lacks the `public_profiles` view and the `set_my_presence` RPC.

The old `20261101125944_secure_profile_public_projection.sql` combines several profile policy/grant changes with the presence RPC. Do not apply the whole historical migration merely to restore presence. The new narrow `20261108014000` migration restores the heartbeat without changing the public profile projection. The app's public-profile query paths and column-grant compatibility still require a separate migration/code review.

## 5. Deployment gate and next reconciliation work

**Current status: NO-GO for production migration execution.**

Before applying anything:
1. Reconcile the 90 historical untracked SQL files one by one against the applied ledger, live catalog, current source references and later replacement migrations.
2. Review the two modified older migrations separately.
3. Replay the exact approved migration release against a schema-faithful disposable database; do not mark historical migrations applied just to bypass history gaps.
4. Include all approved intervening migrations in version order. The presence and offline-ad forward candidates must be applied after the prior historical-release reconciliation and before restarting trade-opening APIs.
5. Deploy compatible application code and verify the SQL preflights before resuming routes/workers.

A production migration being absent does not authorize a code workaround that bypasses authorization, idempotency, financial fencing, or audit guarantees. Preserve fail-closed behavior until the matching database contract is installed.
