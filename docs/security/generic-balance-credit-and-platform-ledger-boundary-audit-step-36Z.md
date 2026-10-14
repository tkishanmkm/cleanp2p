# Step 36Z — Generic balance-credit and platform-ledger RPC trust-boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only function body, function ACL, table-contract and in-database caller-reference review. No function was invoked; no rows, schema, or privileges were changed.

## 1. `credit_user_balance(uuid,text,text,numeric)`

### Live definition and permissions
- `SECURITY DEFINER`, owner `postgres`, pinned empty search_path; table references are schema-qualified.
- `service_role` can execute; `anon` and `authenticated` cannot. ACL snapshot lists explicit grants only to `postgres`, `service_role`, and `supabase_auth_admin`; no PUBLIC execute grant was present.
- The function accepts an arbitrary target user, asset, network, and amount. It does not itself validate on-chain evidence, a canonical deposit row, confirmation count, chain/network compatibility, or a deposit idempotency key.
- It writes a generic `type='deposit'` ledger row without `reference_id`, transaction hash, network, or evidence metadata. Thus repeated service-role calls can credit repeatedly and the deposit-reference unique index does not protect these entries.

### Critical deployed-schema incompatibility
The function attempts to upsert `wallet_assets.available` and `wallet_assets.locked`, but the live `wallet_assets` columns include `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, and `in_withdrawal`; `available` and `locked` are absent. It also attempts to insert a parent `wallets` row with only `user_id` and `currency`, while the live table requires non-null `chain`, `address`, and `derivation_index` without defaults. As written against the inspected live schema, the function is expected to fail before safely crediting a balance. This is inferred from catalog/source comparison; the function was intentionally not executed.

This is not safe to repair by simply renaming columns or granting more access. The platform has multiple competing wallet stores, and the authoritative balance model must be resolved first.

## 2. `record_platform_ledger_entry(...)`

### Live definition and permissions
- `SECURITY DEFINER`, owner `postgres`, `search_path=public, pg_temp`; `service_role` can execute, `anon` and `authenticated` cannot.
- Requires a nonblank idempotency key, nonblank entry type and asset, positive amount, and direction `CREDIT` or `DEBIT`.
- Inserts into `platform_ledger_entries`, uses `ON CONFLICT (idempotency_key) DO NOTHING`, and compares core event fields before returning the prior row for a replay. A conflicting replay raises an exception.
- It records a platform accounting event only; it does not itself modify user balances or establish verified on-chain evidence. It must not be treated as a substitute for a user deposit-credit transaction.
- The function uses `search_path=public, pg_temp`; unlike the empty-path function above, this path includes a writable temporary schema. Review whether `pg_temp` is needed and prefer a hardened path/qualification convention. Do not alter this function without dependency review.

## 3. In-database caller review

The live catalog search of public function definitions found no other public function definitions containing calls to either function; only each function's own definition matched its own name. This does **not** prove there are no application/worker callers, dynamic SQL callers, or callers in other schemas. Repository code search for the exact names did not return results in this pass, so application caller inventory remains incomplete.

## 4. Disposition

1. Keep `credit_user_balance` restricted to the current service-role boundary; do not use it for production deposit credit and do not broaden grants.
2. Treat its current body as incompatible with the live schema and unsafe as a deposit authority because it has no independent verified-evidence or idempotency binding.
3. Keep automatic deposit credit fail-closed until one reviewed ingestion path binds a canonical on-chain event, confirmation policy, output identity, idempotency, user/asset/network mapping, balance mutation, and ledger entry atomically.
4. Keep `record_platform_ledger_entry` separate from user wallet credit; review its callers, allowed entry types, and search-path hardening before changes.
5. Resolve the authoritative wallet balance store and the full user/platform ledger contract before attempting a fix. Coordinate with withdrawal reservation/settlement/refund, transfer, reconciliation, sweep, and broadcast flows.
6. Next audit: enumerate application/worker call sites and verify whether either RPC is called through dynamic RPC wrappers, environment-driven jobs, or non-public-schema functions.

## Verification / limitations

- Read live function definitions, owners, SECURITY DEFINER flags, ACLs and execute privileges.
- Compared referenced columns against live `wallet_assets`, `wallets`, `ledger_entries`, `platform_ledger_entries`, and `onchain_deposits` columns.
- Searched public function definitions for references to the two function names.
- No financial function was invoked; no balance, deposit, ledger row, schema, or privilege was changed.
- No build or automated tests were run.
