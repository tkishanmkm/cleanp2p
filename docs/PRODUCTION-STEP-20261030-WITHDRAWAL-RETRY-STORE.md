# Paxones Production Audit — Withdrawal Retry Store

**Step:** 177
**Status:** Helper implemented and unit-tested; integration into the wallet context is not yet complete.

## Change

Added `src/lib/withdrawal-idempotency-store.ts`.

- Derives a SHA-256 digest of user ID + intent fingerprint for the browser storage key.
- Does not place the raw destination, amount, or user ID in the storage key.
- Persists a generated idempotency key in localStorage so it can be reused after a reload.
- Uses the Web Locks API where available to serialize same-origin key creation/cleanup.
- Fails closed if browser storage cannot be accessed.
- Clears a key only when the caller provides the exact expected key after a definitive successful response.
- Does not expire unresolved keys automatically; expiration could cause a new key to be generated for a previously accepted request.

## Tests

Added `tests/withdrawal-idempotency-store.test.ts`.

Validated:
1. Same user and intent reuse the same key.
2. Different user or changed intent produces a different key.
3. Storage key does not contain the raw user ID or intent.
4. Cleanup only removes the matching expected key.
5. Missing browser storage fails closed.

Result: **5 passed, 0 failed**.

TypeScript validation: `npx tsc --noEmit` exited successfully.

## Explicit limitation

The helper is **not yet wired into** `src/context/wallet-context.tsx`. Therefore, current withdrawal behavior must not be described as reload-safe based on this step alone. The in-memory map remains in the active flow until a focused integration change and end-to-end retry tests are completed.

Web Locks are not universally supported; where unavailable, localStorage persistence is present but same-intent cross-tab key creation is not guaranteed to be atomic. Server-side idempotency remains essential.

## Safety

No production database change, migration, real transfer/withdrawal, commit, push, deployment, or GitHub Actions minutes were used.
