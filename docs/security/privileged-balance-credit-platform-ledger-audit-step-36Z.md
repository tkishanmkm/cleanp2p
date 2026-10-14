# Step 36Z — Live privileged balance-credit and platform-ledger RPC audit

Date: 2026-10-14  
Repository: `tkishanmkm/cleanp2p`  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only production Supabase catalog/ACL inspection plus repository caller search. No database changes, RPC calls, balance updates, or ledger writes were performed.

## Production findings

Project: `eaiwgfxoiwxepinvcykg` (`paxonesflows`).

### 1. `public.credit_user_balance(uuid,text,text,numeric)` — HIGH RISK

- `SECURITY DEFINER`; pinned to an empty search path and uses schema-qualified table names.
- EXECUTE is granted to `service_role` (and internal admin roles), denied to `anon` and `authenticated`.
- The function accepts a target user, asset, network and amount, then directly increments `wallet_assets.available` and inserts a compact `ledger_entries` row with type `deposit`.
- It does not verify a canonical `onchain_deposits` row, transaction confirmation, network/asset match, output index, deposit status, or a deposit-specific idempotency key.
- It does not use its `target_network` argument beyond accepting it.
- Each successful call can add another credit and another deposit ledger row. The unique deposit-reference constraint does not protect this function because it inserts no `reference_id`.
- Repository code search returned no indexed matches. This is not proof that there are no callers: GitHub search indexing may be incomplete and dynamic RPC calls may evade exact search.

**Conclusion:** do not treat this RPC as a verified deposit-credit boundary. A privileged caller that can invoke it can request a credit without on-chain evidence. Since the legacy deposit RPCs were already contained, this function is a remaining privileged credit path that needs caller inventory and safe containment.

### 2. `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

- `SECURITY DEFINER`; `search_path` is set to `public, pg_temp`.
- EXECUTE is granted to `service_role` and internal admin roles, denied to `anon` and `authenticated`.
- Validates nonempty idempotency key, entry type, asset code, positive amount and direction (`CREDIT`/`DEBIT`).
- Inserts into `platform_ledger_entries` with `ON CONFLICT (idempotency_key) DO NOTHING`, then compares the existing event's core financial/reference fields and raises on a mismatch.
- Existing-event replay does **not** compare `metadata`; therefore metadata differences for a reused key are ignored. Whether that is acceptable depends on whether metadata is audit-significant.
- The function records a platform ledger event; it does not itself prove chain evidence or update a user balance. Its callers still must be checked for authorization, evidence and correct idempotency-key construction.
- Repository code search returned no indexed matches; this is inconclusive for the same indexing/dynamic-call reasons above.

## ACL snapshot

Both functions: `service_role = EXECUTE`, `anon = denied`, `authenticated = denied`, `postgres = EXECUTE`. This avoids direct end-user invocation but does not make the balance-credit function safe for privileged callers.

## Recommended next actions

1. Inventory all wallet/deposit server code, edge functions, jobs, migrations and dynamic RPC call sites, including string-built RPC names.
2. Confirm whether any live worker depends on `credit_user_balance`. If no legitimate caller remains, revoke `EXECUTE` from `service_role` in a reviewed migration and verify the ACL. If a caller exists, replace it with a verified, atomic credit path that checks canonical confirmed deposit evidence and enforces idempotency before any balance mutation.
3. Decide explicitly whether `metadata` must be part of platform-ledger idempotency equality.
4. Keep deposit credit fail-closed until the replacement path is fully verified. Do not restore execution grants to legacy deposit RPCs as a workaround.

## Status

- Audit: completed for live function definitions and direct ACLs.
- Caller inventory: incomplete; GitHub indexed search returned no matches and cannot establish absence.
- Fix: not applied in this step.
- Production readiness: wallet deposits are **not production-ready** until the remaining privileged credit path is contained or replaced and verified.
