# Step 35D — Confirmation worker audit

## Findings

The authenticated worker route calls `runConfirmationsWorker()`, and `/api/cron/confirmations` aliases the same handler. The indexer and deposit-worker routes call `runDepositIngestion()` separately.

The confirmation worker queried pending `onchain_deposits` and passed data to the privileged credit RPC. Issues included reuse of stored confirmations when chain lookup failed, incomplete EVM transfer verification, fixed BTC/LTC confirmation values, a TRON fallback confirmation value, and conversion of deposit amounts through JavaScript `Number`.

## Change on proposal branch

`src/jobs/confirmationsWorker.ts` now fails closed: it no longer calls the deposit-credit RPC. It reports pending rows as `NOT_CREDITED_REQUIRES_CANONICAL_VERIFIER` or `NOT_CREDITED_CHAIN_LOOKUP_UNAVAILABLE`. Stored confirmations cannot authorize credit when chain lookup fails. Removed the now-unused contract import.

Branch: `fix/retire-unverified-deposit-entrypoints`
- Worker change: `11703b08259bc60110e8ed89b26e81588ccfc352`
- Import cleanup: `56c54f30dc721bbbbce0b97c249436184c9b83be`
- Verified current file blob: `678ca8b7374e63a2e0d1ddd2f39d07866f0f0dd8`

## Verification and risk

Read the updated file back from GitHub; confirmed no `process_deposit_atomic` call remains and fail-closed statuses are present. No tests/build/deployment or production DB changes were performed. This intentionally stops this worker from crediting deposits and may delay deposits if the system currently depends on it. The separate `runDepositIngestion()` path still needs full validation. Do not merge/deploy until a replacement has been tested in a schema-faithful staging environment.

## Next step — 35E

Audit the remaining `runDepositIngestion()` path, then create and run focused tests for canonical transaction evidence, confirmation counts, exact amounts, replay/concurrency and provider failures. Production remains NOT READY.