# Step 34T — Isolated deposit staging test specification

Status: design/specification only. No staging branch/project was created; no live SQL, secrets, roles, balances, provider settings, or deployments were changed.

## Decision

Do not wire the existing Node HMAC helper into the live deposit-credit flow. It is a canonicalization/test helper, not an authorization boundary. The existing service-role credential can execute the credit RPC and is not an acceptable verifier-only identity if it can also read the signing secret.

## Required architecture property

The system must enforce this security invariant:

> Possession of the ordinary application/service-role credential alone is insufficient to fabricate deposit evidence and credit a user.

A candidate architecture is acceptable only if it can prove this invariant with negative tests. A separate Edge Function using the same service-role credential does not meet it. Do not create a new database role and assume isolation without proving that ordinary credentials cannot assume that role or invoke its privileged credit interface.

## Staging isolation gate

Before creating a Supabase development branch or project:
- Obtain and communicate the actual cost using Supabase's cost tool; do not create it until the user confirms cost understanding.
- Verify staging does not copy production data and does not inherit usable production provider credentials, hot-wallet keys, callback URLs, or scheduled jobs.
- Use synthetic wallets/addresses and testnet-only provider endpoints; disable any external side-effecting schedulers until reviewed.
- Record the staging project/branch identifier and its separation from production.
- Never run the proposed SQL against production as a substitute for staging.

## Mandatory test matrix

| Area | Test | Required result |
|---|---|---|
| Trust boundary | Call credit interface with ordinary service-role credential and forged evidence | Rejected; no balance/ledger/deposit state changes |
| Signature | Valid signed attestation | Accepted only through dedicated verifier path |
| Signature | Alter each signed field: user, address ID, network, asset, contract, tx hash, output/log index, block hash, raw amount | Rejected |
| Time | Expired or implausibly future-issued attestation | Rejected |
| Replay | Reuse same nonce | Second attempt rejected |
| Duplicate | Repeat same chain output/log concurrently | Exactly one credit and one deposit ledger effect |
| Identity conflict | Same chain output retried for a different user, asset, amount, destination, or index | Rejected and security-audited |
| Chain finality | Insufficient confirmations | No credit |
| Reorg | Canonical block changes before finality | No credit; pending state corrected safely |
| Evidence | Failed EVM receipt, wrong token contract, wrong Transfer log, wrong recipient, mismatched raw amount | Rejected |
| UTXO | Wrong vout or output value; duplicate txid/output | Rejected |
| Atomicity | Force failure after one write in the credit transaction | All balance/ledger/deposit writes roll back |
| Availability | Verifier/provider timeout | Fail closed without losing the pending deposit; retry safely |
| Key rotation | Old/new key overlap and revoked key | Only explicitly permitted key versions accepted |
| Authorization | User JWT, anon key, ordinary route, webhook, scheduler call credit interface directly | Rejected unless it is the authenticated and isolated verifier path |
| Operations | Old retired endpoints and current worker/scheduler inventory | No caller is silently left unable to submit legitimate deposits |

## Evidence to capture

- Exact migration diff and generated SQL; code review before execution.
- Test output with synthetic identifiers only.
- Before/after wallet balance, deposit row, on-chain deposit row, and ledger row counts/values for each negative test.
- Concurrency test demonstrating one ledger credit.
- Logs showing rejected forged attempts without leaking secrets or raw sensitive provider payloads.
- CI result for focused tests, typecheck/build, and integration tests.
- Rollback procedure and an explicit operational decision for pending deposits during cutover.

## Current repository test limitations

The proposal branch contains `src/security/depositAttestation.ts`, nine Node tests, and a GitHub Actions workflow. The tests/workflow have not been confirmed executed successfully. Passing those unit tests would validate HMAC helper behavior only; it would not establish database authorization, secret isolation, chain correctness, or atomic financial behavior.

## Exit criteria

Do not mark deposits production-ready until the trust-boundary negative test, chain-evidence tests, replay/concurrency tests, atomicity checks, CI, and staging rollout/rollback review all pass. Production deployment requires a separate reviewed migration and explicit rollout plan.
