# WAYONES Step 03 - Address derivation integrity and legacy fallback containment

**Date:** 2026-11-18
**Repository:** `tkishanmkm/cleanp2p` only
**Branch:** `fix/production-typecheck-batch-1`
**Base commit:** `b99241b4fa9a82570c0d05e38e65b281baa0d1e6`
**Database mutations:** None
**On-chain transactions:** None
**Step status:** Code-level public derivation path implemented behind a disabled-by-default gate; production activation remains blocked pending key/address matching.

## 1. Scope

This step reviewed multi-chain BIP-32 public derivation and the older deposit-address helpers in:

- `src/lib/crypto/hd-derivation.ts`
- `src/lib/hd-wallet.ts`
- `src/lib/hd-derivation-engine.ts`
- `src/app/api/wallets/deposit-address/route.ts`
- `src/app/api/wallets/provision-address/route.ts`
- `src/app/api/internal/provision/route.ts`

No production mnemonic, private key, service key, xpub environment value, or customer wallet address was read.

## 2. Findings and decisions

| ID | Severity | Finding | Step 3 result |
|---|---|---|---|
| W03-01 | High | The prior generic xpub helper used HMAC-SHA512 of the literal xpub string as a fallback when BIP-32 derivation failed. That is not BIP-32 derivation and does not produce a guaranteed controllable wallet address. It also synthesized `addr_...` identifiers for generic assets. | **Removed.** The old `hd-wallet.ts` pseudo-address implementation was replaced with a small canonical provisioning wrapper. Unsupported assets now throw; no synthetic or generic address is returned. |
| W03-02 | High | Separate per-chain xpub fallbacks in the mnemonic engine could silently switch a failed chain derivation to another independently configured key source. That could mix roots or derivation scopes in a single deposit-address set. | **Removed.** Mnemonic-mode address derivation now uses one root and fails on derivation errors. It no longer silently falls back to individual xpubs. |
| W03-03 | High | The xpub-only derivation module did not implement the Litecoin account path, and account-level xpub scope was not enforced. | **Implemented.** Added Litecoin Native SegWit xpub derivation and required public account keys at BIP-32 depth 3, account child `0'`, with no private extended key input. |
| W03-04 | High | The xpub-only derivation module was not wired into the canonical address engine and could not be selected without reverting to mnemonic derivation. | **Implemented behind a feature gate.** `PUBLIC_XPUB_DERIVATION_ENABLED=true` selects the full four-account-xpub derivation path. The default is explicitly `false`; all four xpubs are required. When enabled, the master-mnemonic getter refuses to run. |
| W03-05 | High | Two wallet address API routes retained dormant helpers that could convert hot-wallet private keys or shared hot-wallet addresses into customer deposit addresses when xpub derivation failed or was unavailable. | **Removed.** The dormant private-key, shared-hot-wallet and address-fallback helpers were deleted from `/api/wallets/deposit-address` and `/api/wallets/provision-address`. The active handlers continue to use the canonical account-index provisioning engine. |
| W03-06 | Medium / launch blocker | An account-level xpub's depth/index metadata does not prove the complete ancestor path (purpose, coin type and account). | **Not resolvable from the xpub alone.** Production key ceremony metadata and matching known customer addresses must independently prove each xpub belongs to EVM, BTC, TRON and LTC before enabling the public-only mode. |

## 3. Public-only derivation contract

The new `src/lib/crypto/hd-derivation.ts` provides:

- EVM: `m/44'/60'/0'/0/index`, shared by ETH, USDT ERC-20 and USDT BEP-20.
- BTC: `m/84'/0'/0'/0/index`, Native SegWit `bc1q...`.
- LTC: `m/84'/2'/0'/0/index`, Native SegWit `ltc1q...`.
- TRON: `m/44'/195'/0'/0/index`, Base58Check `T...`.

The full six-address set is returned from four account-level public extended keys. It rejects malformed keys, private extended keys, root-level keys, non-account-level keys, missing chain xpubs and invalid child indices.

**Important limitation:** BIP-32 depth/index metadata can verify key scope shape but cannot prove the entire derivation ancestry. The code intentionally does not turn on public-only mode automatically.

## 4. Feature flag and safe migration behavior

Added to `.env.example`:

```env
PUBLIC_XPUB_DERIVATION_ENABLED=false
```

The flag stays false by default. When false, the existing canonical mnemonic-based path remains the source of deposit addresses, with mixed per-chain xpub fallbacks removed. When true, the complete address set is derived only from the four configured account xpubs; any missing or malformed key fails the request closed.

Do not enable this flag until all of the following have been completed:

1. Identify and verify the production key ceremony and the correct account-level extended public keys for all four chains.
2. Compare generated addresses from each xpub against already-issued customer deposit addresses at multiple known wallet indices, including existing low and high indices.
3. Compare every supported chain independently and verify the shared EVM address mapping for ETH / USDT ERC-20 / USDT BEP-20.
4. Reconcile any mismatch before changing the production provisioning mode.
5. Only then remove the master mnemonic from the ordinary web/API runtime. Sweeper and signer custody must be separately isolated; this feature flag by itself does not isolate sweeping keys.

No production xpub values were read, no customer addresses were changed, and the feature flag was not enabled in any deployment.

## 5. Verification

- `tests/xpub-address-derivation.test.ts`: **3 passed, 0 failed**.
  - Full address parity against disposable mnemonic-derived roots at indices 0, 1, 316 and 317.
  - Rejection of root-level keys, private extended keys, non-account keys and malformed keys.
  - Rejection of missing xpubs and invalid BIP-32 child indices.
- `tests/hd-key-management-validation.test.ts`: **5 passed, 0 failed**.
- Combined focused tests: **8 passed, 0 failed**.
- Full repository TypeScript check `tsc --noEmit`: **exit code 0**.
- `git diff --check`: **passed**.
- Address-route static scan: no references to `HOT_WALLET_PRIVATE_KEY` or `HOT_WALLET_ADDRESS` remain in either wallet address route.
- No SQL migration, Supabase mutation, deployment, or on-chain transaction was performed.

The pre-existing end-to-end wallet-provisioning test remains locally blocked by the missing `server-only` dependency reported in Step 2.

## 6. Remaining production blockers

1. The public-only flag remains disabled until production xpub/customer-address parity is verified.
2. With the flag disabled, the canonical API provisioning engine still has the mnemonic-based derivation path. The ordinary API runtime's master-seed exposure is therefore **not yet eliminated**.
3. Sweeper code still derives customer child private keys in the worker process. This requires a separate custody/derivation signer boundary.
4. Hot-wallet signing still occurs inside application workers; transaction authorization remains a separate signer-hardening step.
5. Supabase production project identity and applied migration history are still unverified. No database changes were made in Step 3.

## 7. Step 3 completion decision

**Public-only derivation implementation: completed.**
**Cross-chain disposable-seed address parity: passed.**
**Legacy synthetic and shared-hot-wallet address fallbacks: removed from the reviewed address helper/routes.**
**Canonical engine public-only mode: implemented but disabled pending production address matching.**
**Production key isolation: not complete.**
**Database changes: none.**
**Production launch: still blocked.**

Next wallet step: **Step 4 — production address registry reconciliation and custody isolation plan**, beginning with a read-only inventory of the configured production project, existing wallet indexes and issued addresses. No xpub or mnemonic secret is to be read into the ordinary API environment during that inventory.