# Step 32 — Verified Deposit Evidence Boundary Design

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Status: design only; not a migration and not production-ready.

## Findings verified on the draft branch

- The recursive Git tree contains 718 TypeScript/TSX/JavaScript/SQL files in total, including application API routes, workers, Supabase migrations, and an Edge Function.
- `src/app/api/workers/deposit-worker/route.ts` currently returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and an explicit no-crediting message.
- `src/app/api/cron/indexer/route.ts` also returns HTTP 503 and clearly reports that indexing/crediting is paused.
- `tests/deposit-worker-reports-paused.test.ts` asserts the paused response for both routes.
- Generic webhook route and alias are retired (HTTP 410).
- The connected GitHub code-search tool returned no indexed results for the eight known credit RPC names. Its search covers the default branch, not reliably this draft branch, so this does NOT prove there are no callers. A full content-level caller inventory remains incomplete.

## Required trust boundary

A credit operation must not accept confirmations, amount, recipient, token, network, transaction hash, or output/log index as trusted facts from a webhook, browser, cron request, or ordinary worker call. These fields must be obtained or independently verified by a trusted verifier against the chain.

### Proposed evidence record (design only)

A future verifier-owned evidence table should record at least:

- immutable chain/network identifier and asset identifier;
- transaction hash and exact output index (UTXO) or event/log index (account-based chain);
- canonical block hash and block height/number;
- successful transaction/receipt status where applicable;
- exact destination address and exact raw integer amount in base units;
- token contract/mint identity when applicable;
- verification timestamp and verifier version;
- confirmation/finality policy used and evidence status;
- a unique event key scoped to network + transaction + output/log index;
- consumed/credited state and a reference to the resulting ledger transaction.

Amounts must be stored in integer base units or a precision-safe numeric representation; floating point must not be used. The verifier should validate token decimals/contract identity and normalize addresses using chain-appropriate rules.

## Proposed credit API contract

A future database credit function should accept only an evidence UUID (and, if needed, an internal idempotency token). It must not accept caller-controlled amount, user ID, asset, recipient, transaction hash, or confirmation count.

Inside one database transaction it should:
1. lock the evidence row;
2. reject absent, unverified, stale, orphaned, consumed, or inconsistent evidence;
3. derive the credited user, asset, and amount only from the verified evidence and a server-controlled address/asset mapping;
4. enforce uniqueness on the exact chain event key;
5. lock the target wallet balance row;
6. insert a ledger entry and update balance atomically;
7. mark evidence consumed and link it to the ledger entry;
8. return the prior result for a valid retry without crediting twice.

The service role alone should execute the credit function; ordinary user roles and webhook callers must not be able to create or mark evidence verified. A service-role grant alone is not the trust boundary: only a verifier component with independently validated chain data may create verified evidence.

## Reorg and chain-finality policy

- Do not equate a caller-provided confirmation integer with chain proof.
- Define per-network confirmation/finality thresholds in one reviewed policy.
- Record block hash as well as height; re-check canonicality before credit where the chain model requires it.
- Define a ledger reversal/hold procedure for post-credit reorgs. Never silently delete or rewrite financial ledger history.
- For account-based tokens, verify the exact transfer event, contract address, recipient, and raw amount, not just the transaction receipt.
- For UTXO chains, verify the exact output index, script/address mapping, amount, and canonical transaction inclusion.

## Required tests before activation

1. Missing or forged evidence identifier is rejected.
2. Unverified or orphaned evidence cannot credit.
3. Wrong network, token contract, recipient, output/log index, or amount cannot credit.
4. Replaying the same event cannot double-credit.
5. Concurrent requests for the same evidence produce exactly one ledger credit.
6. Database failure between ledger/balance/evidence writes rolls back all effects.
7. Confirmation/finality threshold is evaluated from verifier-controlled chain data.
8. Reorg after credit triggers the reviewed hold/reversal workflow.
9. Authenticated/anon roles cannot execute privileged credit or mutate evidence status.
10. Existing legitimate wallet/ledger invariants and audit records remain consistent.

## Migration safety sequence

1. Finish the content-level caller inventory across this branch, including dynamic RPC names, SQL function-to-function calls, triggers, Edge Functions, CI/scheduler definitions, and external provider configuration.
2. Implement verifier and evidence writes in an isolated staging/local Supabase project.
3. Add the evidence-only credit function and adversarial tests.
4. Migrate each caller and prove no legacy path remains.
5. Prepare a separate SQL migration to revoke/retire legacy RPCs only after dependency review and staging validation.
6. Verify deployed function definitions, owners, SECURITY DEFINER settings, search_path, and effective grants after rollout.

## Safety status

No database objects, grants, financial rows, environment settings, merge, or deployment changed in this step. The report is a design proposal only. Deposits remain paused in the draft branch. The full caller inventory and runtime/build validation remain outstanding.
