# WAYONES Step 01 - Wallet custody architecture audit

**Date:** 2026-11-18
**Repository:** `tkishanmkm/cleanp2p` only
**Audited code branch:** `fix/production-typecheck-batch-1`
**Audited code commit:** `79bda6c6d740b489942250d6417902f7cc52f883`
**Step status:** Architecture audit completed; remediation remains in subsequent wallet steps.
**Database mutations:** None.
**On-chain transactions:** None.

## 1. Scope and limits

This step maps WAYONES wallet custody, HD address derivation, sweeping and withdrawal signing paths for ETH, USDT ERC-20, USDT BEP-20, USDT TRC-20, BTC and LTC. It is a source/configuration and read-only staging catalog review, not a penetration test, proof of production deployment, cryptographic key ceremony, or production database attestation.

No secret values, mnemonic, private keys, service-role keys or provider credentials were read. The audit does not establish whether the documented environment variables are populated in any deployed runtime.

The local checkout was already dirty before this audit. Existing changes, untracked migration files, drafts and local branches were preserved and were not staged or overwritten.

## 2. Executive assessment

**Wallet custody is not ready for production launch.** The principal risk is that the application worker process both has access to high-value signing material and constructs/signs transactions. A compromise of that process can therefore cross the boundary between application control and custody control.

The implementation does have valuable safeguards: a standalone xpub-only derivation helper fails closed when required public derivation keys are missing, although the active provisioning routes currently use the mnemonic-based engine; the canonical EVM/Tron withdrawal paths persist signed payloads before broadcasting; withdrawal nonce and worker-lease records provide durable coordination; and receipt reconciliation validates chain identity and payout evidence. These controls improve reliability and replay resistance, but do not substitute for an independently enforced signer policy.

### Findings

| ID | Severity | Finding | Evidence / impact |
|---|---|---|---|
| W01-01 | High; potentially Critical if the master seed is present in a broadly privileged runtime | The sweeper derives customer child private keys from `DEPOSIT_HD_MNEMONIC` in the worker process. | `src/jobs/sweeperWorker.ts` derives EVM, TRON, BTC and LTC child private keys in-process. The TRON and BTC sweep routines call this helper and use the child key to sign. In addition, authenticated provisioning routes call `getOrDeriveUserDepositAddresses()` in `src/lib/hd-derivation-engine.ts`, which loads and caches the master HDKey in the ordinary API process. A compromise of either runtime could expose the master seed or its customer child-key hierarchy, with a potentially very large custody blast radius. Actual secret presence and deployment scope were not inspected. |
| W01-02 | High | Hot-wallet signing keys are loaded into application-process memory. | `src/lib/blockchain/providers.ts` creates an `ethers.Wallet` from `HOT_WALLET_PRIVATE_KEY` / `EVM_HOT_WALLET_PRIVATE_KEY`; `src/lib/blockchain/tron.ts` creates a signed TronWeb instance from environment keys. The canonical workers call these local signers. Environment-variable storage alone is not an independent signer boundary. |
| W01-03 | High | The signer does not yet constitute an independent transaction-policy enforcement boundary. | EVM transaction construction and signing occur in `src/jobs/withdrawalWorker.ts`; TRON signing occurs through `prepareSignedTrc20Transfer()`. Persisting signed bytes before broadcast is good, but the same application trust domain can prepare the intent and perform the signing. A compromised worker/backend can potentially manipulate both. |
| W01-04 | High / launch blocker | The canonical withdrawal queue has no BTC or LTC broadcast branch. | `processWithdrawalQueue()` implements TRON and EVM dispatch branches. BTC/LTC confirmation checks exist later, and legacy BTC/LTC direct-signing helpers exist in `src/lib/withdrawal-processor.ts`, but no active call from the canonical queue to those helpers was found. BTC/LTC withdrawals are therefore not verified as operational in the active path. |
| W01-05 | High; environment-specific | The connected healthy Supabase staging catalog exposed legacy SECURITY DEFINER routines to `anon` and `authenticated`. | Read-only catalog review showed public EXECUTE grants for functions including legacy nonce allocation, deposit crediting/ingestion and withdrawal settlement/refund functions accepting caller-supplied IDs or values. The function bodies inspected did not show a caller authorization guard before some financial mutations. This is a staging finding only; it is not asserted as the production catalog state. |
| W01-06 | High / design conflict | A local pending migration encodes hot-wallet-only custody and disallows a cold-storage role. | `supabase/migrations/20261028123000_enforce_hot_wallet_only.sql` (untracked in the pre-existing worktree) limits platform wallet roles to hot wallet, fee collector and escrow pool. That conflicts with the requested tiered/cold custody architecture. The file was not changed, applied or committed. |
| W01-07 | Medium / containment required | Older direct-signing code remains in the source tree. | `src/lib/withdrawal-processor.ts`, `src/lib/wallets/evmWithdrawal.ts` and `src/lib/p2p/escrowService.ts` include direct private-key signing/broadcast paths. The old withdrawal dispatch route returns HTTP 410, and no active imports/callers from the inspected `src` call graph were found for the legacy processor/escrow service. Retire or formally isolate these paths only after a complete repository/deployment reference check. |
| W01-08 | Medium / deployment mapping blocker | Supabase project identity and migration history are not aligned with a verified production target. | Local `supabase/.temp/project-ref` points to `eaiwgfxoiwxepinvcykg` (`paxonesflows`), which is inactive. The connected account also lists `tazvjyrdondcrdrkggqe` (`cleanp2p-staging`) as healthy. The staging project returned no migration records via Supabase tooling and no migration-history tables through the inspected information-schema query. Neither project was established as production. No migration was applied. |

## 3. Positive controls observed

- A standalone xpub-only helper exists in `src/lib/wallet-derivation.ts` and fails closed when configured xpubs are missing, but the helper has no active caller in the inspected application. The canonical address path calls `src/lib/hd-derivation-engine.ts`, which loads and caches the master HDKey from `DEPOSIT_HD_MNEMONIC` in the API server process. The xpub-only helper is therefore not currently an effective production custody boundary.
- `src/lib/supabase/service-role.ts` is server-only, validates a distinct service-role key and refuses browser use.
- The canonical EVM withdrawal path validates chain ID, reserves an operation-bound nonce, persists the exact signed transaction bytes before broadcast, and keeps funds reserved when broadcast outcome is uncertain.
- The canonical TRON withdrawal path prepares a signed payload, persists it before broadcast, then records broadcast state.
- Withdrawal confirmation code checks transaction/receipt evidence, expected sender, chain/token/destination/amount and canonical block/finality evidence before settlement where implemented.
- The old `/api/withdrawals/dispatch` endpoint returns HTTP 410; the old `/api/workers/sweeper` endpoint is also decommissioned with HTTP 410. This is useful containment of older bypass routes.
- `.env.example` documents `ENABLE_WITHDRAWALS=false` as the safe default until request, worker claim, broadcast, settlement and refund RPCs are aligned and validated. Preserve that default until all launch gates pass.

## 4. Recent exchange-attack lessons added to the threat model

1. **CoinDCX, October 2026:** the exchange's published incident update describes legacy/deprecated wallet infrastructure and an automatic-sweeper failure. WAYONES must treat sweep-health failure, deprecated-address activity and delayed consolidation as risk-state changes that can pause new crediting and treasury movement-not merely monitoring alerts. See [CoinDCX incident update](https://coindcx.com/blog/coindcx-news/on-chain-wallet-activity-update-21-oct-2026).
2. **Bitget, September 2026:** reporting describes backend transaction-data spoofing reaching wallet authorization. A signer must independently reconstruct and validate the raw transaction against an immutable, authorized intent; it must not trust only the backend's transaction preview or request fields. See [The Block report](https://www.theblock.co/news/markets/2026-09-24-more-than-170-million-in-crypto-moves-from-bitget-wallets-unidentified-address-416345).
3. **Binance, October 2026:** Binance's incident update describes misuse of an internal signing service and EIP-7702 delegation. The signer design must enforce operation, destination, asset, chain, amount, calldata and delegated-execution policies; incident containment must include pending transactions and revocation of unwanted on-chain permissions where relevant. See [Binance incident update](https://www.binance.com/en/square/post/384312159834579).

These incidents are design test cases, not evidence that the same exploit is present in WAYONES.

## 5. Step 1 remediation decisions and release gates

1. Keep `ENABLE_WITHDRAWALS=false` until all supported chains have an audited, tested canonical queue-to-signer-to-broadcast-to-settlement path.
2. Do not put the master deposit mnemonic in the general web/API worker. Design a separate, least-privilege derivation/sweep signing boundary; avoid sending raw child private keys back to ordinary application processes.
3. Move hot-wallet signing behind an isolated signer boundary with independent validation of immutable operation intent, chain ID, token contract, recipient, amount, fee cap, nonce/UTXO set and allowed transaction type. Enforce deny-by-default for arbitrary calldata and delegated execution such as EIP-7702 unless explicitly reviewed and allowed.
4. Separate deposit custody, risk quarantine, operational hot liquidity and offline/cold treasury. Reconcile the existing hot-wallet-only migration proposal with the required cold-storage model before applying it.
5. Complete BTC/LTC canonical withdrawal dispatch, signer intent, durable signed payload, broadcast recovery and finality tests before enabling those assets for withdrawal.
6. Retire or isolate unused direct-signing helpers only after a whole-repository and deployed-runtime call-graph review; do not delete code based only on a partial `src` search.
7. Verify the exact production Supabase project, its migration history and live function/table grants before preparing or applying financial DDL. The connected staging project is not a substitute for production.
8. Add negative tests for compromised worker behavior: forged destination/amount, arbitrary contract/calldata, wrong chain, excessive fee, signer/address mismatch, replayed nonce, replayed UTXO, expired lease, duplicate sweep, RPC equivocation, reorg, and a high-risk deposit discovered after sweep.
9. Implement the customer's stated Didit constraint later in the KYC phase: use only the user's 500 free verifications, no paid features/add-ons, with a hard usage ceiling and a fail-closed path when the free allowance is exhausted. No Didit quota was checked or consumed during Step 1.

## 6. Step 1 completion status

**Architecture inventory: completed.**
**Code fixes: not made in this step; the findings require signer/custody redesign and chain-specific follow-up work.**
**SQL fixes: not made; production Supabase target is unverified and staging catalog findings must not be applied to production blindly.**
**On-chain validation: not performed; no live financial transactions were initiated.**
**Production launch: blocked by W01-01 through W01-08 and the release gates above.**

Next planned wallet step: **Step 2 - Wallet generation and cryptographic key management**, including seed generation, BIP32/BIP39 validation, derivation-index collision and recovery, key lifecycle, and isolation design.