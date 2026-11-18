# WAYONES Step 02 — Wallet generation and cryptographic key-management audit

**Date:** 2026-11-18
**Repository:** `tkishanmkm/cleanp2p` only
**Branch:** `fix/production-typecheck-batch-1`
**Baseline commit:** `062483f6ac2532013117862b480bb097cb0e32bb`
**Step status:** Partial remediation committed only after validation; key-isolation requirement remains a launch blocker.
**Database mutations:** None.
**On-chain transactions:** None.

## 1. Scope

Reviewed BIP-39 mnemonic use, BIP-32 child derivation, account index assignment, address-generation modules, provisioning endpoints, and the call graph for alternate derivation helpers. No mnemonic values, private keys, environment values, customer wallet rows, or production balances were read.

## 2. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| W02-01 | Critical custody-boundary issue | The canonical `hd-derivation-engine.ts` reads `DEPOSIT_HD_MNEMONIC`, derives the master private HDKey and caches it in process memory. Authenticated web API routes including `/api/auth/provision-wallets`, `/api/wallet/deposit-addresses`, `/api/wallets/provision-address` and `/api/wallets/deposit-address` call this canonical engine. The master key therefore is not isolated to the blockchain worker; the web/API process can hold the root private key hierarchy. A compromise of an API instance could expose derivation authority for all child deposit wallets. | **Unresolved; launch blocker.** Moving API derivation to xpub-only requires proof that each xpub maps to the existing production mnemonic and existing issued customer addresses. That proof cannot be performed without verified production key metadata and address inventory. |
| W02-02 | High | BIP-39 seed conversion used `mnemonicToSeed()` without first validating the mnemonic's wordlist and checksum. The installed `@scure/bip39` implementation documents seed derivation separately from checksum verification. | **Fixed in code.** Added checksum/wordlist validation before deriving the master seed. |
| W02-03 | High | Wallet index validation checked only basic type/positive status in the canonical provisioning path; it did not explicitly require a safe integer within the BIP-32 non-hardened child-index range. | **Fixed in code.** Added checks for safe integer, positive profile index, and maximum `0x7fffffff`. |
| W02-04 | High | The repository contains multiple competing key and derivation implementations. `src/lib/crypto/hd-engine.ts` and `src/lib/crypto/hdWallet.ts` independently derive keys from the mnemonic. `hd-engine.ts` returns child private keys. No active call sites for those functions were found in the scanned application source, but their future reuse would reintroduce secret handling outside a single reviewed path. | **Unresolved; isolate or retire after full repository/deployment reference review.** |
| W02-05 | High | `src/lib/hd-wallet.ts` contains a fallback that builds address-like values from HMAC-SHA512 of an xpub string when genuine BIP-32 derivation fails. Those values are not BIP-32 child public keys and cannot be assumed to have corresponding controllable private keys. Its generic fallback also fabricates non-chain addresses. The inspected active API handlers call the canonical mnemonic engine rather than this fallback helper, but accidental reuse could strand customer deposits. | **Unresolved; remove/fail closed in a dedicated follow-up.** |
| W02-06 | High | `src/app/api/wallets/provision-address/route.ts` contains a dormant helper that can fall back from xpub derivation to hot-wallet private-key/address values for per-customer deposit addresses. `src/app/api/wallets/deposit-address/route.ts` also contains older placeholder/fallback address helpers. No active call sites for these local helpers were found in the scanned source. | **Unresolved; retire or make fail-closed after a complete reference and deployment check.** |
| W02-07 | Medium | The xpub-only address generator in `src/lib/wallet-derivation.ts` exists but is not the canonical path used by the active provisioning routes. The current wrappers call `getOrDeriveUserDepositAddresses()`, which uses the mnemonic-based engine. | **Unresolved; do not switch until existing production address derivation is matched.** |
| W02-08 | Medium / test infrastructure | The pre-existing `tests/wallet-provisioning-security.test.ts` cannot run in the current local checkout because importing the canonical engine reaches `src/lib/supabase/service-role.ts`, whose `server-only` package is missing from local `node_modules`. | **Unresolved test-environment blocker.** The new pure mnemonic/index tests run independently and pass. |

## 3. Existing positive controls

- `public.user_wallet_index_seq` plus the partial unique index on `profiles.wallet_index` provides sequence-based allocation and database uniqueness in the repository migration history.
- `20260925000014_fix_profile_and_wallet_index_provisioning.sql` uses `nextval()` during profile creation and prevents duplicate non-null wallet indices.
- `20261011160335_wallet_deposit_rpc_restrictions.sql` revokes client execution on several wallet/deposit provisioning RPCs and grants service-role execution.
- `20261001040000_final_production_consistency_hardening.sql` contains service-role-oriented wallet provisioning grants; related preflight tests exist in the repository.
- The canonical derivation paths are explicitly documented: BTC `m/84'/0'/0'/0/i`, ETH/EVM `m/44'/60'/0'/0/i`, LTC `m/84'/2'/0'/0/i`, TRON `m/44'/195'/0'/0/i`.

These are repository controls; production migration application and current grants have not been proven.

## 4. Code changes in this step

1. Added `src/lib/crypto/mnemonic-validation.ts`:
   - validates mnemonic length, official wordlist membership and BIP-39 checksum using the ten official wordlists shipped by the installed BIP-39 library;
   - normalizes NFKD and whitespace consistently;
   - exposes validation-only and normalized-phrase APIs without returning derived key material;
   - rejects invalid BIP-32 child indices outside the safe non-hardened range;
   - uses generic errors that do not echo mnemonic content.
2. Updated `src/lib/hd-derivation-engine.ts`:
   - requires checksum-validated BIP-39 input before deriving;
   - clears the temporary seed buffer after creating the HDKey object;
   - validates child index range before address derivation;
   - validates persisted profile index as a positive safe integer within the BIP-32 non-hardened range.
3. Added `tests/hd-key-management-validation.test.ts` for all ten wordlists, invalid checksums/word counts, whitespace normalization and BIP-32 index bounds.

**Memory-clearing limitation:** clearing the temporary seed buffer does not erase the configured environment string, cached master HDKey, runtime copies, child private keys or the JavaScript process memory. This does not solve W02-01.

## 5. Verification

- New focused test file: **5 tests passed, 0 failed**.
- The pre-existing wallet provisioning test was attempted but failed before test execution with `MODULE_NOT_FOUND: server-only` in the local environment.
- Full TypeScript `tsc --noEmit`: completed with exit code 0.
- No application build, database migration or deployment was performed.
- No live mnemonic or private key was displayed or copied.

## 6. Required release gates

1. Keep withdrawal and sweeper capabilities disabled until the independent signer/worker boundary and all chain-specific transaction paths are reviewed and tested.
2. Create a public-only address derivation service for the ordinary web tier. Before switching, prove that configured account xpubs produce the exact addresses already assigned to existing customer records for every supported chain and derivation index. Never silently regenerate an existing customer's address.
3. Move master-seed and child-key derivation authority out of web/API instances into a separately isolated, least-privilege service. Do not return raw child private keys to the web tier.
4. Centralize the derivation implementation; retire mnemonic-based duplicate helpers and non-BIP-32 pseudo-address fallbacks after a complete reference check.
5. Add a key ceremony and lifecycle: offline seed generation, backup/recovery validation, restricted access, rotation plan, compromise response, and documented passphrase policy. The current code uses the default empty BIP-39 passphrase; confirm the production wallet ceremony matches that choice before any migration.
6. Verify the active production Supabase project, issued customer address inventory and migration state before changing provisioning RPCs or address derivation.
7. Restore the local `server-only` test dependency/configuration and run the canonical wallet provisioning tests plus typecheck and production build in the proper environment.

## 7. Step 2 completion decision

**Mnemonic validation and index-range code hardening: implemented.**
**Focused tests: passed (5/5).**
**Canonical end-to-end provisioning test: blocked by local missing `server-only` dependency.**
**Master-key isolation from web/API processes: not fixed.**
**Competing/dormant derivation fallbacks: not fixed.**
**Database changes: none.**
**Git changes: committed and pushed after scoped diff review.**
**Production launch: blocked.**

Step 2 remains **partially complete** until the root-key exposure and address-derivation source-of-truth blockers are resolved.