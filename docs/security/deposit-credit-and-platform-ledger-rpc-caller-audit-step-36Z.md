# Step 36Z — Deposit-credit and platform-ledger RPC boundary audit

Date: 2026-10-14
Branch: `fix/retire-unverified-deposit-entrypoints`
Production Supabase project inspected: `eaiwgfxoiwxepinvcykg` (`paxonesflows`)

## Scope and method

Read-only inspection of the live definitions and effective execute privileges for:
- `public.credit_user_balance(uuid,text,text,numeric)`
- `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

Also searched the connected GitHub repository's default-branch code index for both function names. Those searches returned no results; therefore this step does **not** claim a complete caller inventory for the working branch. The deployed database definitions and effective ACL results below are direct catalog results; no RPC was invoked.

## Effective privilege snapshot

Both functions are `SECURITY DEFINER`.

| Function | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---:|---:|---:|
| `credit_user_balance(uuid,text,text,numeric)` | No | No | Yes |
| `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)` | No | No | Yes |

The credit function has an empty pinned search path (`SET search_path TO ''`) and schema-qualifies its table references. The platform ledger function pins `search_path` to `public, pg_temp`; its table references are schema-qualified. No grants or function definitions were changed.

## Finding A — critical financial trust boundary: `credit_user_balance`

The deployed function accepts a caller-supplied user UUID, asset, network, and numeric amount. Its body:
1. creates a parent `public.wallets` row if none exists;
2. adds `credit_amount` to `public.wallet_assets.available` through an upsert keyed by `(user_id, asset_symbol)`;
3. inserts a `ledger_entries` row with type `deposit` and the resulting balance snapshot; and
4. returns the new balance.

The body does **not** itself establish a verified on-chain deposit, bind the credit to a canonical deposit record/transaction output, require an idempotency key, reject non-positive amounts, or prevent a replay. The ledger insert also omits a deposit reference, so it does not engage the deployed unique partial deposit-reference index. The `target_network` argument is not used in the function body.

Because `service_role` can execute it, any privileged service caller that accepts untrusted inputs or can be replayed could create arbitrary/repeated balance credits. This is a caller-boundary risk, not evidence that an exploit has occurred. Do not revoke it until all legitimate callers and dependencies are identified; do not treat it as a safe deposit-credit primitive.

**Required safe direction:** verified chain evidence and canonical deposit/output idempotency must be validated and credited atomically by a narrow server-only transaction/RPC. Until that replacement and caller inventory are verified, keep legacy/unverified deposit entry points contained and do not restore their privileges.

## Finding B — platform ledger idempotency is useful but incomplete

The deployed `record_platform_ledger_entry` requires a nonblank idempotency key, nonblank entry type/asset, positive amount, and direction in `CREDIT`/ `DEBIT`. It inserts into `platform_ledger_entries` with `ON CONFLICT (idempotency_key) DO NOTHING`, then returns the existing row only when a set of financial fields match.

The conflict comparison checks entry type, asset code, amount, direction, related user, reference table/id, network code, and transaction hash. It does **not** compare `metadata`. Reusing a key with changed metadata therefore returns the existing row rather than reporting a mismatch. This may be acceptable only if metadata is intentionally non-authoritative; document that contract or include canonical metadata in the request fingerprint/comparison. The function records a platform ledger entry only; it does not itself update a user balance.

## Caller inventory limitation

The connected GitHub code-search endpoint returned no indexed matches for either exact function name. That is not proof that no callers exist: the search covers the repository's default branch, and callers may exist on the working branch, in generated SQL, dynamic RPC strings, or external jobs. Before any privilege or implementation change, enumerate callers from the working branch, scheduled jobs, Edge Functions, deployment configuration, and production logs where available.

## Status / next actions

- [x] Read live function definitions and effective role privileges.
- [x] Identify direct balance-minting capability and missing deposit evidence/idempotency checks.
- [x] Identify platform-ledger idempotency comparison gap.
- [ ] Build a complete working-branch and deployed-job caller inventory.
- [ ] Confirm which current callers still depend on `credit_user_balance`; do not change ACLs until this is proven.
- [ ] Design and test a verified, replay-safe deposit-credit replacement against staging before production rollout.
- [ ] Add tests for same-key/same-payload replay, same-key/different-payload conflict, duplicate chain output, invalid amount, concurrent credits, and transaction rollback.

## Change safety

This was a read-only production audit. No function was called, no SQL DDL/DML was executed, no permissions or data were changed, and no tests or deployment were claimed.
