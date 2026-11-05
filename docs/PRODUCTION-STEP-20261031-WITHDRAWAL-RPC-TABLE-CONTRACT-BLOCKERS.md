# PaxOnes Production Audit Ã¢â‚¬â€ Withdrawal RPC and table contract blockers (2026-10-31)

## Status
**Withdrawal production readiness remains BLOCKED.** This step used read-only Supabase catalog/function queries and local source inspection only. No withdrawal, reservation, broadcast, refund, SQL mutation, migration, commit, push, or deployment was performed.

## Live request path
The application executeCanonicalWithdrawal() calls:
1. lookup_withdrawal_idempotency_replay(uuid,text,text,text,numeric,text).
2. For a new request, request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text).

The live catalog has neither function and has no public.withdrawal_idempotency_keys table. The application correctly fails closed with HTTP 503 if lookup is unavailable; it does not fall back to the non-idempotent request RPC. The local migration 20261031140000_restore_withdrawal_idempotency_contract.sql proposes these objects, but its wrapper currently calls the deployed request_withdrawal function, whose body is not compatible with the live table schema (see below).

## Live base reservation RPC is not schema-compatible

The live public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) body:
- queries public.wallets.status = 'active', but the live wallets table has no status or provisioning_status column;
- tries to insert a wallet using status and provisioning_status, while the live wallet table requires chain, address, and derivation_index;
- inserts into public.withdrawals with wallet_id and idempotency_key, neither of which exists in the live table;
- omits live NOT NULL fields withdrawals.chain, token_symbol, and to_address;
- inserts into public.onchain_withdrawals without the live NOT NULL idempotency_key, and references a nonexistent metadata column;
- inserts into public.ledger_entries using wallet_id, asset_code, delta_available, delta_locked, available_after, locked_after, entry_type, ref_table, ref_id, and idempotency_key, none of which exist on the live ledger_entries table.

A patch that only adds the on-chain idempotency value would not repair the wallet insert, withdrawals companion row, or ledger write. The previously authored 20261026160000_fix_onchain_withdrawal_idempotency_insert.sql remains a narrow historical candidate, not a complete repair.

## Alternative live custodial RPC is not a drop-in replacement

The production-only request_custodial_withdrawal(uuid,text,text,text,numeric,numeric,text) is SECURITY DEFINER and executable only by service_role. It:
- locks and updates wallet_assets;
- validates its own request key against onchain_withdrawals.idempotency_key;
- inserts a compatible onchain_withdrawals row with the required idempotency key;
- writes the current live ledger_entries columns.

However, it does not insert a companion public.withdrawals row. The active local worker explicitly requires that paired row before any chain broadcast, and the settlement/refund flow also updates the companion row. It also supports only the live USDT network matrix and is not called by the local app. Do not redirect the application to this RPC without completing the paired-row and settlement/refund repair.

## Live worker claim and broadcast contract drift

The local worker calls claim_pending_withdrawals(p_owner_token, p_limit), then uses owner-token variants of record_withdrawal_broadcast and record_ambiguous_withdrawal_broadcast.

The live function catalog currently exposes only:
- claim_pending_withdrawals(p_limit integer);
  This old unfenced signature is still EXECUTE-granted to service_role (anon/authenticated are denied); revoke service-role access only after the owner-token replacement is installed and validated.
- claim_next_pending_withdrawal();
- no record_withdrawal_broadcast function of any signature;
- no record_ambiguous_withdrawal_broadcast function of any signature.

The live lease acquire/release functions exist, but without the owner-token claim and broadcast RPCs they do not provide the database fencing expected by the active worker. The active worker's paired-row preflight does fail closed before broadcast, but the RPC signature mismatch prevents its claim call from succeeding.

## Live settlement and refund contract drift

The deployed complete_onchain_withdrawal and process_failed_withdrawal functions:
- read v_withdrawal.metadata from onchain_withdrawals or select a metadata column from withdrawals; neither table has that column;
- update both onchain_withdrawals and withdrawals, but the production-only custodial request creates only the former;
- write to ledger_entries using the absent double-entry columns listed above.

The live function signatures are service-role-only, but their argument/body contracts also differ from some local hardened definitions. The live refund RPC currently exposes the five-argument process_failed_withdrawal(uuid,text,numeric,text,boolean) form; the exact semantic flag must be checked against the deployed body before any caller adjustment.
Read-only ACL checks also found no anon/authenticated EXECUTE grant on the inspected legacy admin-reject, final-withdrawal, external-withdrawal, custodial completion/refund, approval, or custodial request helpers. This did not establish whether every PUBLIC/other custom role is harmless; the complete role/overload inventory remains a release gate.

## Current live data and configuration state at audit time

Read-only row counts returned zero for withdrawals, onchain_withdrawals, wallets, wallet_assets, ledger_entries, and platform_ledger_entries. app_settings also had no rows and platform_settings had no row, so the local settings-seeding migration remains necessary before fee/governance-dependent paths can operate. These observations are a snapshot, not a guarantee of future row counts.

## Required release gates

1. Reconcile production-only schema/migration provenance; the live migration ledger and checked-in migration chain are not aligned.
2. Build one canonical reservation flow that creates the paired withdrawals and onchain_withdrawals rows, reserves wallet_assets, and writes only the deployed ledger schema in one transaction.
3. Align settlement/refund RPCs to the same paired-row and ledger contract; preserve strict broadcast/revert evidence rules.
4. Align claim, normal-broadcast, and ambiguous-broadcast RPC signatures with the owner-token fencing expected by the worker; revoke unfenced mutating overloads only after their replacements are installed and tested.
5. Restore idempotent request/replay objects and test same-key retry, conflicting intent, concurrency, rollback, approval, broadcast, confirmed settlement and refund in a schema-faithful disposable PostgreSQL database.
6. Re-query signatures, body hashes, privileges, table constraints, triggers, and indexes after migration.
7. Only then enable the canonical withdrawal path and perform an approved end-to-end test using a controlled test account/asset.

**Do not apply an isolated schema-column patch, call the existing custodial RPC as a shortcut, or enable production withdrawals yet.** No schema-faithful disposable PostgreSQL environment is currently available on the connected desktop; therefore this report is evidence and a release blocker, not a migration approval.
