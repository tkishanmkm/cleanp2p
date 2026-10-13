# Withdrawal and Hot-Wallet Audit — Step 35Y

Date: 2026-10-14
Repository branch: `fix/retire-unverified-deposit-entrypoints`
Production Supabase project: `eaiwgfxoiwxepinvcykg`

## Summary

Live withdrawal RPC privileges and key implementations were inspected. No production permission changes were made in this audit step because the remaining issue requires a safer proof boundary, and a blanket permission change could disrupt legitimate worker settlement/refunds.

## Verified controls

- Sensitive withdrawal worker/settlement RPCs queried in production are not executable by `anon` or `authenticated` (including request, approve, complete, refund, nonce allocation, and worker-lock functions in the inspected set).
- `approve_withdrawal(uuid,uuid)` checks that the supplied admin UUID is present in `app_admins` or has admin role in `profiles`, locks the withdrawal row, only approves pending-approval states, updates the related on-chain row, and writes an audit log.
- Both inspected admin API routes call `verifyServerAdmin(req)` before calling the approval RPC.
- `complete_onchain_withdrawal` locks the withdrawal rows, rejects failed/cancelled/rejected terminal states, rejects a transaction hash already associated with a different on-chain withdrawal, checks withdrawal liability, and inserts an idempotent ledger entry.
- `process_failed_withdrawal` protects completed/cancelled states, locks the withdrawal row, prevents ordinary refunds when a tx hash is present, and moves ambiguous broadcasts to an alerting state rather than automatically refunding.

## Critical follow-up finding

`process_failed_withdrawal(..., p_is_verified_unbroadcast BOOLEAN)` uses a caller-provided boolean to bypass the transaction-hash refund guard. The current worker sets this flag both for local pre-broadcast validation errors and after provider responses indicate an on-chain revert. The database function itself does not independently verify the chain receipt or bind the proof to the exact stored transaction hash.

Although the RPC is restricted to the service role, the boolean is a weak trust boundary: any compromised or buggy privileged caller could request a refund for a withdrawal that already has a transaction hash. The safe design is a distinct revert-settlement path that binds the exact stored tx hash and chain/network, records verified receipt evidence, and makes the refund idempotent. Do not simply remove the boolean or blanket-revoke the worker RPC: either could leave real users' funds locked or break worker processing.

## Additional findings

- `execute_final_withdrawal` has two overloads. The inspected live privileges deny execution to `anon`, `authenticated`, and `service_role`, which is good containment; legacy bodies still warrant cleanup/review.
- Supabase Security Advisor continues to report 33 anon-executable SECURITY DEFINER warnings across the public schema. This is broader than the withdrawal routines and requires a separate function-by-function permission audit.
- No user balances or withdrawal records were modified in this audit.
- No build, automated tests, or end-to-end withdrawal simulations were run in this step.

## Recommendation

Implement a distinct verified-on-chain-revert settlement RPC and update the worker to pass proof tied to the stored transaction hash; add tests for successful payout, revert, timeout/ambiguous broadcast, duplicate callbacks, and concurrent refund attempts before enabling production withdrawals broadly.
