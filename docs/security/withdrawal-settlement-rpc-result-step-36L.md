# Withdrawal Settlement RPC Result Validation — Step 36L

## Audit
The production `public.complete_onchain_withdrawal(uuid,text,numeric,text)` definition returns JSONB with an explicit `success: true` on successful settlement. Previously, the worker incremented its confirmed count whenever the RPC returned no transport/database error, without inspecting the JSON result.

## Fix applied on branch
Updated `src/jobs/withdrawalWorker.ts` so all four settlement call sites (TRON, EVM, BTC, LTC) now:
- log an RPC error if one is returned;
- count settlement as confirmed only when the response is an object with `success === true`;
- log unexpected/empty responses and leave the item for reconciliation rather than reporting success.

## Scope and verification
- Branch: `fix/retire-unverified-deposit-entrypoints`.
- No production SQL/function changes and no wallet balances, withdrawal rows, or ledger entries changed.
- Worker file was re-fetched after commit to verify the guard is present at all four call sites.
- Build/typecheck/tests were not run; this is not production-readiness approval.
