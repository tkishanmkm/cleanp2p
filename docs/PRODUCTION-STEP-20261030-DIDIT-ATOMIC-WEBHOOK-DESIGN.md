# Didit KYC transactional webhook decision — implementation gate

Status: design/audit note only. Do not apply to any database.

## Current verified contract
- The webhook authenticates a signed payload, checks a fresh timestamp, and resolves a session owner from profiles and kyc_verifications.
- The webhook currently writes profile and verification status separately.
- The existing sync_didit_kyc_status(uuid,text,text,jsonb) function locks the profile and validates the active session, but does not accept an event ID.
- kyc_verifications.session_id is indexed but not unique in the inspected migration.
- Existing webhook dedup reads vendor_data.last_event_id, while only the resubmission branch stores it.
- Existing RPC branches do not consistently check affected row counts, and the RPC currently does not cover resubmission/expired/abandoned states.

## Required implementation shape
1. Add a durable didit_webhook_events table keyed by a stable provider event identifier, scoped to session_id. Store a payload digest, processing status, and timestamps; do not store unnecessary raw identity data.
2. In one SECURITY DEFINER function with an empty search_path, lock the profile and all matching verification rows, reject ambiguous or stale sessions, and claim the event key using a unique constraint.
3. Apply the profile and verification updates in that same transaction. Assert the expected row counts; raise on any mismatch so PostgreSQL rolls back both state changes and the event claim.
4. Treat a previously completed event as a safe idempotent success. A duplicate event key with a different payload digest must fail closed and be logged without sensitive payload data.
5. Handle all supported Didit statuses explicitly. Unsupported statuses must not mutate state.
6. Preserve/verify the current trusted-role ACL for the exact new RPC signature; revoke PUBLIC, anon, and authenticated, and grant only service_role/postgres as appropriate for the deployment.
7. Wire the webhook to call only this RPC for decision state changes after signature and session ownership validation. Notifications must be non-critical and outside the transaction or emitted through a transactional outbox.
8. Keep provider event ID handling compatible with the configured Didit payload version. Do not assume event_id exists or is globally unique until confirmed against provider documentation and captured test payloads.

## Required tests before rollout
- SQL integration tests on a disposable database created from the project's migration chain.
- Concurrent duplicate delivery: exactly one state transition, repeat returns idempotent success.
- Same event ID with a different digest: rejected.
- Stale session, missing profile, zero verification rows, and multiple matching verification rows: no state changes.
- Failure injected between profile and verification update: transaction rolls back all changes and event claim.
- Each supported status and retry-limit boundary.
- ACL test under anon, authenticated, and service_role.
- Webhook contract tests and npm run typecheck.
- No production migration until the disposable-database tests and actual provider event schema are confirmed.

## Explicit non-actions
No migration has been applied, no live database queried, no webhook behavior changed, and no commit/push/deployment made as part of this note.
