# WAYONES Production Audit — Step 12
**Title:** Customer withdrawal entry points, idempotency, restricted-account recovery and administrator approval  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Free-tier tools/resources only  
**Scope:** Customer withdrawal APIs, idempotency/retry keys, account eligibility, fee/KYC/TOTP/limits, banned-account payout, admin approval/rejection, worker dispatch routes, production control switches  
**Financial activity:** Read-only catalog/config/queue inspection. No withdrawal, refund, reservation, balance mutation, broadcast or blockchain transaction was initiated.

## Executive status

**Step 12 source hardening is prepared; production withdrawals remain intentionally disabled.** The canonical customer request service correctly centralizes validation and idempotent reservation, but the new replay-lookup RPC it calls is missing from production. The database reservation RPC exists and is service-role-only. Current platform controls independently disable withdrawals.

The banned-account final-withdrawal route was previously incompatible with the shared withdrawal service: it called the generic service without an idempotency key, while the generic service explicitly denies banned/restricted/suspended accounts. Rather than bypass these controls, the route now fails closed until a separately authorized and audited final-payout workflow exists.

## Live production evidence (read-only)

### Withdrawal control switches

| Setting | Live value |
|---|---:|
| `platform_settings.withdrawals_enabled` | false |
| `platform_settings.global_kill_switch_active` | true |
| `system_settings.prevent_withdrawals` | true |
| `system_settings.emergency_mode` | false |
| Max single withdrawal USD | 4,000 |
| Daily withdrawal limit USD | 10,000 |
| Manual approval threshold USD | 2,000 |
| Withdrawal fee multiplier | 2.0 |
| Password-change withdrawal hold | 24 hours |

No switch was changed. Do not enable withdrawals until the replay RPC, receipt/finality/lease contracts, isolated tests and operations monitoring are ready.

### Withdrawal queue state

| Table | Active/relevant rows |
|---|---:|
| Active withdrawal mirror statuses | 0 |
| Active canonical on-chain withdrawal statuses | 0 |
| Durable withdrawal broadcast records | 0 |
| Withdrawal nonce reservations | 0 |

No live withdrawal or broadcast exists in the inspected queues.

### RPC availability and grants

- `request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)`: installed; service_role EXECUTE only; anon/authenticated EXECUTE false.
- `get_withdrawal_idempotency_replay(uuid,text,text,numeric,text,text)`: missing.
- Legacy `execute_final_withdrawal(uuid,varchar,varchar,text,numeric)`: installed, but service_role/authenticated/anon EXECUTE are all false.
- `approve_withdrawal(uuid,uuid)` and `reject_withdrawal_pending_approval(uuid,uuid,text)`: PostgreSQL-owned SECURITY DEFINER, empty search path, service_role-only, row-lock and audit paths present.

The current source migration `20261105260000_withdrawal_replay_before_market_checks.sql` defines the missing replay RPC, but it is not recorded in production migration history. The earlier end-to-end withdrawal contract migration `20261102195301_repair_withdrawal_end_to_end_contract.sql` is recorded.

## W12-01 — Missing withdrawal idempotency replay lookup
**Severity: Critical — current request flow fails closed**

The current `executeCanonicalWithdrawal()` service performs a replay lookup before resolving market/fee data:
`get_withdrawal_idempotency_replay(...)`.

The production function is missing. The service checks the RPC error and returns a safe unavailable response; it does not fall back to a non-idempotent request path. The subsequent atomic reservation RPC `request_withdrawal_idempotent` is present and service-role-only, but the application cannot safely establish the exact prior result for a retry while the replay function is absent.

Source migration `20261105260000_withdrawal_replay_before_market_checks.sql`:
- binds replay to the authenticated server request's user/asset/network/address/amount/idempotency key fingerprint;
- returns a structured `found` result and the previously persisted response payload;
- runs with an empty search path;
- grants execution only to service_role/postgres.

It is not recorded/applied in production. The missing RPC must be restored through the ordered migration reconciliation; no direct SQL or legacy helper fallback was added.

## W12-02 — Customer request entry points converge on one canonical service
**Severity: Reviewed — no direct customer SQL mutation path found**

The three current customer POST routes use `executeCanonicalWithdrawal()`:
- `/api/withdraw`
- `/api/wallet/withdraw`
- `/api/withdrawals/request`

They pass the idempotency key from the dedicated header/body into the same validation and reservation service. They do not call raw `request_withdrawal` or directly update `wallet_assets`.

The service includes:
- an explicit application `ENABLE_WITHDRAWALS=true` feature gate;
- session/bearer authentication;
- account status gates for banned, restricted, suspended, on-hold, withdrawal-locked, emergency-frozen, minor-restricted and withdrawals-disabled states;
- password-change hold enforcement;
- KYC tier 2 requirements;
- TOTP validation when the account has 2FA enabled;
- allowlisted supported asset/network pairs, destination validation and network-specific decimal precision;
- a required 16–128 character idempotency key;
- replay lookup before authoritative fee resolution;
- server-side network fee calculation (client-displayed fee is not authoritative);
- USD minimum and rolling/single withdrawal limits;
- a service-only atomic reservation RPC that records principal + fee in the withdrawal liability bucket;
- a response check that returned principal + fee equals the committed total.

The current supported withdrawal set is narrower than all displayed wallet assets. BTC/LTC withdrawal is not enabled in this shared path until the UTXO withdrawal pipeline and its signed-transaction recovery/finality controls are complete. USDT supports the configured TRC20/ERC20/BEP20 paths; ETH supports its configured EVM network path.

## W12-03 — Banned-account final withdrawal was not a safe exception
**Severity: High — incomplete/incompatible recovery route**

The old `/api/user/banned-withdrawal` route:
- read the full spendable `wallet_assets.balance`;
- called the generic `executeCanonicalWithdrawal()` service without supplying a retry/idempotency key;
- relied on a service that explicitly rejects banned accounts;
- did not have a separate admin approval, recovery ledger or final-payout state machine.

It therefore could not complete a successful safe withdrawal and must not bypass common account restrictions.

**Source change:** this route now authenticates the session, verifies the user's restriction state, and for banned accounts returns:
`BANNED_FINAL_WITHDRAWAL_UNAVAILABLE` (HTTP 503).

It does not read wallet balances, create an idempotency key, call the generic withdrawal service, reserve funds, write ledger entries, dispatch a worker or broadcast a transaction. A separately designed owner-bound, admin-approved, audited final-payout workflow is required before this endpoint can do anything beyond fail closed.

The legacy `execute_final_withdrawal` RPC exists in production but has no service_role, authenticated or anon EXECUTE grant. No new grant was added.

## W12-04 — Client retry-key persistence is designed to avoid duplicate withdrawals
**Severity: Reviewed — existing source control retained**

The current client `withdrawal-idempotency-store.ts`:
- hashes the user ID and request fingerprint for its local storage key;
- stores only a random UUID retry key and creation timestamp, not destination/address/amount fields;
- uses the browser Web Locks API when available to serialize same-intent key creation;
- persists the key before submitting a request;
- clears it only after a definitive successful API response;
- reuses the same key after ambiguous responses.

The wallet context fingerprints asset/network/destination/amount and intentionally excludes the displayed fee because the server recalculates it. A retry does not apply a second optimistic debit; a new intent checks available balance and applies one optimistic move from available to in-withdrawal. Server idempotency remains the source of truth.

## W12-05 — Direct/legacy worker routes remain retired or canonical/secret-protected
**Severity: Reviewed — no customer-facing direct broadcast route found**

- `/api/withdrawals/dispatch` and `/api/internal/withdrawals/process` return HTTP 410 for legacy processors.
- `/api/workers/withdraw` is retired and returns HTTP 410 after worker authentication.
- `/api/cron/withdrawals/dispatch` uses the canonical `processPendingWithdrawals()` worker and worker-secret verification.
- `/api/workers/withdrawals` requires worker-secret auth and calls `processAllPendingWithdrawals()`.
- `processAllPendingWithdrawals(maxBatch)` clamps a caller-supplied batch to at most 100 rows. The single-item path uses the same worker queue/lease-aware implementation.
- The Step 8 audit still applies: several live lease/receipt/finality RPCs required by current worker code are missing. Do not treat the presence of the HTTP dispatch route as proof that production broadcasting is ready.

## W12-06 — Admin withdrawal approval/rejection identity was only flag-based in SQL
**Severity: High — privileged service-role boundary lacked active-account check**

Production `approve_withdrawal` and `reject_withdrawal_pending_approval` are service-role-only SECURITY DEFINER functions with empty search paths. Their bodies:
- require service_role;
- lock the legacy withdrawal mirror and canonical on-chain withdrawal rows;
- verify an administrator ID against `app_admins`, profile admin flags and app_metadata role;
- update paired withdrawal state;
- refund principal + fee atomically on an eligible not-yet-broadcast rejection;
- insert audit rows in the same transaction.

They did **not** check the current active full-admin account state before approving/refunding. The HTTP routes already call `verifyServerAdmin(req)` (which rejects support admins and checks active account flags/2FA), but database-side enforcement was weaker.

Added guarded migration:
`20261120223000_step_12_harden_withdrawal_admin_actor_identity.sql`

It:
- creates private `is_active_withdrawal_admin_actor(uuid)`;
- requires `verify_admin_login` to identify a full admin;
- requires profile status `active`;
- rejects banned, suspended, restricted, on-hold, emergency-frozen, minor-restricted and blocked account_status values;
- revokes the helper from PUBLIC/anon/authenticated/service_role and leaves it executable by postgres (the SECURITY DEFINER parent functions);
- replaces only the reviewed identity-check blocks in `approve_withdrawal` and `reject_withdrawal_pending_approval`;
- preserves function body outside the reviewed block, owner, SECURITY DEFINER mode, empty search path and ACL;
- preserves the existing row locks, state updates, balance refund and audit writes.

The migration refuses to run if function signatures, source markers, grants or security posture differ from the audited production snapshot. It has not been applied.

## W12-07 — Admin approval route validation and error response
**Severity: Medium — input hardening / internal error handling**

`/api/admin/withdrawals/approve` already requires `verifyServerAdmin` and rejects support administrators, but it accepted any non-empty string as a withdrawal ID and returned raw unexpected exception text.

Source changes:
- validate a UUID withdrawal ID before calling the RPC;
- normalize whitespace before submitting;
- return a generic error on unexpected exceptions and log only the exception class/name;
- retain the rule that only a database response with `success: true` is reported as approved.

The review/reject route already validates UUID shape, rejects support administrators, checks RPC success responses and returns generic unexpected errors.

## Step 12 source files

New/updated:
- `src/app/api/user/banned-withdrawal/route.ts` — explicitly disabled unverified final payout.
- `src/app/api/withdraw/route.ts` and `src/app/api/wallet/withdraw/route.ts` — generic unexpected error responses.
- `src/app/api/admin/withdrawals/approve/route.ts` — UUID validation and generic exception response.
- `supabase/migrations/20261120223000_step_12_harden_withdrawal_admin_actor_identity.sql` — active full-admin identity guard for approval/refund RPCs.
- `tests/step-12-withdrawal-entrypoint-safety.test.ts` — source contract assertions for normal routes, idempotency, restricted-account fail-closed behavior, admin checks, legacy route retirement and worker caps.
- `docs/audits/wayones-step-12-withdrawal-entrypoint-safety-20261120.md`
- `docs/AUTONOMOUS-PROGRESS.md`

## Verification and limitations

- Read-only production checks confirmed control switches, RPC signatures/grants, active queue counts and legacy final-withdrawal RPC grants.
- Production settings still prevent withdrawals: `withdrawals_enabled=false`, `global_kill_switch_active=true`, `prevent_withdrawals=true`, `emergency_mode=false`.
- The current replay lookup is absent and its source migration is not recorded/applied.
- The admin identity migration is source-only and has not been applied.
- Automated tests were added but **not executed**.
- No customer withdrawal, balance reservation, refund, ledger entry, worker dispatch or blockchain broadcast occurred.
- No production DDL or configuration change, merge, deployment or paid resource was used.
- Existing local Desktop Commander uncommitted wallet/withdrawal changes were preserved.

## Step 12 completion status

| Item | Status |
|---|---|
| Normal customer withdrawal API routes compared | Complete — one canonical service |
| Idempotency key persistence/replay flow reviewed | Complete — replay RPC missing in prod |
| Live reservation RPC and grants inspected | Complete — service-role-only |
| Production withdrawal control switches recorded | Complete — all disable switches preserved |
| Restricted-account final withdrawal path | Source now explicitly fails closed |
| Admin approval/rejection API checks reviewed | Complete |
| Database admin actor hardening migration | Prepared; not applied |
| Admin approval route UUID/error hardening | Prepared |
| Worker/legacy dispatch routes reviewed | Complete — direct legacy routes retired |
| Static regression tests | Added; not executed |
| Production replay migration deployment | Pending migration history reconciliation |
| Receipt/lease/finality DB alignment | Pending Step 8 dependencies |
| Withdrawal enablement | Explicitly not performed |

**Step 12 is not signed off.** The production system is deliberately paused by platform kill switches, the replay lookup is missing, and the worker receipt/lease/finality contract is not yet aligned. Keep `withdrawals_enabled=false`, `global_kill_switch_active=true`, and `prevent_withdrawals=true`. Production remains **NOT READY**.
