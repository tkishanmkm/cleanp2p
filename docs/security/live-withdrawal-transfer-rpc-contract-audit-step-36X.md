# Step 36X — Live withdrawal and internal-transfer RPC contract audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only catalog and function-definition inspection. No financial RPC was executed and no production data or schema was changed.

## Live RPC ACL and contract snapshot

| Function | Exact live signature | SECURITY DEFINER | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---|---:|---:|---:|---:|
| `request_withdrawal` | `(uuid,text,text,numeric,numeric,text,numeric)` | Yes | No | No | Yes |
| `execute_internal_transfer` | `(uuid,text,text,numeric,text)` | Yes | No | No | Yes |
| `complete_onchain_withdrawal` | `(uuid,text,numeric,text)` | Yes | No | No | Yes |
| `process_failed_withdrawal` | `(uuid,text,numeric,text,boolean)` | Yes | No | No | Yes |
| `claim_pending_withdrawals` | `(integer)` | Yes | No | No | Yes |

All five functions have a pinned `search_path` setting. The first two reviewed functions use `public, pg_temp`; settlement functions use `public, auth, pg_temp`. ACLs are service-role-only in the live snapshot; this is a positive control, but function bodies and callers still need review.

## Critical finding — withdrawal reservation writes an incompatible ledger schema

The live `request_withdrawal` function:
1. Locks the profile row and checks platform controls, account restrictions, KYC, password-change hold, approval state, and limits.
2. Locks the `wallet_assets` row and reserves `amount + fee` by reducing `balance` and increasing `in_withdrawal`.
3. Inserts paired rows into `withdrawals` and `onchain_withdrawals`.
4. Attempts to insert a ledger row using `wallet_id`, `asset_code`, `delta_available`, `delta_locked`, `available_after`, `locked_after`, `entry_type`, `ref_table`, `ref_id`, and `idempotency_key`, with `entry_type = 'withdrawal_lock'`.

These columns do not exist in the live compact `public.ledger_entries` schema identified in Step 36U; its allowed `type` values also do not include `withdrawal_lock`. The reservation function does not catch that insert error. PostgreSQL should roll back the entire function transaction when the insert fails, including preceding reservation and withdrawal-row writes. This strongly indicates that new withdrawal requests through this RPC may fail until the ledger contract is reconciled. This was inferred from source/schema compatibility; no live RPC was called to test it.

The service-layer preflight is not a substitute for this database transaction. It also uses a separate preflight rolling-limit query, while the RPC independently checks limits under a profile lock. The RPC's rolling-limit sum uses `withdrawals.amount` and therefore must be reviewed for asset/USD normalization: summing raw units from multiple assets is not a USD-equivalent total.

## Transfer RPC — ledger insert schema aligns, but other risks remain

The live `execute_internal_transfer` function inserts ledger rows using the compact schema fields `user_id`, `crypto`, `asset`, `chain`, `amount`, `type`, `status`, `reference_id`, `balance_after`, `metadata`, and `created_at`, which match the live table's column contract. It writes sender and recipient entries with type `transfer`, which is allowed by the current type constraint. No transfer was executed.

Positive controls observed:
- Service-role-only execute grant in the live ACL snapshot.
- Required per-sender idempotency key and transaction-scoped advisory lock.
- Request fingerprint and conflict checks for replayed keys.
- Platform transfer/emergency controls fail closed when missing or malformed.
- Sender and recipient profile rows are locked in deterministic UUID order.
- Both users' banned/restricted/non-active and emergency-frozen state are checked inside the RPC.
- Sender KYC tier is checked inside the RPC.
- Balance changes and ledger writes are inside one database function transaction.

Remaining transfer review items:
- Verify the rest of the function's transaction order and every error/constraint interaction, including transfer-row uniqueness and balance-update row counts.
- Review idempotency replay for legacy rows with a null `request_fingerprint`; the function falls back to parameter comparisons, so verify this is sufficient for all historic data.
- Review recipient wallet row creation and uniqueness constraints for concurrent first-time credits.
- Review service-role callers: the function permits service-role callers to supply `p_sender_id`, so application service code remains a trusted boundary. The API route does authenticate the user, but other callers must be inventoried.
- API recipient discovery still has an Auth-user fallback and profile upsert side effects (Step 36W).

## Withdrawal idempotency mismatch remains

The application withdrawal service performs a heuristic replay lookup by user, destination, and amount when an idempotency key is present. The live `request_withdrawal` signature has no idempotency-key parameter and creates an internal key from the generated withdrawal ID. This is not equivalent to client-key idempotency and should be addressed with a DB-enforced key plus request fingerprint in the same reservation transaction.

## Production recommendation

- Treat the live withdrawal reservation path as **blocked pending repair** because its ledger insert is incompatible with the deployed schema.
- Do not hot-patch just the missing columns or broaden the type constraint. The live settlement/refund functions have the same incompatible contract; any schema change must reconcile all writers, readers, indexes, uniqueness rules, ledger semantics, and existing accounting history together.
- Preserve the existing transfer RPC for now; do not make a speculative change. Finish the transaction/constraint/caller review before declaring it production-ready.
- Use a migration and staging verification plan first. No migration was created or applied in this step.

## Verification and limitations

- Live catalog query confirmed exact signatures, SECURITY DEFINER flags, search_path configuration, and EXECUTE privileges.
- Live function definitions inspected for `request_withdrawal` and `execute_internal_transfer`; targeted substring query confirmed their ledger insert column lists.
- No function was invoked; no balances, ledger rows, withdrawal rows, transfer rows, or production schema were changed.
- No build, typecheck, or automated tests were run.
