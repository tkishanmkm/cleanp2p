# Didit KYC Webhook Failure-Path Audit — 2026-10-30

## Scope
Read-only review of `src/app/api/webhooks/didit/route.ts` and existing Didit migration/test contracts. No live provider or database was contacted.

## Verification run
Command:
`node --test tests/didit-initiate-config-guard.test.ts tests/restrict-didit-kyc-migration.test.ts tests/didit-webhook-security-contract.test.mjs tests/didit-active-session-migration.test.ts`

Result: 15 tests passed, 0 failed. These are primarily static/source-contract tests; they do not prove live database grants, provider signature compatibility, or transactional runtime behavior. Node emitted MODULE_TYPELESS_PACKAGE_JSON warnings for TS tests.

## Findings requiring implementation
1. **Under-18 restriction update is unchecked.** The handler awaits the profile update but ignores its returned `error`; it then returns HTTP 200 with a banned result. A failed write can therefore be acknowledged as enforced.
2. **Duplicate-identity restriction update is unchecked.** The handler logs a match and attempts to ban, but ignores the database result before returning HTTP 200.
3. **Incomplete verification module path is unchecked.** It attempts to set `kyc_status: 'declined'`, ignores the update result, and returns HTTP 200. A failed write can leave an approved-looking or stale profile state.
4. **Non-approval branches ignore writes.** In-review, declined/retry-limit, resubmitted, expired, and abandoned branches contain direct profile/verification writes whose returned Supabase errors are not consistently checked.
5. **Event deduplication is not atomic.** The handler checks `vendor_data.last_event_id` before writes, but stores that ID only in the resubmitted branch. Concurrent webhook deliveries can race; other statuses are not durably deduplicated by that code path.
6. **Approval can partially persist.** The profile approval update and verification-row update are separate REST calls. The handler checks each result, but a failure between them leaves partial state. The SQL RPC `sync_didit_kyc_status` exists, but the current webhook does not route all decisions through it.
7. **Session row cardinality remains ambiguous in schema.** `kyc_verifications.session_id` has an index, not a unique constraint. The webhook checks ownership with up to two rows, but the active-session RPC uses `LIMIT 1`; the schema should be reconciled with actual historical data before any uniqueness migration.

## Safe remediation sequence
1. Add explicit result/error handling for every safety-relevant write. Return a retryable non-2xx status if the restriction or decision cannot be persisted; never acknowledge a state transition that was not saved.
2. Move decision persistence into one server-only transactional RPC, including profile + verification status + event ledger writes.
3. Add a durable event ledger with a unique provider event key and payload digest. Duplicate same-digest events should return the saved result; same event ID with a different digest should be rejected.
4. Resolve historical duplicate/missing session IDs before considering a unique constraint. Do not apply a migration until tested against a schema-matched disposable database.
5. Add integration tests for write failures, concurrent duplicate delivery, stale sessions, and rollback/atomicity. Keep static tests as supplemental checks.
6. Confirm the exact active Didit signature version, canonicalization and timestamp contract against the configured provider version before removing compatibility behavior.

## Safety boundary
No source change was made in this step. The attempted source edit was blocked by tooling safety checks. No migration was applied; no live database queried; no commit, push, or deployment performed.
