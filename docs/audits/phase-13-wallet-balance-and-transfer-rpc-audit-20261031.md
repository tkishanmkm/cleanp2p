# Phase 13 — Wallet Balance and Transfer RPC Audit
Date: 2026-10-31
Scope: authenticated wallet balance API, internal transfer RPC, P2P escrow RPC, financial fee configuration.

## Findings

### 1. Wallet balance semantics corrected locally
The production `public.wallet_assets` schema contains `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, and `in_withdrawal`; it does not contain the newer `available` / `locked_withdrawal` aliases. The live escrow and withdrawal RPCs reduce `wallet_assets.balance` when moving funds into `in_escrow` / `in_withdrawal`, so `balance` is already the spendable remainder.

The singular `/api/wallet/balance` route previously subtracted escrow and withdrawal liabilities from `balance` again, ignored the deployed `in_withdrawal` column, and subtracted active escrow a second time in its final reconciliation loop. The route now uses `src/lib/wallet-balance-normalization.ts` to preserve the spendable balance, read both deployed and legacy liability aliases, and build total as spendable + escrow + withdrawal. Active-trade escrow fallback can raise the displayed escrow liability without reducing spendable balance again.

The route already authenticated with `supabase.auth.getUser()`, rejected a mismatched client-supplied user ID, and only then constructed the service-role client. This identity ordering was retained.

Production `wallet_assets` currently contains zero rows; duplicate user/asset groups and negative amount rows were also zero. The balance fix is therefore backed by the deployed RPC semantics and schema metadata, but could not be numerically compared against a populated production wallet row.

### 2. Internal transfer contract drift
Production `execute_internal_transfer(uuid,text,text,numeric,text)` is service-role-only, but its deployed body still has a hardcoded 1.5% fee model: the amount entered by the user is treated as the sender's total debit, and the recipient receives the amount less the fee. The current API and receipt validator instead treat the entered amount as the recipient amount and expect the sender to pay amount + configured fee. The deployed replay response also lacks fields required by the current validator.

Production `app_settings` has no rows for `platform_fee_percent`, `escrow_fee_percent`, or `min_trade_amount`. The current API therefore fails closed when it cannot load the fee configuration. The local `20261031130000_reconcile_financial_settings_contract.sql` migration inserts defaults with `ON CONFLICT DO NOTHING`, preserving existing values, while `20261031150000_configure_transfer_and_escrow_fees.sql` rewrites the financial RPCs to use the configured values and align replay/receipt fields.

### 3. SECURITY DEFINER escrow RPC hardening
Production `initiate_trade_with_escrow` is SECURITY DEFINER, executable by `authenticated` and `service_role`, and configured with `search_path = public, pg_temp`. Its legacy identity branch accepts `p_caller_id` whenever `auth.uid()` is null, even when the role is not `service_role`.

The local fee migration was tightened so both rewritten financial SECURITY DEFINER functions use `search_path = pg_catalog`. It also requires a non-null session UID matching `p_sender_id` for non-service transfer callers, and explicitly separates escrow identity handling: service-role execution requires a trusted server-provided caller ID; non-service execution requires a valid session UID and rejects any mismatched supplied caller ID.

## Local changes
- `src/lib/wallet-balance-normalization.ts` — canonical spendable + reserved balance normalization.
- `src/app/api/wallet/balance/route.ts` — uses the normalizer for primary `wallet_assets` records and avoids duplicate escrow subtraction.
- `supabase/migrations/20261031150000_configure_transfer_and_escrow_fees.sql` — adds stricter dynamic rewrite guards, safe search paths, and caller identity enforcement before applying configured financial fee logic.
- `tests/wallet-balance-available-normalization.test.mjs` — tests primary wallet balance semantics and route integration.
- `tests/financial-rpc-search-path-hardening.test.mjs` — checks SECURITY DEFINER search path and actor identity guards.
- `tests/configurable-transfer-escrow-fees.test.mjs` — expanded fee / receipt / security assertions.

## Validation
- 46 focused Node tests passed, 0 failed.
- `npm run typecheck` passed.
- Migration version scan: 176 files, 176 unique valid prefixes.
- `git diff --check` passed (only line-ending normalization warnings).

The SQL migration tests are static contract checks. The dynamic PostgreSQL function rewrite still requires rehearsal on an isolated PostgreSQL database built from the actual deployed function definitions and compatible schema before any deployment.

## Production blockers / rollout gates
1. Production is missing the fee configuration rows and still runs the older transfer fee / replay contract.
2. The October 31 candidate migrations have not been applied to production or staging. Staging does not currently provide a populated schema baseline for a reliable replay.
3. The financial dynamic rewrite, including the new SECURITY DEFINER guards and fee behavior, must be rehearsed against a schema-faithful disposable database before deployment.
4. The wallet table currently has zero production rows, so live-row display verification must be repeated once a safe test account/wallet fixture exists.

## Change control
Production and staging were queried read-only. No SQL migration was applied. No commit, push, merge, deployment, paid resource, or GitHub Actions workflow was created.
