# WAYONES Production Audit — Step 10
**Title:** Canonical P2P trade creation, escrow settlement, paid marking, disputes, cancellation and expiry  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Free-tier tools/resources only  
**Scope:** Trade creation/idempotency, ad locking, caller eligibility, escrow release/cancel, buyer paid state, admin paid/dispute wrappers, expiry workers, legacy escrow RPC retirement, SECURITY DEFINER search paths  
**Financial activity:** Read-only catalog/source inspection. No trade, escrow, wallet, balance, dispute, withdrawal, sweep or blockchain state was mutated.

## Executive status

**Step 10 is partially remediated in source control; production trade/admin integration remains incomplete.** The live database has the canonical participant/state-machine RPCs, with service-role-only ACLs for paid/release/cancel/dispute transitions and empty search paths on those critical functions. However, the deployed trade-creation function predates the newer replay/ad-lock hardening, and the administrative mark-paid/dispute wrapper functions expected by current routes are absent. Several privileged legacy admin/escrow functions are still installed. No Step 10 production DDL was applied.

The production migration history contains 139 entries versus 336 versioned migration files in the repository. A bulk migration push was not attempted.

## Production findings

### W10-01 — Canonical trade creation does not enforce the latest replay/ad-lock invariants
**Severity: High — trade idempotency, account eligibility and ad-state race**

Live `public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)` is PostgreSQL-owned `SECURITY DEFINER`, has an empty search path, is executable by authenticated and service_role, and is not executable by anon. The source and database function bind the supplied caller identity to the verified Auth identity (or the explicit trusted service-role path). The function has important existing account, wallet, escrow and row-lock checks.

But the exact live function body is the older contract expected by the repository migration `20261108162000_harden_trade_escrow_replay_and_ad_lock.sql`:
- It contains the old `IF v_clean_idempotency IS NULL THEN` check; there is no database-side 200-character limit on the cleaned idempotency key.
- Its account-eligibility check occurs in the new-trade path, not before the idempotency lookup/replay response. A previously eligible account could become suspended/restricted/on-hold/frozen and still receive an idempotent replay response for an old key.
- Its advertisement lookup matches internal ID, `public_id`, or `public_ad_id` with a single unordered `LIMIT 1`; the live lookup does not include `FOR UPDATE`. A concurrent ad status/content change can race that lookup.
- Its replay-price condition rejects only when both stored price fields differ from the requested price. If one stored field matches while the other conflicts, the old predicate can permit an inconsistent replay.

Read-only live preflight confirmed:
- Exactly one strict idempotency marker and one old null-only key check.
- Exactly two old caller/counterparty account-eligibility anchors.
- The exact old unlocked advertisement lookup fragment occurs once; the old locked variant does not.
- The prior replay-price condition is present.
- The required profile columns (`is_banned`, `is_restricted`, `is_on_hold`, `is_suspended`, `is_minor_restricted`, `is_emergency_frozen`, `status`, `account_status`) and the ad identifier/price columns exist.

**Prepared source correction:** `20261108162000_harden_trade_escrow_replay_and_ad_lock.sql` is already in the repository. It inserts the account eligibility gate before idempotency lookup, caps the cleaned key at 200 characters, changes the ad lookup to deterministic internal-ID/public-ID ordering with `FOR UPDATE`, and enforces strict replay price consistency. Its guarded source migration explicitly accepts the exact unlocked lookup currently present in production and replaces it with the ordered locked lookup. It is not recorded as applied in the live migration history and was not applied in this pass.

This is a database-side invariant gap, not evidence of an anonymous/user-ID spoofing path. The Auth identity boundary is present; the newer replay/ad locking rules are missing.

### W10-02 — Administrative mark-paid wrapper is absent while the admin route calls it
**Severity: High — admin payment workflow fails closed**

Production has the canonical `mark_p2p_trade_paid(uuid,uuid,text)` RPC, owned by postgres, SECURITY DEFINER, empty search path, service_role-only EXECUTE. The current administrator route `src/app/api/admin/trades/[tradeId]/route.ts` calls `admin_mark_trade_paid_authorized`, which is absent in production.

The repository source migration `20261107230000_restore_admin_mark_paid_authorized_rpc.sql` creates a service-only wrapper that:
- binds the supplied actor to the verified Auth identity;
- verifies `is_active_admin_identity(p_actor_id)`;
- delegates to the canonical participant paid-state RPC;
- inserts the mandatory admin audit row in the same transaction.

Production has the needed `is_active_admin_identity(uuid)` helper and the reviewed admin audit columns, but the wrapper itself is not installed. The admin mark-paid route therefore cannot complete its current wrapper call until the migration is deployed. The ordinary buyer-paid route still calls the canonical service-only RPC through an authenticated server handler.

### W10-03 — Atomic admin dispute wrapper and full-admin identity helper are absent
**Severity: Critical for dispute-resolution availability and authorization**

The current source helper `src/lib/admin-dispute-settlement.ts` calls `admin_resolve_trade_dispute_atomic`. The helper deliberately returns `DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED` unless `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED=true`; it must remain disabled until the database wrapper and its concurrency/authorization tests are deployed and verified.

Production has:
- the inner `resolve_trade_dispute(uuid,text,uuid,uuid)` resolver, service_role-only and SECURITY DEFINER with an empty search path;
- `is_active_admin_identity(uuid)`, postgres-owned SECURITY DEFINER with an empty search path.

Production does **not** have:
- `admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)`;
- `is_active_full_admin_actor(uuid)).

The generic active-admin identity predicate is not equivalent to the full-admin actor predicate. The latter checks the verified full administrator identity, account status and restrictions used for privileged dispute settlement.

The source dependency chain is:
1. `20261108033000_restore_support_admin_emergency_contracts.sql` defines `is_active_full_admin_actor(uuid)` as an internal postgres-only predicate. Its current version derives full-admin eligibility through `verify_admin_login` and checks active/unrestricted profile state.
2. `20261108043000_restore_atomic_admin_dispute_settlement.sql` explicitly refuses to install if either the canonical resolver or `is_active_full_admin_actor(uuid)` is missing. It installs the server-only atomic dispute wrapper, locks the dispute/trade, verifies the winner and active full-admin actor, applies canonical settlement, and records a mandatory audit row in the same transaction.

Earlier source migration `20261106040000_install_atomic_admin_dispute_settlement.sql` is an intermediate wrapper version; the later restoration migration also preflights the full-admin predicate. Do not enable the app feature flag until the full-admin helper and final wrapper are installed and isolated positive/negative/concurrency tests pass.

### W10-04 — Obsolete privileged admin escrow functions remain executable by service_role
**Severity: High — dormant legacy server mutation surface**

The following old SECURITY DEFINER RPCs remain in production:
- `admin_release_escrow(character varying,uuid,text)` — service_role EXECUTE is true;
- `admin_resolve_dispute(uuid,uuid,text,text)` — service_role EXECUTE is true;
- `admin_refund_escrow(character varying,uuid,text)` — service_role EXECUTE is already false.

These are not executable by anon or authenticated roles. The current source tree has no call sites for the two still-service-executable functions. Their old bodies rely on legacy admin/profile flags and legacy trade/wallet schema paths rather than the canonical active-admin/ledger settlement flow. This is a privileged legacy surface, not a demonstrated user-facing exploit.

Source migration `20261106030000_retire_legacy_admin_escrow_rpcs_and_harden_expiry_search_path.sql` revokes all execution on these old admin escrow RPCs, and also empties the search paths of `cancel_expired_p2p_trades()` and `expire_p2p_trade(uuid)`. It is not recorded as applied in production.

### W10-05 — Additional legacy trade escrow RPCs remain server-executable
**Severity: High — retired-code/financial consistency risk**

The following obsolete functions are still present and service_role-executable:
- `cancel_trade_and_release_escrow(uuid,text)`;
- `refund_trade_escrow_to_seller(uuid,uuid,text)`;
- `complete_trade(uuid)`.

Their implementations use older wallet/escrow/ledger assumptions and are not referenced by current `src` call sites. The active application uses `release_trade_escrow`, `cancel_p2p_trade`, and the current dispute resolver after user/admin authentication. Legacy execution is server-only, but leaving old mutation functions available to a compromised/misconfigured service-role caller is unnecessary.

Source migration `20261107200000_retire_legacy_trade_escrow_mutation_rpcs.sql` revokes service/client execution and leaves the legacy functions callable only by postgres. It refuses to run until the atomic admin dispute wrapper and canonical resolver grants are present, and refuses if an installed database function still calls a retiring function. The production wrapper dependency is currently absent, so the retirement migration must remain ordered after the wrapper installation and cannot be applied independently.

### W10-06 — Trade SECURITY DEFINER search paths remain mutable on expiry/helpers/triggers
**Severity: Medium — database object-shadowing hardening**

The canonical high-value trade transitions already inspected use empty `search_path`:
- `initiate_trade_with_escrow`;
- `mark_p2p_trade_paid`;
- `release_trade_escrow`;
- `cancel_p2p_trade`;
- `resolve_trade_dispute`.

Other schema-qualified SECURITY DEFINER trade dependencies still use `search_path=public, pg_temp`:
- `initiate_p2p_trade(...)` (service-role-only wrapper);
- `fn_update_user_trade_metrics()`;
- `handle_trade_status_sync()`;
- `handle_trade_volume_update()`;
- `prevent_usd_value_at_trade_update()`;
- `expire_p2p_trade(uuid)`;
- `cancel_expired_p2p_trades()`;
- plus trade dependency helpers `get_user_kyc_tier(uuid)`, `get_user_cumulative_buy_volume(uuid)`, and `has_pending_withdrawal_approval(uuid)`.

The existing source migration `20261108180000_empty_trade_dependency_search_paths.sql` guards and hardens the five dependency/expiry helpers. This Step 10 branch adds:
`20261120194500_step_10_empty_remaining_trade_search_paths.sql`

It targets the remaining five schema-qualified wrappers/trigger functions only after checking PostgreSQL ownership, SECURITY DEFINER mode, exact old path, expected source fragments, absence of PUBLIC/anon/authenticated EXECUTE and unchanged service-role access. It then changes only `search_path` and verifies that source, owner, SECURITY DEFINER mode and ACL are unchanged. This new migration is source-only and has not been applied.

### W10-07 — Current canonical transition functions remain server-mediated
**Severity: Reviewed — no direct browser execution path found**

Live canonical function posture:
| RPC | SECURITY DEFINER path | anon | authenticated | service_role |
|---|---|---:|---:|---:|
| `initiate_trade_with_escrow` | empty | No | Yes (caller identity bound) | Yes |
| `mark_p2p_trade_paid` | empty | No | No | Yes |
| `release_trade_escrow` | empty | No | No | Yes |
| `cancel_p2p_trade` | empty | No | No | Yes |
| `resolve_trade_dispute` | empty | No | No | Yes |

The service-only transitions use row locks and actor binding/active-admin checks as appropriate. Current source API handlers authenticate the buyer/seller/admin before using the service-role client; the current workers use canonical expiry RPCs rather than direct `trades` updates. The source search found no current call sites for the obsolete `admin_release_escrow`, `admin_resolve_dispute`, `cancel_trade_and_release_escrow`, `refund_trade_escrow_to_seller`, or `complete_trade` functions.

## Production table state

At read-only inspection, the following tables contained zero rows:
- `trades`
- `p2p_trades`
- `p2p_orders`
- `escrow_ledger`
- `disputes`
- `wallet_assets`

No active trade, dispute or escrow row was changed.

## Source changes on the Step 10 branch

- `supabase/migrations/20261120194500_step_10_empty_remaining_trade_search_paths.sql`
  - Empty search_path for five remaining trade SECDEF helper/wrapper functions.
  - Guarded owner/path/source/ACL preconditions and postconditions.
- `tests/step-10-trade-escrow-state-machine.test.ts`
  - Checks replay/account/ad locking source contract; search-path migrations; legacy RPC retirement; full-admin helper dependency; admin mark-paid/dispute wrapper requirements; and current canonical API RPC callsites.
- `docs/audits/wayones-step-10-trade-escrow-state-machine-20261120.md`
- `docs/AUTONOMOUS-PROGRESS.md`

The repository already contains the remaining business-logic and wrapper migrations identified above. No duplicate business-logic patch was created in this step.

## Verification and limitations

- `paxonesflows` was inspected read-only. The production migration history remains 139 rows vs 336 repository migration files; no bulk migration push was attempted.
- Live RPC definitions, owners, SECURITY DEFINER flags, search paths, grants, policy/trigger dependencies and relevant profile/ad schema columns were compared.
- The exact preflight fragments for `20261108162000_harden_trade_escrow_replay_and_ad_lock.sql` match the live function: the old unlocked ad lookup occurs once, old key check once, idempotency marker once, and the caller/counterparty account guard anchor twice; the required profile/ad columns exist.
- The full-admin helper and admin wrapper absence were verified with `to_regprocedure`; their source dependency chain was reviewed.
- Automated tests were added but **not executed** in this pass.
- No Step 10 production DDL was applied. No trade, escrow, balance, wallet, dispute, ledger or blockchain state was changed.
- No merge, deployment or paid-tier resource was used. Local Desktop Commander worktree was not reset/cleaned/stashed; all pre-existing uncommitted wallet/withdrawal changes remain untouched.

## Step 10 completion

| Item | Status |
|---|---|
| Canonical participant RPCs and grants inspected | Complete |
| Initiation replay/ad-lock drift identified | Complete |
| Existing guarded replay-hardening migration verified against current schema/body | Complete — not applied |
| Admin mark-paid wrapper absence and source fix identified | Complete — not applied |
| Full-admin actor helper and dispute wrapper dependency identified | Complete — not applied |
| Legacy admin and escrow RPCs identified for retirement | Complete — no active app call sites found |
| Existing expiry/helper search-path migration reviewed | Complete — not applied |
| Additional trade helper search-path migration authored | Prepared — not applied |
| Step 10 static contract test | Added — not executed |
| Isolated schema replay and positive/negative/concurrency trade tests | Pending |
| Production migration replay/deployment | Pending migration-history reconciliation |

**Step 10 is not signed off.** The database is not yet aligned with the current trade/admin route contracts. Keep the atomic dispute feature gate disabled. Apply the existing source migrations only in a schema-matched isolated environment in dependency order; do not use a production bulk push. Production remains **NOT READY**.
