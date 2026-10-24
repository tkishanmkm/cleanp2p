# Step 32 — Deposit Address Identity Boundary Audit and Fix

Date: 2026-10-14
Branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: source-level review and draft-branch changes only. No production database calls or financial rows were accessed.

## Finding

Two deposit-address API routes allowed caller-controlled identity to be treated as the target user when no valid Supabase session was established:

- `src/app/api/wallet/deposit-address/route.ts` trusted the `x-user-id` request header before verifying a Supabase token, and then fell back to a `user_id` query parameter.
- `src/app/api/wallet/deposit-addresses/route.ts` accepted a `user_id` query parameter when session authentication failed. It also returned deterministic preview addresses to unauthenticated requests.

This was an identity/authorization flaw: a caller could request address data or trigger address derivation for a different user by supplying their ID. These endpoints do not themselves prove or credit an on-chain deposit, but wrong-user address disclosure/derivation can compromise account privacy and deposit routing.

## Draft-branch fix

1. Removed trust in `x-user-id` and removed the `user_id` query-parameter fallback from the singular endpoint. Identity must come from a verified bearer token or Supabase cookie session; otherwise it returns HTTP 401.
2. Removed the `user_id` query-parameter fallback and unauthenticated deterministic-address preview from the plural endpoint. Unauthenticated requests now return HTTP 401.
3. Added `tests/deposit-address-auth-required.test.ts` with source assertions covering the removed fallbacks and required authentication.
4. Registered the test as `npm run test:deposit-address-auth-required`.

## Validation and limitations

- Changes are committed to the draft remediation branch only.
- The source assertions were added but have not been executed in this environment.
- No runtime integration tests, typecheck, lint, or production build were run.
- Existing callers that relied on `x-user-id`, query-string `user_id`, or unauthenticated preview responses may now receive HTTP 401 and should be checked during integration testing.
- This is not a complete repository-wide proof that all legacy credit-function callers have been identified. Dynamic RPCs, database dependencies, Edge Functions, and external schedulers still need further review.

## Safety status

No production SQL, grants, configuration, financial rows, merge, or deployment changed. Deposit crediting remains paused pending independent chain-event verification. The platform is not yet production-ready.
