# Trade-fee migration — follow-up review (Step 161)

Reviewed: `supabase/migrations/20261015203000_restore_platform_trade_fee_accounting_legacy_schema.sql`

This is a static review only. No database connection, migration execution, staging test, or production write was performed.

## Result

**Do not apply this migration to production yet.** The migration is not validated, and this review found issues that need resolution before settlement tests can establish safety.

## Findings

### 1. Authorization checks occur after a buyer wallet insert (high priority)

In the copied `release_trade_escrow` function, the buyer wallet `INSERT ... ON CONFLICT DO NOTHING` occurs before the payment, dispute, and seller/admin authorization checks. The function is `SECURITY DEFINER`. Although an exception generally rolls back the statement transaction, authorization should be established before any state-changing operation; the current ordering can create unnecessary wallet rows if a path returns without error and makes the trust boundary harder to reason about.

**Required fix:** move all state-changing statements, including buyer-wallet creation, after payment/state and caller authorization checks. Re-check the original business workflow before changing the order.

### 2. Text participant IDs are cast to UUID without prior validation

The live legacy schema has `trades.buyer_id` and `trades.seller_id` as text. The migration casts both with `::UUID` in inserts and fee-accounting logic. Malformed historical IDs can cause settlement to fail. Validate both IDs as UUIDs before reaching any cast, and fail closed with a clear exception.

### 3. Execution privileges are not explicitly managed in the migration

The migration replaces a `SECURITY DEFINER` function but does not include explicit `REVOKE`/`GRANT` statements. Existing ACLs may survive `CREATE OR REPLACE FUNCTION`, but this migration does not itself prove that access remains limited to intended trusted roles. Verify the actual staging ACLs and explicitly preserve the intended grants after review; do not grant direct execution to `anon` or `authenticated` without a documented requirement.

### 4. Fee helper idempotency is not yet verified

The release function calls `record_platform_ledger_entry` with a deterministic idempotency key. The migration has not been run against PostgreSQL, and this static review does not establish that the helper enforces uniqueness, handles retries safely, or rolls back settlement on conflict.

**Required test:** inspect the helper implementation and unique constraint/index, then exercise duplicate and conflicting idempotency-key cases in staging.

## Safe next sequence

1. Correct the function ordering and UUID validation in a reviewed migration.
2. Verify helper implementation, uniqueness constraints, and exact function ACLs against a disposable staging schema.
3. Apply only to staging; run the settlement and rollback cases from `docs/audits/trade-escrow-fee-staging-validation.md`.
4. Record actual test output before considering production approval.

## Evidence limitation

This report is based on source inspection only. It is not proof of runtime exploitability, nor proof that the migration compiles or works. No staging credentials or test output were available during this step.
