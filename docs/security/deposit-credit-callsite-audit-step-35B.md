# Step 35B — Deposit credit call-site audit and diagnostic-route retirement

## Critical finding

In branch `fix/retire-unverified-deposit-entrypoints`, `src/app/api/verify-tron-only/route.ts` exposed an unauthenticated GET handler that used the server-side Supabase admin client to call `process_deposit_atomic` twice with hard-coded target identifiers, a hard-coded amount of 1000 USDT, a fabricated sender, a test provider label, and `p_confirmations: 20`. It then queried and returned user wallet/deposit/ledger records. This is a dangerous financial side effect on a diagnostic GET route and could disclose sensitive database records if deployed as written.

## Fix made on proposal branch

Replaced that route with a fail-closed HTTP 410 response and removed all service-role database access and deposit RPC calls from it.

- Branch: `fix/retire-unverified-deposit-entrypoints`
- Commit: `e45659191c447323b916dd227c9a028d9950b7c8`
- File: `src/app/api/verify-tron-only/route.ts`
- New blob: `6bac638c3ed3c0a5d6acbbf8e5bed14937508583`

This is a GitHub branch change only. It is not deployed and must not be described as a production fix until merged/deployed through the approved process and runtime behavior verified.

## Canonical deposit RPC call sites found

- `src/jobs/depositIngestion.ts`: pending-deposit refresh verifies EVM transaction/receipt, canonical block, token transfer log/contract/destination, or native transfer destination and exact amount before calling `process_deposit_atomic`. Legacy scanner paths are set to reject unverified credit.
- `src/jobs/confirmationsWorker.ts`: calls `process_deposit_atomic` after `fetchOnChainConfirmations`; review shows it initializes confirmation state from stored values and falls back to previous confirmations when on-chain fetch returns no data. It passes amount via `Number(deposit.amount)` and does not itself perform the same complete receipt/event verification visible in `depositIngestion.ts`. This is a second credit path and should be disabled or rewritten to use the same verifier before any release.
- Additional service-role crediting RPCs exist in the live database (`credit_deposit_atomic`, `ingest_and_credit_deposit`, several `process_user_deposit` overloads, `credit_confirmed_deposit`, `credit_onchain_deposit`, `process_deposit`, and `process_incoming_deposit`). Their application call sites and exact live bodies are not yet fully traced; do not revoke or drop them until callers and financial effects are mapped.

## Safety status

No production database, production code, secret, or deployment was changed. The retired route change is unmerged and untested at runtime. The live database still trusts caller-influenced confirmation values in the canonical credit RPC. Deposits remain NOT READY for production.

## Next step

Trace every other route and worker that can invoke a crediting RPC, especially `confirmationsWorker.ts` and legacy deposit verification/recovery endpoints. Then consolidate to one independently verified credit path and test forged confirmations, arbitrary amounts/destinations, replay, concurrency, and rollback before staging validation.
