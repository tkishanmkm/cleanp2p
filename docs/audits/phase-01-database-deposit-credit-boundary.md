# Phase 01 — Database Deposit Credit Boundary Audit (Step 28)

Date: 2026-10-13
Project: Paxones Supabase project `eaiwgfxoiwxepinvcykg`
Scope: read-only PostgreSQL catalog inspection; no financial rows selected; no writes performed.

## Executive result

**Not production-ready. No SQL changes were applied.** The main RPC `public.process_deposit_atomic` and multiple other deposit-related functions are `SECURITY DEFINER`. Catalog privilege checks report that `anon`, `authenticated`, and `PUBLIC` cannot execute the inspected deposit functions, while `service_role` can. This is a positive direct-API restriction, but it is not a complete trust boundary: any server route, job, or compromised server-side service-role credential can call the functions with caller-supplied evidence unless the function itself requires independently verified proof.

## Findings

### 1. Main RPC accepts unverified credit facts — Critical

`process_deposit_atomic` accepts destination, asset, network, amount, transaction hash, output/log index, block number, confirmations, and provider as parameters. Its body calculates effective confirmations using the caller-provided count and any stored count:

```sql
GREATEST(COALESCE(p_confirmations, 0), COALESCE(v_existing_onchain.confirmations, 0))
```

It compares that value to a network threshold and can credit `wallet_assets.balance` plus insert a ledger entry. The function does not itself fetch a canonical chain proof or require a verified attestation tied to the exact transaction event. Existing counts only increase, so an earlier false confirmation cannot be corrected by this logic alone.

The function uses `SECURITY DEFINER` and is owned by `postgres`. The fixed search path is `public, pg_temp`; review whether `public` is writable by untrusted roles and schema-qualify every object in any remediation.

### 2. Multiple alternative privileged deposit functions exist — High

The database catalog contains these additional deposit-related functions, each marked `SECURITY DEFINER` unless noted:

- `credit_confirmed_deposit(p_tx_hash, p_log_index, p_network, p_user_id, p_asset, p_amount)`
- `credit_deposit_atomic(p_user_id, p_crypto, p_network, p_address, p_txid, p_amount, p_confirmations, p_required_confirmations)`
- `credit_onchain_deposit(p_tx_hash, p_address, p_amount, p_asset_code, p_network_code)`
- `ingest_and_credit_deposit(p_tx_hash, p_log_index, p_network, p_to_address, p_amount, p_asset_symbol, p_confirmations)`
- `process_confirmed_deposit(p_deposit_id)`
- `process_deposit(p_user_id, p_asset_symbol, p_amount, p_tx_hash)`
- `process_incoming_deposit(p_to_address, p_asset, p_network, p_amount, p_txid, p_output_index)`
- Three `SECURITY DEFINER` overloads of `process_user_deposit` that accept caller-supplied user/asset/amount/transaction fields or confirmations.
- `claim_next_deposit_sweep` is also SECURITY DEFINER but appears sweep-related, so audit it separately rather than assume it credits funds.

A fourth `process_user_deposit` overload is SECURITY INVOKER. The two address-sync functions are also SECURITY INVOKER.

For every listed deposit function, the catalog privilege check returned: `anon=false`, `authenticated=false`, `service_role=true`, `PUBLIC=false`. This checks effective execute privilege for the named roles; it does not establish which application callers use each function, nor does it prove every overload has safe internal authorization.

### 3. Existing grants are restrictive but insufficient — High

The main function is not directly executable by the normal Supabase `anon` or `authenticated` roles in the inspected privilege context. Do not broadly revoke `service_role` access without first mapping callers, as that could break server-side operations; the service-role secret must never reach browsers. The required fix is a proof-enforcing database boundary plus removal/containment of unsafe legacy credit paths.

## Safe remediation plan (not applied)

1. **Map callers for every credit-capable function and overload** in application code, SQL triggers, scheduled jobs, and Edge Functions. Identify unused legacy functions.
2. **Introduce a verified-event boundary**: only a trusted verifier should be able to record evidence after checking canonical network, transaction success, block canonicality, exact recipient, exact asset/token contract, exact output/log index, integer base-unit amount, and network-specific confirmation/finality policy. The proof must be cryptographically or transactionally bound to all those fields and not be mintable by ordinary API callers.
3. **Change credit RPCs to require a verified evidence identifier**, then re-read and lock that evidence row inside the same transaction. Reject mismatches, duplicate use, stale/reorged evidence, and any path that supplies confirmations directly.
4. **Quarantine or retire legacy credit functions** after caller migration. Revoke execute privileges from `PUBLIC`, `anon`, and `authenticated` explicitly as defense in depth; grant only to the intended internal role where necessary. Keep service-role credentials server-only.
5. Add staging-only tests for forged confirmations, mismatched amount/recipient/asset/index, failed receipts, reorgs, duplicate events, concurrent calls, and attempted calls through every legacy overload. Do not use real production financial rows for tests.
6. Run Supabase security advisors and verify grants/function definitions after applying a reviewed migration.

## Verification performed

- Read-only catalog query inspected the definition and effective execute privileges of `process_deposit_atomic`.
- Read-only catalog query enumerated deposit-related functions and effective execute privileges.
- No wallet, deposit, or ledger financial rows were queried.
- No SQL, grants, function definitions, production configuration, merge, or deployment were changed.
- Application caller mapping is not complete; this audit does not certify that every alternative function is unreachable.
- Exact-event verifier and proof-enforcing database boundary do not yet exist as a verified completed implementation.
