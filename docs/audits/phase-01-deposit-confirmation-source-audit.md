# Deposit confirmation-source audit — Phase 01 Step 10

**Status:** Source-level audit only. No code or database behavior was changed.

## Scope reviewed

Reviewed the current draft implementations of:
- `src/app/api/webhooks/alchemy/route.ts` (draft PR #34)
- `src/app/api/webhooks/blockcypher/route.ts` (draft PR #35)
- `src/app/api/webhooks/litecoin/route.ts` (draft PR #36)
- Deployed `public.process_deposit_atomic` function definition through read-only catalog access.

## Findings

### 1. Confirmation values are not independently verified — critical financial-integrity gap

- Alchemy passes `p_confirmations: 12` as a constant. This is not a value read from an independently verified chain state. It can make an activity appear to satisfy the function's threshold even if the webhook has not demonstrated that the transaction reached 12 confirmations.
- BlockCypher passes the `confirmations` value from the webhook body.
- Litecoin passes `body.confirmations` from the webhook body.
- The deployed RPC consumes `p_confirmations` and computes effective confirmations from caller-supplied and stored on-chain values; no independent node/provider confirmation lookup is performed inside this RPC.

**Required remediation:** Do not let a webhook-supplied integer alone authorize crediting. Obtain transaction status, block inclusion, canonical height, and confirmation count from a trusted chain source (or a separately authenticated verifier) before calling the crediting RPC. Re-check/reconcile confirmations after reorg-sensitive changes.

### 2. Alchemy output identity is hard-coded

The Alchemy route passes `p_output_index: 0` for every activity. That is not necessarily a stable unique identity for ERC-20 transfer events, where a transaction can include multiple relevant logs/transfers. It can cause collisions or incorrect deduplication when more than one deposit event occurs in a transaction.

**Required remediation:** Use the provider's actual stable event/log index if available and verify its semantics. If the event schema cannot supply a reliable index, resolve logs from canonical chain data and derive the identity from the transaction hash plus log index. Never assume zero.

### 3. Litecoin confirmation threshold mismatch remains unresolved

The deployed RPC's LTC policy is 6 confirmations; the repository migration's LTC policy is 12. Alchemy's hard-coded 12 does not resolve the Litecoin policy conflict. A single policy should be explicitly approved and tested per chain/asset.

### 4. Payload validation is not chain validation

Address/hash/amount shape checks are useful, but they do not prove:
- transaction inclusion on the intended chain,
- the transfer is successful and not reverted,
- the recipient/value/token contract match canonical chain data,
- the supplied block is canonical and not orphaned,
- the confirmation count is correct.

For EVM deposits, validate receipt success and exact native/token transfer details from canonical transaction/receipt/log data. For BTC/LTC, validate the canonical transaction/output and its current inclusion/confirmation state.

### 5. Provider callback compatibility remains a separate blocker

The authentication headers/secrets expected by the webhook routes still require verification against each provider's supported configuration or a trusted signed gateway. Do not weaken authentication to accommodate a provider.

## Recommended safe order

1. Confirm chain-specific confirmation policy (including LTC: 6 or 12).
2. Decide trusted confirmation source for each chain.
3. Define canonical event identity: BTC/LTC transaction hash + output index; EVM transaction hash + event/log index for token transfers and an explicitly defined identity for native transfers.
4. Implement a verifier that supplies verified chain facts, not webhook claims.
5. Update the atomic RPC contract only if necessary, preserving the deployed signature until a versioned transition is tested.
6. Test isolated staging using synthetic fixtures for pending/confirmed/reorged/replayed/conflicting events and duplicate logs/outputs.
7. Only then prepare production rollout and rollback plans.

## Verification performed

This review compared the draft route source and the deployed function definition. No real provider webhook was sent, no live coin or blockchain transaction was tested, no production financial rows were queried, no production SQL was changed, and no merge/deployment occurred.
