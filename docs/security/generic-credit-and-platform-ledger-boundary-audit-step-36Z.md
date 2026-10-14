# Step 36Z — Generic balance-credit and platform-ledger trust-boundary audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only inspection of live function definitions, execution privileges, deployed table contracts, and repository caller-search results. No financial RPC was executed; no data, schema, or permissions were changed.

## Executive result

**Do not treat the generic credit function as a safe deposit-credit path.** The live `public.credit_user_balance(uuid,text,text,numeric)` is SECURITY DEFINER and executable by `service_role`. It accepts a user, asset, network, and amount but does not independently verify an on-chain transaction, confirmation threshold, canonical deposit row, output index, or deposit idempotency reference. Its body directly attempts to credit a balance and write a `deposit` ledger entry.

In addition, its SQL is incompatible with the live deployed `wallet_assets` and `wallets` schemas as inspected: it writes `wallet_assets.available`, but the live table exposes `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, and `in_withdrawal` rather than `available`; it also inserts only `user_id,currency` into `wallets`, while live `wallets` has required `chain,address,derivation_index` columns. These mismatches are strong evidence that the function can fail when called on the current schema. This is a source/schema finding, not a runtime test; the RPC was deliberately not invoked.

## 1. Live function privileges

- `credit_user_balance(uuid,text,text,numeric)`: SECURITY DEFINER, owner `postgres`, empty pinned search path; executable by `service_role` and `postgres`, not by `anon` or `authenticated`.
- `record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)`: SECURITY DEFINER, owner `postgres`, search path `public, pg_temp`; executable by `service_role` and `postgres`, not by `anon` or `authenticated`.

The inspected privilege query did not show a separate `PUBLIC` role row; the explicit role checks confirm anon/authenticated are denied and service_role is allowed. Recheck inherited/public ACLs as part of the later final ACL sweep before production sign-off.

## 2. Critical finding — `credit_user_balance` is not evidence-gated

The function:
- takes caller-supplied `target_user_id`, asset, network and amount;
- normalizes the asset symbol only;
- does not validate amount is positive/finite or validate asset/network against an allowlist;
- does not bind credit to an existing verified `onchain_deposits` row or transaction/output identity;
- has no deposit-specific idempotency key/reference check;
- updates the wallet balance before writing a compact `ledger_entries` deposit row, in one function transaction, but the live wallet-column mismatch can make the operation fail before a credit is completed.

If any trusted backend route invokes it with unverified or replayable input, it would be a generic balance-minting boundary. Service-role-only execution limits the caller set but is not sufficient authorization by itself. **Keep this function contained and do not grant it to any additional role or use it as a replacement deposit pipeline.**

## 3. Critical live-schema mismatches

Live `wallet_assets` has `balance` and `locked_balance`, but no `available` or `locked` columns. The function references `available` and `locked` in its insert/upsert and update expressions.

Live `wallets` has required `chain`, `address`, and `derivation_index` columns. The function's conditional insert supplies only `user_id,currency`. Unless undisclosed defaults/triggers supply those values (not established by the catalog snapshot), this insert is also incompatible.

The function writes `ledger_entries(user_id,crypto,type,amount,balance_after,created_at)`, which does match the compact ledger column names and the allowed `deposit` type, but does not provide a unique deposit reference. Thus ledger schema compatibility does not fix the missing evidence/idempotency controls.

## 4. `record_platform_ledger_entry` review

Positive controls:
- requires a nonblank idempotency key and entry type / asset;
- requires amount > 0 and direction exactly `CREDIT` or `DEBIT`;
- inserts into the distinct `platform_ledger_entries` table using an idempotency key;
- on replay, compares core event identity fields and raises on mismatch.

Gaps / cautions:
- replay comparison does not compare `metadata`, so metadata differences for the same key are silently treated as the same event;
- it records a platform ledger entry only; it does not verify on-chain evidence or itself move user balances;
- because it is SECURITY DEFINER and service_role-executable, every caller remains a privileged trust boundary;
- search path includes `pg_temp`; review object qualification and harden to a safer pinned path in a separately reviewed migration if feasible.

This function should not be confused with `ledger_entries`: `platform_ledger_entries` is a separate accounting table with a different schema and purpose.

## 5. Caller search / audit limitation

Repository code search for the exact function names returned no matching excerpts in the connected GitHub search result. This is **not proof that there are no callers**: the search endpoint may index only the default branch, and string-based searches may miss generated SQL, indirect wrappers, or other deployments. Catalog dependency inspection also returned no recorded database-object dependencies for either function, which does not reveal application-level RPC calls.

Before enabling or relying on either function, perform a branch-wide local grep and inspect every direct/indirect RPC caller, scheduled job, edge function, and external worker. For each caller verify authentication, trusted user binding, validated evidence, replay handling, amount bounds, and checked RPC errors. No caller can be marked safe based on this step alone.

## 6. Required next actions (not executed)

1. Keep the generic credit function unavailable to untrusted roles and do not restore legacy deposit RPC grants.
2. Inventory all application and worker callers of both functions from the exact branch and deployment artifacts.
3. Design the verified deposit path around a canonical `onchain_deposits` record with confirmed chain evidence and a unique event/output identity, then atomically credit the single authoritative balance store and append the matching ledger event.
4. Reconcile the authoritative balance schema before changing any SQL. Do not simply rename columns or add aliases to make this one function run; wallet tables currently have competing models.
5. Add tests for unverified evidence, duplicate tx/network/output, conflicting replay, zero/negative/overprecision amount, concurrent duplicate processing, wallet provisioning, and rollback if ledger insertion fails.
6. For `record_platform_ledger_entry`, decide whether metadata is part of the immutable event fingerprint and update replay comparison accordingly in a separately reviewed change.
7. Re-run ACL inspection including PUBLIC/inherited privileges, then run Supabase security advisors after any approved changes.

## Verification / limitations

- Read live function definitions, owners, SECURITY DEFINER/search_path settings, role execution privileges, and relevant table columns.
- Queried database dependency metadata; no direct dependencies were returned.
- Searched GitHub for exact function names; no code excerpts were returned, so application caller coverage remains incomplete.
- No RPCs executed; no user balances, deposit rows, or ledger rows changed; no grants or schema changed.
- No build, typecheck, or automated tests were run.

**Disposition: NOT production-ready.** Generic credit remains a high-risk privileged boundary, and current SQL appears incompatible with live wallet schemas. Maintain fail-closed deposit containment until a verified, idempotent replacement and full caller inventory are reviewed.
