# Step 18 — Webhook validation status

## Work completed
- Added `tests/webhook-auth.test.ts` and `npm run test:webhook-auth`.
- Reviewed the changed route sources and test script after the Step 17 changes.
- Corrected unused imports in the Alchemy and generic deposit webhook routes.
- Added an explicit Alchemy network guard when the payload declares a network.
- Added an Alchemy USDT contract-address check against the configured canonical ERC-20 USDT contract.

## Static source checks
11/11 focused source assertions passed for:
1. missing shared-secret configuration fails closed;
2. shared-secret comparison checks equal lengths before timing-safe comparison;
3. HMAC verification signs the exact raw body;
4. BlockCypher authentication precedes JSON parsing;
5. Litecoin authentication precedes JSON parsing;
6. Alchemy authentication is mandatory;
7. Alchemy USDT contract is checked against the canonical contract;
8. declared Alchemy network is restricted to ETH_MAINNET;
9. missing output/log indices are rejected;
10. legacy generic wallet deposit endpoint returns HTTP 410;
11. test file and npm test script are present.

These are source-text assertions only; they are not substitutes for compilation or executed tests.

## Validation attempt and blocker
Attempted to clone the PR branch to run Node/npm checks, but the execution environment could not resolve `github.com` (DNS/network unavailable). Therefore dependencies could not be installed and none of the following have been executed:
- `npm run test:webhook-auth`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

No successful build/test claim is made.

## Still required
- Run the commands above in a trusted local/CI environment with dependencies installed.
- Verify actual provider payload fixtures and whether each provider supports the configured authentication method.
- Test invalid and counterfeit USDT contracts, wrong networks, duplicate/replayed events, conflicting transaction identities, and malformed outputs.
- Independently verify on-chain transaction/receipt, canonical block, destination, asset/contract, amount, and confirmation depth before balance credit.
- Reconcile deployed RPC behavior and validate in isolated staging before any production release.

No SQL or database was executed, no production financial rows were queried or changed, and the branch remains a draft PR.
