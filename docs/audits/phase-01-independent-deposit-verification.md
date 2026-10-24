# Step 19 — Independent deposit verification audit

Branch reviewed: `fix/phase-01-fail-closed-deposit-webhooks`
Primary source: `src/jobs/depositIngestion.ts` (reviewed through GitHub file API).

## Executive finding
**Deposit processing is not production-ready.** The ingestion worker performs some provider/chain queries, but several paths pass confirmation values to `process_deposit_atomic` without proving the exact deposit output/event is valid and sufficiently confirmed. The webhook signature hardening does not close these accounting risks.

## Findings

### Critical — provider-supplied or coarse confirmation values reach the credit RPC
- BTC scanner maps a provider's `tx.status.confirmed === true` to a hardcoded `2` confirmations. It does not calculate current tip minus the transaction's block height. The pending recheck repeats the same `confirmed ? 2 : 0` behavior.
- LTC scanner maps `confirmed === true` to `6` confirmations, and pending recheck also uses `6`. This conflicts with the previously selected policy of **12 independently verified LTC confirmations**.
- The BlockCypher webhook passes the provider-reported `confirmations` value to the RPC; it is not independently verified there.
- EVM and TRON scanners derive depth from provider tip/block data, but no unified independent confirmation gate is enforced before invoking the credit RPC. The database RPC's behavior must be reviewed against the deployed implementation.

**Required fix:** make a single, server-side policy gate compute depth from a trusted chain source, require the configured threshold for each chain, and make the database credit routine independently enforce or consume a trusted verification result. Do not let webhook-supplied confirmation counts authorize credit.

### Critical — pending recheck does not re-verify the exact output/event
- BTC/LTC pending rechecks query transaction status, then call the credit RPC with the previously stored destination and amount. The code shown does not re-fetch and compare the exact output index, script/address, and value for the stored deposit identity.
- EVM pending recheck fetches a transaction receipt and current height, but the reviewed code does not validate receipt success or prove that the exact stored token Transfer log has the expected contract, log index, recipient, and amount before re-submitting stored fields to the RPC.
- TRON pending recheck queries transaction information and confirmation height, but the path needs explicit exact-event revalidation before credit.

**Required fix:** re-fetch canonical transaction/output/receipt/log by transaction identity and output/log index, verify chain/network, block canonicality, recipient, asset/contract, exact integer base-unit amount, successful execution, and confirmation threshold. Treat mismatches, unavailable providers, reorgs, or ambiguous results as pending/quarantined—not creditable.

### High — confirmation refresh is not an independent source of truth
The refresh worker trusts previously stored `onchain_deposits` fields such as destination and amount when retrying the credit RPC. Reconfirmation must be tied to a fresh chain proof for the same transaction output/event, not just transaction status.

### High — EVM webhook network/contract guard is incomplete as a trust boundary
The Alchemy route now checks a declared network when present and checks the canonical USDT contract for USDT activity. The event's declared network can be absent, and the route still calls the RPC based on webhook fields. HMAC authenticates the provider request but does not independently prove canonical inclusion, transaction success, confirmations, or reorg safety.

### High — native/token asset parsing requires exact chain-specific validation
The Alchemy route derives asset/network from webhook item fields and the token contract mapping. Before any credit, verify the chain ID and native asset or token transfer on chain, use integer base units for amounts, and reject assets/networks that are not explicitly configured.

### Medium — scan/recheck reporting may overstate credits
Several scanner paths increment their local `credited` counter if the RPC returns `status === 'credited'` or a success flag combined with a local confirmation comparison. Counters should reflect the canonical RPC's explicit accounting result only and must not be interpreted as proof that the chain event was independently verified.

## Proposed remediation order
1. Establish a canonical verification service per network and define chain thresholds, including LTC = 12 as previously selected.
2. Verify exact BTC/LTC UTXO output index, script/address, value, transaction inclusion and computed confirmations.
3. Verify EVM transaction receipt success, chain ID, canonical block, and exact token Transfer log/contract/index/recipient/value; verify native transfers from transaction and receipt.
4. Verify TRON transaction success, exact event/contract/recipient/value, canonical block and confirmations.
5. Make the database credit path reject unverified events and enforce idempotency on chain + transaction hash + output/log index.
6. Add mocked unit tests for unconfirmed, reorged, wrong-recipient, wrong-contract, wrong-amount, failed receipt, wrong-chain and duplicate events.
7. Run tests/typecheck/lint/build in CI and run provider fixtures in isolated staging.

## Scope and limitations
This is a source-level audit, not an executed integration test. The deployed `process_deposit_atomic` database function must be re-inspected before changing callers. Do not apply SQL changes to production, and do not credit or alter live financial rows during validation.
