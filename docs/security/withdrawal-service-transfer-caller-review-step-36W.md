# Step 36W — Withdrawal service and transfer RPC caller review

Date: 2026-10-14  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only source review of the canonical withdrawal service, withdrawal worker, and internal transfer API caller. A read-only live RPC catalog query was attempted but blocked by tool safety checks; no database function was invoked and no production data changed.

## Files reviewed

- `src/lib/services/withdrawalService.ts`
- `src/app/api/wallet/withdraw/route.ts`
- `src/jobs/withdrawalWorker.ts`
- `src/app/api/wallet/transfer/route.ts`

## Findings

### Critical — withdrawal idempotency key is not used as the idempotency identity

The withdrawal service accepts `input.idempotencyKey`, but its replay lookup filters by user, destination address, and amount; it does not filter by the supplied key. The request RPC call `request_withdrawal` also receives no idempotency key argument. This means a repeated request with the same destination/amount may be treated as a replay even if it has a different key, while the same key with changed request details is not explicitly bound to the original request. A reliable fix needs a database-enforced, per-user idempotency record/key and canonical request fingerprint inside the same transaction as reservation. Do not patch only the API lookup.

### High — platform-settings read failure is not handled explicitly

The service reads `platform_settings` but ignores the returned query error. When `settings` is null, the later code uses fallback numeric limits and does not independently reject the request for inability to verify the settings row. `assertPlatformControlAllowed('withdrawal')` runs earlier, but the second settings query still controls limits and emergency pause. Confirm the guard's contract and make every safety-critical settings failure fail closed.

### High — daily withdrawal limit is a non-atomic read-before-reserve check

The service reads the previous 24 hours of withdrawal rows and sums their USD equivalents before calling `request_withdrawal`. The query error is not checked. Concurrent requests can both pass the limit before either reservation is committed; missing/error results can also be treated as zero historical withdrawals. Enforce the rolling limit and reservation atomically in the authoritative database transaction or use a locked per-user limit record.

### High — amount parsing accepts some malformed strings

For string amounts, `parseFloat(String(rawAmount))` accepts numeric prefixes such as `"1.5junk"` as 1.5. Use strict decimal parsing and explicit asset precision/maximum checks before database execution, with the database RPC independently validating the same invariants.

### High — profile/limit enforcement updates are not checked

When a single-withdrawal or rolling daily limit is exceeded, the service updates the profile restriction fields and inserts an audit log but does not inspect returned Supabase errors or affected-row counts. It can return a restriction outcome even if the restriction/audit write failed. Separate transactionally enforced policy from best-effort notifications/audit writes and verify safety-critical persistence.

### High — notification writes are best-effort and the withdrawal creation RPC response needs strict validation

The service ignores the notification insert result (which is acceptable only if notification delivery is explicitly non-critical). More importantly, after `request_withdrawal` returns without an error, it derives the ID from `rpcResult?.withdrawal_id || rpcResult` and defaults status to `QUEUED` without validating that the RPC response explicitly contains a valid withdrawal ID/status. Require a well-defined result shape and treat malformed success responses as reconciliation-required rather than success.

### High — transfer restriction checks need to be repeated inside the authoritative RPC

The transfer route checks sender and recipient profile restrictions, then calls `execute_internal_transfer` with sender ID, recipient username, asset, amount, and idempotency key. Because restrictions are checked outside the database transaction, the account can become banned/frozen between API checks and the transfer commit. The RPC must resolve the recipient, enforce both users' active status, and perform balance/ledger changes atomically. Confirm that RPC ACLs only allow intended callers; this live catalog verification was not completed in this step.

### Medium/High — recipient lookup has risky fallback behavior

The transfer route tries profile username, UUID, email/full name, deposit address, and then scans Auth users. The fallback uses `admin.auth.admin.listUsers()` and may create/upsert a profile for a recipient as a side effect. Review pagination/completeness, ambiguous matches, privacy exposure, and whether recipient profile creation belongs in a transfer request. A recipient should be resolved deterministically before any money movement.

### Medium — emergency-frozen status is selected incompletely for the recipient

The initial recipient profile queries select `is_banned`, `is_restricted`, and `account_status`, but not `is_emergency_frozen`; a later check casts the object to `any` and reads that property. The property will normally be absent from these query results, so that specific recipient freeze flag may not be enforced by the API. The database RPC must enforce the authoritative state regardless.

### Existing positive controls observed

- The withdrawal route delegates to a canonical service rather than directly editing wallet balances.
- The service applies authentication, KYC, account restriction, password-change hold, optional 2FA, asset/network validation, and server-side fee/price helpers before calling `request_withdrawal`.
- The transfer route requires an idempotency key and checks for explicit `success: true` plus core financial fields in the `execute_internal_transfer` result.
- The worker keeps a broadcast transaction in a nonterminal state pending confirmation and uses a quarantine path for observed chain failures instead of immediately refunding them.

## Required next work

1. Read the live definitions and grants for `request_withdrawal` and `execute_internal_transfer` through a permitted read-only inspection path.
2. Match each RPC's exact balance store, ledger columns, transaction type constraints, locking, idempotency enforcement, and restriction checks against production schema.
3. Design one transactionally enforced withdrawal reservation/idempotency contract and one transfer contract before changing application code or production SQL.
4. Keep withdrawals/deposits disabled or fail-closed where the settlement/accounting contract cannot be proven safe; never resolve schema mismatch by guessing columns or types.

## Verification

- Active branch source files fetched and reviewed.
- Live RPC catalog query blocked by tool safety checks; no RPC executed.
- No code or production SQL changes in this step.
- No build, typecheck, or automated tests run.
