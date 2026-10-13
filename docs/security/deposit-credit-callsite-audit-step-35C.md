# Step 35C — Remaining deposit routes audit and fail-closed proposal changes

## Findings

The remaining repository paths include multiple privileged credit routes that accepted externally supplied chain facts and forwarded them to `process_deposit_atomic`:

- `src/app/api/webhooks/alchemy/route.ts`: optional HMAC check only runs when the webhook secret is configured; trusts first activity item, numeric activity value, derived network, and hard-coded 12 confirmations. It does not independently verify canonical receipt/log and confirmations before credit.
- `src/app/api/webhooks/blockcypher/route.ts`: no request authentication was present; trusts payload outputs, satoshi value, block height and caller-supplied confirmations.
- `src/app/api/webhooks/litecoin/route.ts`: trusts payload amount and confirmation values.
- `src/app/api/internal/chain-ingest/route.ts`: checks a shared secret but then trusts the submitted amount, destination, network and confirmation values. Secret possession does not prove transaction inclusion or confirmation state.
- `src/app/api/verify-deposit-recovery/route.ts`: unauthenticated GET triggers ingestion and returns wallet/deposit/ledger records for hard-coded identifiers. This was a diagnostic with financial side effects and data exposure risk.
- `src/jobs/confirmationsWorker.ts`: remains a second crediting caller with fallback to stored confirmations when the chain lookup returns no data, and converts amount through JavaScript Number. It is not retired in this step because the worker may be the only active path for pending deposits and must be replaced/consolidated with verified processing first.

## Proposal-branch changes made

Each of the five risky routes now fails closed with HTTP 410 and no longer invokes privileged database RPCs:

1. `src/app/api/verify-deposit-recovery/route.ts`
2. `src/app/api/webhooks/blockcypher/route.ts`
3. `src/app/api/webhooks/litecoin/route.ts`
4. `src/app/api/webhooks/alchemy/route.ts`
5. `src/app/api/internal/chain-ingest/route.ts`

Together with the prior Step 35B change to `src/app/api/verify-tron-only/route.ts`, six legacy/diagnostic entry points are retired on this proposal branch.

## Commits in this step

- Recovery diagnostic: `bd094b681fb4576d5ae3174e7cd034ed23ddcb77`
- BlockCypher webhook: `156d06984eb87951e987e9cbd4af16bdce639ffe`
- Litecoin webhook: `ec7b7c6863b1bf33a7b4e8c13b96ba7868e76ea7`
- Alchemy webhook: `52799ec1a04eafe4efc92af9b792ccd24322b7c9`
- Internal chain ingestion: `86bc0b5dd23b1de251e7466d2f2e4f53f364fda6`

## Operational warning

These changes are on `fix/retire-unverified-deposit-entrypoints` only, are not deployed, and have not had runtime/integration tests. If these routes are currently configured with providers or external workers, merging before a verified replacement exists will interrupt those ingestion paths. Do not merge/deploy this branch as-is without first identifying the live provider configuration and testing the replacement flow.

No production Supabase database changes were made. The database credit RPC still trusts caller-influenced confirmation values, and `confirmationsWorker.ts` remains an unresolved alternate path. Deposit production readiness remains **NOT READY**.

## Next step — 35D

Trace the worker route and scheduler entry points, inspect `confirmationsWorker.ts` and every provider integration, and establish the single intended verified ingestion path. Build/execute tests in a schema-faithful staging database before any production rollout.
