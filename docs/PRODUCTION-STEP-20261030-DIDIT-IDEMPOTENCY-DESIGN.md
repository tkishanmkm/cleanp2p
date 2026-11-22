# Paxones — Didit webhook idempotency design checkpoint

Date: 2026-10-30
Scope: Design-only artifact based on local migration/webhook inspection. Not an executable migration.

## Goal
Ensure one provider event can change KYC state at most once, even when Didit retries or sends concurrent callbacks.

## Proposed transaction contract
A single database function should:

1. Validate required input: registered `user_id`, `session_id`, non-empty provider `event_id`, normalized status, and the verified decision payload.
2. Insert the event into a dedicated `didit_webhook_events` ledger with a unique constraint on the provider's stable event identity. Prefer `(provider, event_id)`; if event IDs are only session-scoped, use `(provider, session_id, event_id)` after confirming the provider contract.
3. On unique conflict, return a deterministic duplicate result without incrementing retries, rewriting status, or emitting another notification.
4. Lock the profile and the exact verification row; reject stale sessions and mismatched owners.
5. Assert exactly one verification row is targeted. Until historical duplicates are reconciled, return a conflict result rather than arbitrarily selecting a row.
6. Apply the complete normalized transition and all required profile fields within the same transaction. A database error must roll back both the event claim and the KYC state changes.
7. Store a minimal event digest/processing outcome in the ledger. Avoid copying unnecessary identity documents or raw sensitive payloads into a second long-lived store.
8. Record notification intent transactionally (outbox pattern) or make notification delivery separately idempotent.

## Required event states
Suggested ledger states: `processing` and `processed` are not sufficient on their own unless both updates happen in the same transaction. In a single database transaction, insert the unique event row, apply KYC state, then mark the row `processed`; rollback removes the claim if the state change fails. If asynchronous processing is later required, define leases/recovery for abandoned `processing` rows.

## Transition coverage before implementation
- approved/completed/passed: persist extracted profile fields, enforce age/identity rules, lock verified fields, update verification record.
- in_review/pending/submitted/pending_review: set review flags consistently.
- declined/rejected/failed: atomically update retry window/count and verification status.
- resubmitted: persist resubmission state and any provider metadata needed by the UI.
- `kyc_expired`, `expired`, `abandoned`: define explicit transitions; do not merge distinct provider states without confirming semantics.
- unknown status: reject/record for review; never silently treat it as decline or approval.

## Preflight checks
- Confirm provider event ID stability, signature version, and documented retry behavior.
- Query duplicate `session_id` records and duplicate profile session bindings on a disposable/schema-matched database first.
- Verify current effective grants for both KYC RPCs; use an empty `search_path` and fully qualified objects in `SECURITY DEFINER` functions.
- Test concurrent duplicate events, concurrent different events for one session, stale sessions, missing verification rows, duplicate rows, database exceptions, age/identity restrictions, and all statuses.
- Keep credentials and full raw KYC payloads out of logs and test artifacts.

## Not performed
No SQL migration or webhook source change was made in this step. No database was contacted. No tests were run. No commit, push, or deployment was performed.
