# WAYONES Production Audit — Step 11
**Title:** Wallet buckets, ledger reconciliation, platform liabilities, reserve visibility and admin adjustment contract  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Existing free-tier tools/resources only  
**Scope:** `wallet_assets` canonical accounting, ledger snapshots, reserve/escrow/withdrawal buckets, customer/admin wallet APIs, realtime/UI consumers, multi-chain USDT reserves, alert reconciliation, manual adjustment RPCs  
**Financial activity:** Read-only production inspection. No balances, ledger, alerts, wallet rows or blockchain state were modified.

## Executive status

**Step 11 source remediation is prepared but production is not reconciled or ready.** The work found a missing scheduled reconciliation RPC and alert deduplication schema, a broken legacy admin-adjustment ledger type, missing database bucket constraints, an API/SQL RPC-name mismatch for admin adjustments, and several customer/admin wallet views using outdated balance semantics.

The live database contains no wallet or ledger rows at the time of inspection. Therefore the new accounting comparisons and constraints are source-reviewed but not validated against populated account fixtures. The production migration history remains out of sync (139 recorded entries versus 336 migration files in the repository); no bulk migration push was attempted.

## Live production evidence (aggregate only)

| Item | Read-only result |
|---|---:|
| `wallets` rows | 0 |
| `wallet_assets` rows | 0 |
| `ledger_entries` rows | 0 |
| Wallet buckets with negative/non-finite values | 0 |
| `locked_balance` / `reserved_balance` mirror mismatches | 0 |
| Ledger rows outside the existing five allowed event types | 0 |
| `system_alerts` rows | 281 |
| Unresolved `system_alerts` rows | 281 |
| `system_reconciliations` snapshots | 281 |
| Latest reconciliation snapshot | 2026-10-05 12:00:34 UTC |

The 281 historical alerts and 281 reconciliation snapshots were left unchanged. No row IDs, account IDs, addresses or transaction hashes are included in this report.

## W11-01 — Scheduled reconciliation worker cannot call its database aggregate
**Severity: Critical — current reconciliation job fails closed**

The existing worker in `src/jobs/reconciliationWorker.ts` is scheduled every 15 minutes by `src/worker.ts`. It calls:
`public.get_withdrawal_reconciliation_totals(text)`.

Read-only production catalog inspection found that exact function signature is missing. Its source migration, `20261106115041_withdrawal_reconciliation_canonical_aggregation.sql`, exists in the repository but is not recorded in the live migration history.

The worker intentionally throws before comparing reserves when the RPC is missing or returns anything other than one exact totals row. This is the correct fail-closed behavior, but it means no new reconciliation snapshots can be generated until the migration is applied in the correct order. The latest production snapshot is 2026-10-05.

The source migration:
- requires service_role;
- uses an empty search path;
- checks non-negative canonical wallet buckets and the locked/reserved mirror;
- returns exact NUMERIC liability and pending-withdrawal strings;
- counts the mirrored reserve bucket once, not twice.

## W11-02 — Scheduled and manual reserve checks omitted TRC20
**Severity: High — multi-chain USDT collateral could be understated**

The scheduled reconciliation worker originally checked ERC20 and BEP20 only. USDT balances also exist on TRON/TRC20, which has a separate hot-wallet address and contract. A reserve comparison that omits TRC20 can understate reserves.

The manual reconciliation helper also used a static-network provider check through `getNetwork()`, which can report the configured chain rather than the remote RPC's actual chain.

**Source changes:**
- The scheduled worker now verifies the remote EVM chain via `provider.send('eth_chainId', [])` for both gas and token reserve reads.
- It reads the TRC20 USDT balance through `getTronWeb(false)`, validates the configured public TRON address and uses `TRON_CONFIG.usdtContract` and token decimals.
- It refuses to claim a completed reconciliation when the TRON address or RPC read is unavailable.
- The manual helper now requires all three reserve networks (ERC20, BEP20, TRC20), uses `getTronWeb(false)`, and verifies the remote EVM chain with raw `eth_chainId`.
- Reconciliation no longer derives the EVM hot-wallet public address by loading a private key; it uses configured public-address environment variables only.

No private key, signer or broadcast operation is used by either read-only reconciliation path.

## W11-03 — Low-gas monitor treated RPC errors as a zero wallet balance
**Severity: Medium — false low-gas alerting**

Previously, an EVM native-gas RPC failure was represented as `nativeBalance: '0.0'` and `isSufficient: false`. The alert loop then emitted a LOW_GAS warning, even though it had no verified balance.

The scheduled worker now differentiates:
- `ONLINE`: a valid native balance and an actual below/above-threshold result;
- `UNAVAILABLE`: RPC or chain verification failed and no low-gas conclusion was made.

Only an online, verified below-threshold balance generates `LOW_GAS`. An unavailable balance generates a `WORKER_ERROR` monitoring alert. This does not add TRON native TRX gas monitoring; that remains a separate follow-up item.

## W11-04 — Historical active alerts lacked deduplication storage
**Severity: Medium — repeated alert volume and noisy operations**

Production `system_alerts` has no `dedupe_key` column and no active-alert partial unique index. The existing worker already attempted to write `dedupe_key`, so the schema and worker contract are mismatched.

Added source migration:
`20261024160000_system_alert_active_deduplication.sql`
- adds nullable `dedupe_key`;
- adds a unique partial index for unresolved rows with a non-null key;
- does not delete, resolve or rewrite the 281 old alerts.

The worker now looks for an existing unresolved row by alert type/title before inserting a keyed row. The partial index remains the final concurrency guard after the migration is applied. Old unresolved alerts remain unchanged and will not be duplicated by the first post-migration run with the same title.

## W11-05 — Reconciliation helper queried a schema that does not exist in production
**Severity: High — manual reconciliation route failed against canonical tables**

The manual service previously queried assumed columns such as `wallet_id`, `asset_code`, `available`, `locked_escrow`, `locked_withdrawal`, `delta_available` and `delta_locked`.

Production's canonical schema is:
- `wallet_assets`: `user_id`, `asset_symbol`, `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, `in_withdrawal`;
- `ledger_entries`: `user_id`, `asset`, `crypto`, `amount`, `type`, `balance_after`, `created_at`.

The manual service now pages over the actual columns and compares each canonical `wallet_assets.balance` to the latest matching `ledger_entries.balance_after` snapshot for the same user and asset. It does not sum transaction amounts, because deposits, withdrawals, transfers, fees and escrow movements have different direction/status semantics.

The pure comparison helper:
- uses exact BigInt fixed-point arithmetic;
- handles finite decimal/scientific notation within supported precision;
- flags negative balances and invalid buckets;
- flags a missing positive wallet ledger snapshot and non-zero orphan ledger snapshots;
- reports equal-timestamp/different-value ledger snapshots as ambiguous rather than guessing UUID order;
- requires exact balance snapshot equality (zero tolerance).

It calculates USDT liabilities as:
`balance + reserved_balance + in_escrow + in_withdrawal`.

The live BEFORE trigger mirrors `locked_balance` and `reserved_balance`. The helper therefore counts the reserve pair once, not twice. Escrow and withdrawal amounts have already been moved out of the spendable balance and remain separate platform liabilities.

## W11-06 — Wallet bucket integrity had no database CHECK constraints
**Severity: High — service-role writes lacked independent bucket invariants**

Production `wallet_assets` has a unique (user, asset) key and a BEFORE trigger to synchronize reserved/locked values, but no CHECK constraints preventing negative or non-finite balances or enforcing the mirror.

Added guarded migration:
`20261120213000_step_11_enforce_wallet_bucket_invariants.sql`

It:
- requires the reviewed `wallet_assets` table and active `trg_sync_wallet_assets_balance` trigger;
- verifies the PostgreSQL-owned, invoker-mode trigger function matches the reviewed body;
- aborts if any existing row has a negative/non-finite bucket or reserve mirror mismatch;
- adds five finite, non-negative bucket constraints for `balance`, `locked_balance`, `reserved_balance`, `in_escrow` and `in_withdrawal`;
- adds a sixth constraint requiring `COALESCE(locked_balance,0)=reserved_balance`;
- preserves historical NULL-as-zero semantics for nullable buckets;
- changes the mirror trigger function to an empty search path while preserving its body, owner, invoker mode and ACL.

Read-only production preflight returned zero existing wallet rows and zero invalid/mismatched rows. The migration has not been applied.

## W11-07 — Admin adjustment event types violate the ledger CHECK constraint
**Severity: High — privileged manual adjustments would roll back**

The live `ledger_entries_type_check` allows only `deposit`, `withdrawal`, `withdrawal_pending`, `transfer` and `fee`.

The legacy `admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)` function writes `admin_add` and `admin_subtract`. An adjustment that reaches the ledger insert would violate the CHECK and roll back the transaction.

The live function is PostgreSQL-owned, SECURITY DEFINER, empty search path and executable only by service_role. Its old admin identity query checks profile/admin flags directly rather than the canonical active-admin helper.

Added guarded migration:
`20261120201500_step_11_repair_admin_wallet_adjustment_ledger_contract.sql`

It:
- checks the exact signature, owner, SECURITY DEFINER mode, empty path and service-only grant;
- checks the exact legacy function source fragments and current ledger type constraint;
- aborts if any existing ledger row has an unrecognized type;
- replaces only the reviewed admin identity query with `public.is_active_admin_identity(p_admin_id)`;
- adds `admin_add` and `admin_subtract` to the ledger type constraint;
- verifies body, owner, security mode, search path and ACL are preserved.

No production change was applied.

## W11-08 — Admin adjustment API RPC name differs from the deployed/source legacy function
**Severity: Critical for admin adjustment availability; currently fail-closed**

The current `src/lib/admin-balance-adjustment.ts` caller invokes:
`admin_adjust_balance_atomic(uuid,uuid,text,text,numeric,text,uuid)`.

Production has only the older:
`admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)`.

The current caller has `PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED` disabled by default and returns 503 before making an RPC call. The user-level admin balance route also rejects support administrators before invoking the helper. No admin balance adjustment was attempted.

Added a guarded source migration:
`20261120220000_step_11_restore_atomic_admin_balance_api_rpc.sql`

It creates the exact service-role-only RPC expected by the current helper. It wraps the repaired inner atomic function, converts the request UUID into the inner idempotency-key format, and returns `audit_logged: true` only after the inner function has completed its atomic balance/ledger/audit/notification transaction. Preconditions require the inner helper to be repaired, the active-admin identity function to be secure, and the ledger event types to be enabled. It refuses an unexpected pre-existing wrapper.

The application feature flag remains OFF. The wrapper was not applied or enabled in production.

## W11-09 — Wallet API/UI consumers used obsolete columns or double-counted held balances
**Severity: High — customer and admin displayed balances could be wrong**

The canonical rule is now consistent across the source changes:
- `wallet_assets.balance` is already spendable; do not subtract held amounts again.
- `reserved_balance` is a distinct hold; `locked_balance` is its mirror.
- `in_escrow` and `in_withdrawal` are separate liabilities.
- Total is `balance + reserved_balance + in_escrow + in_withdrawal`; never add `locked_balance` as a second reserve amount.

Source consumers corrected:
- `src/app/api/wallet/route.ts`: reads only the authenticated user's canonical USDT balance and no longer subtracts held buckets or falls back to legacy wallet tables.
- `src/app/api/wallet/balance/route.ts`: reads only canonical `wallet_assets`, authenticates against `auth.getUser()`, rejects cross-user query IDs and duplicate/invalid/mirror-mismatched assets, and returns spendable/reserved/escrow/withdrawal separately.
- `src/lib/wallet-balance-normalization.ts`: one shared canonical normalizer; legacy NULL buckets match the database's `COALESCE(bucket,0)` rule.
- `src/context/wallet-context.tsx`: adds reserved to the wallet data model and portfolio total; available remains separate for spend/withdraw checks.
- `src/hooks/useRealtimeWallets.ts` and `src/components/wallets/WalletBalances.tsx`: read the real schema columns and display held values from the canonical buckets.
- `src/lib/wallet.ts`: uses only the canonical authenticated balance endpoint; no legacy table max-merge.
- `src/lib/supabase/db.ts`: shared wallet helper uses `user_id/asset_symbol/balance/locked_balance/reserved_balance/in_escrow/in_withdrawal`.
- `src/app/(dashboard)/wallets/page.tsx`: removes direct legacy balance fallbacks and refreshes validated server balances on realtime events.
- `src/app/(dashboard)/my-ads/page.tsx` and `src/app/api/p2p/my-ads/route.ts`: use the server's canonical spendable balance only; the route validates bucket consistency and duplicate asset rows. Cached context and ad-published balances cannot override it.
- `src/app/api/admin/wallets/route.ts` and `src/app/api/admin/metrics/route.ts`: include the reserved bucket in total liabilities and reject reserve-mirror drift.
- `src/app/api/admin/users/route.ts` and `src/app/api/admin/users/[userId]/route.ts`: report reserved, escrow and withdrawal separately; fail closed on invalid buckets.
- `src/app/adminnarayan/wallets/page.tsx`: displays reserved separately and includes it once in totals.

Existing source migration `20261105320000_restrict_financial_table_dml.sql` revokes direct browser DML on financial wallet tables and retains authenticated reads. It is not recorded as applied in production. The live table ACLs therefore remain broader than the least-privilege target, although RLS had no direct browser mutation policies in the reviewed state.

## Step 11 source files/migrations/tests

Key new files:
- `src/lib/security/wallet-ledger-reconciliation.ts`
- `src/lib/wallet-balance-normalization.ts`
- `supabase/migrations/20261024160000_system_alert_active_deduplication.sql`
- `supabase/migrations/20261120201500_step_11_repair_admin_wallet_adjustment_ledger_contract.sql`
- `supabase/migrations/20261120213000_step_11_enforce_wallet_bucket_invariants.sql`
- `supabase/migrations/20261120220000_step_11_restore_atomic_admin_balance_api_rpc.sql`
- `tests/wallet-ledger-reconciliation.test.ts`
- `tests/wallet-balance-normalization.test.ts`
- `tests/step-11-wallet-ledger-contract.test.ts`

Existing migrations and workers updated:
- `supabase/migrations/20261105320000_restrict_financial_table_dml.sql` (preserve legacy participant SELECT while revoking browser DML);
- `supabase/migrations/20261120193000_step_09_harden_legacy_p2p_and_admin_snapshot_rls.sql` (compatible with earlier ordered DML revocation);
- `src/jobs/reconciliationWorker.ts`;
- `src/lib/security/reconciliation.ts`;
- customer wallet APIs, admin wallet APIs and shared wallet consumers listed above.

## Verification, limitations and deployment order

- Production Supabase inspection was read-only.
- Rechecked zero wallet/ledger rows, zero current bucket violations, zero locked/reserved mirror mismatches and zero out-of-contract ledger event rows.
- Confirmed `get_withdrawal_reconciliation_totals(text)` and `system_alerts.dedupe_key` are absent in production.
- Confirmed the old admin adjustment function exists and is service-role-only; the API wrapper expected by source is absent. The application feature flag remains OFF.
- Static tests were added but were **not executed**, per the requested code/SQL-first sequence.
- No production migration, balance adjustment, alert cleanup, reconciliation snapshot insertion, wallet creation, deposit, withdrawal, sweep, transfer or blockchain transaction was performed.
- No paid-tier resources, merge or deployment were used.
- Local Desktop Commander worktree was not reset, cleaned, stashed or overwritten. Existing unrelated uncommitted wallet/withdrawal changes were preserved.

Recommended isolated replay/deployment order after schema-history reconciliation:
1. `20261024160000_system_alert_active_deduplication.sql`;
2. `20261105320000_restrict_financial_table_dml.sql` (with the updated participant-read preservation);
3. `20261106115041_withdrawal_reconciliation_canonical_aggregation.sql`;
4. `20261107160000_restrict_legacy_financial_mutation_helpers.sql`;
5. Step 9/10 guarded migrations in timestamp/dependency order;
6. `20261120201500_step_11_repair_admin_wallet_adjustment_ledger_contract.sql`;
7. `20261120213000_step_11_enforce_wallet_bucket_invariants.sql`;
8. `20261120220000_step_11_restore_atomic_admin_balance_api_rpc.sql`.

Do not enable `PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED` until a schema-matched isolated PostgreSQL replay, idempotency tests, audit-row transaction tests, admin/support role authorization tests and negative-balance tests pass.

## Step 11 completion status

| Item | Status |
|---|---|
| Live wallet/ledger schema and RLS/grants inspected | Complete |
| Live wallet and ledger aggregate state captured | Complete — zero rows |
| Canonical accounting bucket semantics verified from RPC bodies/triggers | Complete |
| Manual reconciliation code aligned to live columns and latest ledger snapshots | Source prepared |
| Scheduled reconciliation extended to TRC20 and raw EVM chain ID verification | Source prepared |
| RPC outage separated from low-gas alert | Source prepared |
| Alert deduplication schema and worker behavior restored | Source prepared |
| Wallet bucket database constraints | SQL prepared; not applied |
| Admin adjustment ledger type/active-admin repair | SQL prepared; not applied |
| Current admin adjustment API RPC wrapper | SQL prepared; feature flag remains OFF |
| Customer/admin/realtime/My Ads consumers aligned | Source prepared |
| Static test coverage | Added; not executed |
| Isolated PostgreSQL replay and populated financial fixtures | Pending |
| Production migration-history reconciliation and deployment | Pending |

**Step 11 is not signed off.** The source changes are ready for draft review, but production's active reconciliation job still lacks its RPC, alert deduplication is absent, wallet constraints are unapplied, and manual admin adjustment remains disabled. Production remains **NOT READY**.
