# Phase 01 Step 15 — Wallet RPC caller and webhook authentication trace

**Scope:** Static review of selected app routes and the shared withdrawal service on `main`. This is an audit finding report, not a code fix.

## Files inspected
- `src/app/api/withdrawals/request/route.ts`
- `src/app/api/wallet/withdraw/route.ts`
- `src/app/api/withdraw/route.ts`
- `src/lib/services/withdrawalService.ts` (authentication/profile/2FA gates)
- `src/app/api/wallet/deposit/route.ts`
- `src/app/api/webhooks/deposit/route.ts`
- `src/app/api/webhooks/deposits/route.ts`
- `src/app/api/webhooks/alchemy/route.ts`
- `src/app/api/webhooks/blockcypher/route.ts`
- `src/app/api/webhooks/litecoin/route.ts`

## Findings

### Critical — provider webhook routes are not consistently authenticated
1. `src/app/api/webhooks/blockcypher/route.ts` parses a JSON body and invokes the privileged `process_deposit_atomic` RPC without any webhook authentication check in the inspected route.
2. `src/app/api/webhooks/litecoin/route.ts` likewise accepts a payload and invokes the privileged deposit RPC without checking a signature or shared secret.
3. `src/app/api/webhooks/alchemy/route.ts` verifies HMAC only when `SYSTEM_CONFIG.secrets.webhook` is truthy. If the secret is absent/empty, the inspected code proceeds without signature verification.
4. `src/app/api/wallet/deposit/route.ts` rejects an incorrect Bearer token only when `BLOCKCHAIN_WEBHOOK_SECRET` is configured. If that environment variable is missing/empty, the inspected route does not require authentication. The route accepts caller-supplied user/address/amount/transaction details and then calls the privileged RPC with a hard-coded 12 confirmations.

These are high-risk because the routes use the Supabase admin client and can attempt to credit user deposits. The canonical RPC may perform additional validation, but that does not make unauthenticated ingestion safe. Treat these endpoints as potentially exploitable until their deployed configuration and complete RPC validation are independently verified. Disable or network-restrict unauthenticated routes immediately through the normal incident/change process; do not rely on secret configuration being present without fail-closed code.

### High — one deposit webhook is fail-closed, but has alternate auth and identity risks to verify
`src/app/api/webhooks/deposit/route.ts` fails closed if no webhook secret is configured and checks either a direct ingest secret header or HMAC. However, direct-header comparison uses `crypto.timingSafeEqual(Buffer.from(ingestHeader), Buffer.from(secret))` without checking equal buffer lengths first; different lengths can throw and produce a 500. Also, this route normalizes a provider event and passes a caller/provider-supplied confirmation value in some branches or a hard-coded 12 in another. Confirmation claims must not be treated as independently verified chain confirmations.

### Positive control — withdrawal request routes delegate to a shared server-side gateway
The three inspected withdrawal request routes delegate to `executeCanonicalWithdrawal`. That service resolves a user from a bearer token via Supabase Auth or from the cookie session, then checks profile restrictions, KYC, password-change hold, pending-approval lockout, and conditional 2FA before proceeding. The inspected portion does not use a client-supplied user ID as the withdrawal owner. This is a useful control, but not proof of end-to-end safety: the remainder of the service, final RPC contract, idempotency behavior, and production grants still require verification.

## Required follow-up before any fix is considered complete
1. Fail closed on every webhook route if the required provider secret/signature is absent; remove or tightly restrict legacy generic deposit routes.
2. Validate provider-specific signatures against the exact raw request body and provider documentation; avoid accepting generic headers as equivalent credentials without an explicit contract.
3. Independently query the blockchain/provider API for transaction inclusion, canonical output/log index, recipient, asset/contract, amount, block hash, and confirmation depth before crediting.
4. Reject unknown or malformed event types, transactions, hashes, indices, amounts, networks, and assets; do not default missing output/log index to zero.
5. Add rate limits, replay protection, event idempotency, minimal error responses, structured security logging, and alerting.
6. Add tests proving missing/invalid secrets cannot reach the deposit RPC; test wrong-length header values, duplicate callbacks, conflicting payloads, and concurrent events.
7. Trace all other wallet/worker routes and verify the deployed RPC definition, owner, grants, and schema contract before staging tests.

## Verification limits
- Static source review only; no exploit request was sent and no RPC was invoked.
- No environment secrets or production financial rows were read.
- No database SQL, staging migration, production change, merge, or deployment was performed.
- This does not certify production readiness.
