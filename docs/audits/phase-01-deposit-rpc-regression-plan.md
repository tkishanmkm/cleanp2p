# Deposit RPC regression plan — Phase 01 Step 7

Status: documentation only. No SQL migration, production mutation, merge, or deployment.

## Required release invariants

- Canonical identity is normalized network + transaction hash + output index.
- Replaying the same valid event cannot credit twice.
- Reusing the same identity with a changed user, amount, asset, network, destination, or token contract must fail closed with no balance or ledger mutation.
- Missing or conflicting rows across deposits, onchain deposits, and ledger must fail closed.
- Below-threshold confirmations cannot credit available balance.
- Confirmation policy must match across SQL, workers, and webhook routes. Provider-reported confirmation counts are not independent chain verification.
- Concurrent duplicate callbacks produce one credit only.
- Any ledger/state write failure rolls back the whole transaction.
- Only explicitly trusted callers can execute the privileged RPC.
- Client errors must not expose internal database details.

## Synthetic test matrix

| ID | Scenario | Expected |
|---|---|---|
| D-01 | New transaction below confirmation threshold | No available-balance credit |
| D-02 | Replay identical callback | One credit maximum |
| D-03 | Same transaction/output, changed amount | Reject; no mutation |
| D-04 | Same transaction/output, changed user or destination | Reject; no mutation |
| D-05 | Same transaction, distinct output index | Handle as distinct only if provider/schema supports it |
| D-06 | On-chain record exists but deposit row is missing | Fail closed |
| D-07 | Deposit row exists but on-chain record is missing | Fail closed |
| D-08 | Credited state with missing/duplicate ledger entry | Fail closed |
| D-09 | Concurrent identical callbacks | One credit |
| D-10 | Ledger write fails | Full transaction rollback |
| D-11 | Invalid/negative/oversized index or confirmations | Reject before mutation |
| D-12 | Network, asset, or token contract mismatch | Reject before mutation |
| D-13 | Unregistered destination address | Reject before mutation |
| D-14 | Browser role calls privileged RPC | Execute denied unless explicitly reviewed |
| D-15 | Confirmation value changes on replay | Never blindly trust callback; use trusted verification |

## Required preflight before a replacement function can be authored

1. Capture the deployed function signature, owner, security-definer setting, search path, and complete definition.
2. Capture columns, constraints, unique indexes, and grants for deposits, onchain_deposits, wallet_assets, wallets, user_deposit_addresses, and ledger_entries.
3. Compare every referenced table/column/index against the candidate SQL.
4. Reconcile the Litecoin confirmation threshold discrepancy (deployed function: 6; repository migration: 12) with an explicit policy decision.
5. Test the candidate in isolated staging with synthetic fixtures, replay/concurrency tests, and failure injection.
6. Prepare rollback instructions and obtain explicit approval before production execution.

This plan is not evidence that tests have run. Production schema/function mismatch remains unresolved. No live coin tests or production changes were performed.
