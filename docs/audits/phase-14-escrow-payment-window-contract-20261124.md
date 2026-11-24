# Phase 14 — Escrow expiry and buyer payment-window contract

Date: 2026-11-24  
Repository: `tkishanmkm/cleanp2p`  
Base commit: `1e455652ce9e8a5f3a6a849c681e7525af51f09f`  
Supabase project inspected read-only: `eaiwgfxoiwxepinvcykg` (`paxonesflow`)  
Change branch: `audit/escrow-payment-window-20261124`

## Scope and safety

This phase was a read-only inspection of the connected Supabase database and current `main` source, followed by a source-only draft change on the branch above. No Supabase schema or data was changed. No payment, refund, wallet mutation, chain signing, broadcast, cron activation, worker activation, Render deployment, or GitHub Actions run was performed.

## Live database findings

### Canonical expiry refund RPC

The connected database contains `public.expire_p2p_trade(uuid)`. The observed function is owned by `postgres`, is `SECURITY DEFINER`, and has an empty `search_path`. Its EXECUTE grants are limited to `postgres` and `service_role`; both `anon` and `authenticated` lack EXECUTE.

The function locks the target `public.trades` row with `FOR UPDATE`, rejects a missing/future `expires_at`, and prevents automatic refunds for a trade with payment timestamps, paid/disputed state, or an open dispute. It rejects completed/released state, treats cancelled/expired replays as terminal success, locks the seller's `public.wallet_assets` row, verifies that the seller's `in_escrow` covers `crypto_amount + escrow_fee`, refunds that full held amount to the seller balance, writes a refund ledger entry, and changes the trade state to expired. The database function repeats the timestamp/state checks while holding the row lock, so a stale route read alone cannot authorize a refund.

The route `src/app/api/trades/[tradeId]/actions/route.ts` had an unconditional 503 response before its call to this canonical RPC. The accompanying comment asserted that the RPC lacked an expiry check and had authenticated execution grants. Those assertions did not match the connected database snapshot.

### Buyer payment RPC

The connected `public.mark_p2p_trade_paid(uuid,uuid,text)` is also owned by `postgres`, is `SECURITY DEFINER`, uses an empty `search_path`, and is executable only by `postgres` and `service_role`. It locks the trade, binds a non-service caller to the buyer, checks terminal/disputed states, and requires locked escrow before changing paid timestamps and status.

**Important unresolved gap:** the live function body does not compare `trades.expires_at` against its transaction timestamp. The two buyer payment routes previously called this RPC without fetching/checking the deadline. A route-level check is useful defense in depth but is not atomic: the deadline could pass between the route read and database transition. A separate reviewed database migration must add the deadline guard inside `mark_p2p_trade_paid` under its existing trade-row lock before this flow is production-ready.

## Expiry scheduling

The database contains one historical cron row named `cancel-expired-p2p-trades-job`, scheduled every five minutes but currently `active = false`. Its command calls `public.auto_cancel_expired_p2p_trades(15)`, which scans the legacy `public.p2p_orders` table and calls the legacy `refund_p2p_escrow` routine. It is not the current `public.trades` / `wallet_assets` expiry path. It must remain inactive; do not reactivate this legacy job as a workaround.

The current `expire_p2p_trade` and `cancel_expired_p2p_trades` RPCs were verified as service-role-only. No current expiry schedule was enabled in this phase.

## Source changes prepared on the draft branch

1. `src/app/api/trades/[tradeId]/actions/route.ts`
   - `MARK_PAID` now rejects missing, invalid, or elapsed `expires_at` values before invoking `mark_p2p_trade_paid`.
   - `EXPIRE_TRADE` now uses strict timestamp parsing and proceeds to the already-verified server-only `expire_p2p_trade` RPC after route-level participant/state/deadline checks. The RPC remains the authoritative lock-and-recheck boundary.
2. `src/app/api/p2p/trade/pay/route.ts`
   - The trade lookup now includes `expires_at`.
   - The buyer route rejects missing, invalid, or elapsed deadlines before invoking `mark_p2p_trade_paid`.
3. `tests/trade-expiry-accounting-fail-closed.test.mjs`
   - Replaced the stale expectation for a permanent 503 with assertions that the valid deadline check precedes the canonical expiry RPC.
4. `tests/trade-payment-window-enforcement.test.mjs`
   - Added static contract assertions for both buyer payment routes.

## Validation and release status

The live database inspection was read-only. Existing server-only RPC grants and the expiry function's locked timestamp/accounting logic were observed directly in the connected database. The source edits and static tests were prepared on a draft branch.

Local execution of the Node test suite, TypeScript check, and production build was **not completed in this phase** because Desktop Commander requests to the connected Windows device remained pending/time-out despite the device showing online. Therefore no test-pass or build-pass claim is made for this branch. The connected project has no user/wallet/trade/ledger test data, so live financial end-to-end verification was not possible in any event.

### Required before merge or production release

- Create the database migration using the repository's normal `supabase migration new` workflow once the PC/CLI is available. Do not invent or blanket-apply a migration from the remote shell.
- Add an atomic `expires_at IS NOT NULL AND expires_at > transaction_timestamp()` (or equivalent consistent transaction-time) guard to `mark_p2p_trade_paid` while the trade row remains locked. Fail with a stable error detail for the expired window.
- Revoke/retain EXECUTE grants exactly as service-role-only for that financial RPC; verify anon/authenticated/service_role privileges after the migration.
- Test before/after-deadline and concurrent pay-versus-expiry transactions against an isolated staging database with disposable fixtures, and verify exactly one terminal outcome and matching ledger/balance effects.
- Run the updated Node contract tests, TypeScript check, worker build, and Next.js build on the Windows worktree.
- Re-run Supabase security/performance advisors and review the full report. Do not enable the inactive legacy cron job or any financial worker.
- Keep the admin dispute settlement RPC fail-closed until its separate migration safety gate is resolved through the approved process.

## Current conclusion

The stale unconditional expiry 503 was inconsistent with the live database implementation and is removed in the draft source branch. Buyer payment deadline checks are added at both route boundaries, but **they are not a substitute for the missing atomic database guard**. This work is not merged, not deployed, and does not make WAYONES launch-ready.
