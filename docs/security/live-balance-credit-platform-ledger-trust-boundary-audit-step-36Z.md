# Step 36Z — Live balance-credit and platform-ledger RPC trust-boundary audit

Date: 2026-10-14  
Scope: read-only inspection of live Supabase project `eaiwgfxoiwxepinvcykg` and source search in `tkishanmkm/cleanp2p`. No database or wallet data was changed.

## Executive result

**Wallet financial flows are not production-ready yet.** The two inspected functions are not executable by `anon` or `authenticated` in the live ACL snapshot, which is a useful boundary, but both are `SECURITY DEFINER` functions executable by `service_role`. The service role must therefore remain strictly server-side, and every privileged caller must be audited before either function is relied on for production financial events.

## Live database findings

### `public.credit_user_balance(uuid,text,text,numeric)`

- `SECURITY DEFINER`, owner `postgres`, pinned empty `search_path`.
- Execute: `anon=false`, `authenticated=false`, `service_role=true` in the inspected live snapshot.
- Credits caller-supplied `target_user_id`, `target_asset`, and `credit_amount` directly into `wallet_assets.available`, then inserts a `ledger_entries` row with type `deposit`.
- There is no visible check in this function for a verified on-chain deposit, canonical transaction/output identity, confirmation/finality, network/asset allow-list, positive/non-null amount, or an idempotency/reference key.
- Ledger insert does not populate a stable deposit `reference_id`; therefore the live partial unique deposit-reference guard cannot make these credits idempotent.
- Wallet upsert and ledger insert run in the same function transaction, so a ledger insert failure should roll back the balance change; however, successful repeated calls can credit the same event more than once.
- `target_network` is accepted but unused by the function body.
- **Risk:** any trusted server caller that can be induced to call this RPC with unverified input can create an arbitrary user balance credit. Do not expose this RPC to clients or restore it as a deposit worker entrypoint without a verified-evidence contract and atomic idempotency.

### `public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`

- `SECURITY DEFINER`, owner `postgres`, `search_path=public, pg_temp`.
- Execute: `anon=false`, `authenticated=false`, `service_role=true` in the inspected live snapshot.
- Validates non-empty idempotency key/type/asset, positive amount, and direction in `CREDIT|DEBIT`; inserts into `platform_ledger_entries` and handles duplicate idempotency keys by comparing most financial fields before returning the prior row.
- On a repeated key, the comparison does **not** compare `metadata`. Case/whitespace normalization of asset, entry type, and reference fields is not enforced here; callers need a canonical contract.
- This function records platform ledger evidence only; it does not itself prove a chain event or change a user's spendable balance.
- Its `public, pg_temp` search path is less robust than an empty pinned path with fully qualified references. The body uses schema-qualified table names, so review whether `pg_temp` is necessary and remove it in a separately tested migration if not.

### Caller inventory limitation

A live catalog scan of stored function definitions found no other function definition referencing either helper (apart from each function's own definition). This does not discover application/API callers, dynamic SQL, triggers whose source does not contain the literal, or code paths not indexed by GitHub search. Repository code search for the exact helper names returned no matches on the default-branch index, so caller coverage is **not complete**.

### Related deposit containment

Earlier steps revoked service-role execution from legacy unverified deposit-credit RPCs. Keep that fail-closed posture. Do not grant those legacy functions back simply to make deposits appear to work. A safe replacement must bind a canonical verified deposit event to an idempotency key and update balance plus ledger atomically.

## Required follow-up before production

1. Inventory every server/API/job caller of `credit_user_balance` and `record_platform_ledger_entry` from the active fix branch, deployment configuration, and worker code. Confirm service-role credentials never reach browser bundles.
2. Keep direct client execute denied. Add automated ACL assertions so future migrations cannot accidentally restore `PUBLIC`/client execution.
3. Replace arbitrary balance credit with a narrowly scoped, server-only RPC that validates a canonical verified deposit record, enforces network/asset/amount/output identity and confirmation policy, and atomically inserts an idempotent ledger event with the balance credit.
4. Make duplicate-event replay return the prior result only when all security-relevant event fields match; otherwise raise an idempotency conflict.
5. Reconcile authoritative balance stores and ledger semantics before enabling deposit credit; current audit found multiple balance tables and a compact ledger schema incompatible with several legacy RPCs.
6. Add staging integration tests for duplicate events, same key/different payload, concurrent first-time wallet creation, invalid/negative/zero amounts, unverified events, and ledger failure rollback. Then verify the live ACLs and Supabase Security Advisor.
7. Separately review `record_platform_ledger_entry` metadata replay semantics and harden its search path only with migration/test evidence.

## Verification and change record

- Read-only SQL inspected the live function definitions, owners, security-definer flags, function settings, and execute privileges.
- A separate catalog scan searched stored function definitions for literal helper references.
- GitHub exact-name search returned no matches from its default-branch index; this is not proof that no callers exist on the fix branch.
- No SQL mutations, wallet credits, ledger inserts, privilege grants, or revocations were performed in this step.
- No tests/build/deployment were run.
- **Status: audit report only; production readiness not established.**
