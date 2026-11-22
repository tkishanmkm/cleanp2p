# WAYONES 100-Step Wallet and Financial-System Plan

Repository: tkishanmkm/cleanp2p only
Branch: fix/step-06-wallet-provisioning-integration
Plan date: 2026-11-22
Execution policy: local code and SQL review first; no production writes, live transactions, deployment, commit or push unless separately authorized.

## One-hour priority sprint

A complete, independently verified custodial wallet and financial-system setup cannot responsibly be guaranteed in one hour. This is a 60-minute priority sprint plan, not a promise that all 100 steps will be production-ready in that time.

| Time | Focus | Exit condition |
|---|---|---|
| 00-08 min | Confirm repo, branch, worktree, Supabase and Render targets | Correct repo preserved; environment uncertainty recorded |
| 08-18 min | Wallet index, signup trigger, provisioning API and schema | Canonical allocator and schema contract reviewed |
| 18-28 min | Address ownership, deposits, webhooks and confirmations | No duplicate credit or unverified owner |
| 28-38 min | Balances, reservations, ledger and withdrawal requests | Atomic, idempotent financial state transitions |
| 38-48 min | Withdrawal recovery, gas funding and sweeps | Durable signed intent and finality evidence |
| 48-55 min | Transfers, escrow and fee contracts | Atomic settlement and matching ledger effects |
| 55-60 min | Security gates, release blockers and report | Verified status and explicit outstanding blockers |

No production migration, live transaction, secret change or deployment is part of this sprint without separate approval. No free-tier limit or service suspension may be bypassed.

## 100-step checklist

### A. Scope, environment and migration control (1-10)

1. [x] Restrict work to tkishanmkm/cleanp2p; do not touch waydeepak, PNB, Fino or unrelated repositories.
2. [x] Confirm the active PC connection and local repository path.
3. [x] Confirm the active branch and preserve the existing dirty worktree.
4. [x] Capture the existing changes; do not reset, clean or overwrite them.
5. [x] Recover the existing Step 01-05 progress records and keep Step 06 open.
6. [x] Inspect Supabase projects and capture the connected paxonesflows schema and migration snapshot read-only.
7. [ ] Confirm authoritatively which Supabase project is production and which is staging.
8. [ ] Reconcile every local migration version against the remote migration ledger.
9. [ ] Recover source copies of applied remote migrations missing from the local repository.
10. [ ] Confirm Render service, deployed branch, domain mapping, environment and service state.

### B. Wallet index, signup and provisioning (11-20)

11. [x] Inspect the active auth.users signup trigger and identify its allocator.
12. [x] Verify whether legacy handle_new_user_wallets() is attached to an active trigger.
13. [x] Confirm the connected schema uses user_wallet_index_seq and a unique profile wallet-index constraint.
14. [x] Verify the connected snapshot sequence high-water mark exceeds profile and legacy wallet-index records (sequence 339; max legacy deposit index 327; no profiles or wallets).
15. [x] Prepare guarded empty-search_path hardening for the active signup trigger.
16. [x] Prepare revocation of execute grants on the detached legacy MAX-index helper.
17. [ ] Reconcile the local wallet-identity migration with the actual chain/address table schema before applying it.
18. [x] Enforce one shared asset/network allow-list in the HD helper and provisioning API.
19. [x] Make queue claims and completion compare-and-set so workers cannot double-claim jobs.
20. [x] Return an explicit unavailable response when the optional wallet_provisioning queue table is absent; keep direct provisioning separate.

### C. HD derivation, wallet rows and address ownership (21-30)

21. [x] Validate the configured mnemonic checksum and supported BIP-39 wordlists before active derivation.
22. [x] Enforce positive, bounded wallet indexes in active mnemonic, xpub and sweep derivation entry points.
23. [ ] Verify BTC BIP84 mainnet derivation against known address vectors.
24. [ ] Verify EVM BIP44 derivation and ETH, USDT, USDC and BNB network mapping.
25. [ ] Verify LTC BIP84 derivation and Litecoin mainnet address vectors.
26. [ ] Verify TRON BIP44 derivation, Base58Check and TRC20 address mapping.
27. [ ] Compare derived addresses against approved known-index fixtures without accessing customer private keys.
28. [x] Confirm xpub-only mode is fail-closed and cannot silently fall back to mnemonic mode (source review: mnemonic accessors throw when enabled; all four validated account xpubs are mandatory).
29. [ ] Enforce immutable user ownership, wallet index and chain-address identity at database level.
30. [ ] Enforce canonical address uniqueness and cross-registry collision checks (schema-specific chain-aware index migration drafted locally; not applied or verified).

### D. Deposit address registration and ingestion (31-40)

31. [ ] Confirm every supported asset/network resolves to one canonical deposit address.
32. [ ] Reconcile wallets, user_deposit_addresses and legacy deposit_addresses identities.
33. [ ] Reject orphan registry addresses and rows whose profile/index owner cannot be confirmed.
34. [ ] Validate chain, asset, token contract, destination and transaction identity in every webhook.
35. [ ] Make pending-deposit registration idempotent across provider retries and duplicate webhooks.
36. [ ] Align local RPC arguments and response parsing with installed SQL signatures.
37. [ ] Prevent rejected or malformed RPC responses from being reported as successful registrations.
38. [ ] Enforce chain-specific minimums, amount precision and asset/contract allow-lists.
39. [ ] Ensure deposit history uses canonical records, stable pagination and realtime updates.
40. [ ] Handle reorgs, replaced transactions and duplicate transaction/log indexes safely.

### E. Confirmation, balances and ledger integrity (41-50)

41. [ ] Reconcile deposit confirmation RPCs and worker lease columns.
42. [ ] Require canonical block identity and configured confirmation depth before credit.
43. [ ] Verify exact token Transfer events before crediting token deposits.
44. [ ] Ensure one confirmed chain event can credit at most one ledger reference.
45. [ ] Make ledger credit and wallet balance updates atomic in one database transaction.
46. [ ] Reconcile available, reserved, locked and total balance formulas per wallet.
47. [ ] Reject negative, non-finite, exponent-form and excessive-precision amounts.
48. [ ] Enforce immutable idempotency keys and reject payload mutation on replay.
49. [ ] Reconcile balance snapshots against ledger sums with exception reporting.
50. [ ] Ensure every adjustment, fee, credit, debit and reversal has actor, reason and audit reference.

### F. Withdrawals and payout settlement (51-60)

51. [ ] Validate withdrawal asset, network, destination format and account eligibility.
52. [ ] Enforce KYC/no-KYC limits and withdrawal lock flags.
53. [ ] Compute network fee and payout total from authoritative server-side configuration.
54. [ ] Reserve user funds atomically before a withdrawal becomes dispatchable.
55. [ ] Prevent duplicate withdrawal requests through idempotency and unique operation identity.
56. [ ] Enforce worker lease ownership and database fencing for every state transition.
57. [ ] Persist exact signed transaction bytes, hash, nonce and payout intent before broadcast.
58. [ ] Recover ambiguous broadcasts using the same durable signed bytes; never create a replacement blindly.
59. [ ] Require canonical receipt/finality and exact destination/amount/token evidence before settlement.
60. [ ] Refund only after definitive terminal failure evidence; keep unknown/reorg cases reserved for reconciliation.

### G. Gas funding, sweeps and custody operations (61-70)

61. [ ] Verify hot-wallet addresses and chain configuration against approved environment settings.
62. [ ] Enforce hot-wallet-only custody and prevent user-controlled signer/broadcast paths.
63. [ ] Make EVM nonce reservation atomic across all workers and operation types.
64. [ ] Persist gas-funding intent, signed bytes, nonce and receipt identity before state advance.
65. [ ] Reconcile EVM gas funding with canonical receipt and nonce evidence.
66. [ ] Enforce TRON resource delegation ownership, lease and verified undelegation.
67. [x] Harden TRON sweep finality locally to require configured canonical-block confirmation and exact signed/event evidence.
68. [x] Persist exact TRC20 sweep amount with signed transaction and add a local amount-immutability migration.
69. [ ] Verify BTC/LTC UTXO inputs, outputs, fees and conflict proofs before releasing reservations.
70. [ ] Ensure sweep failures, retries, reorgs and manual recoveries preserve funds and produce audit records.

### H. Internal transfers and P2P escrow (71-80)

71. [ ] Reconcile internal-transfer RPC arguments, response shape and route contract.
72. [ ] Make sender debit and receiver credit atomic and idempotent.
73. [ ] Enforce authoritative platform/escrow fee settings and exact fee precision.
74. [ ] Retire unsafe legacy transfer RPCs and restrict execute grants.
75. [ ] Prevent transfers to self, blocked users, suspended accounts or unsupported asset pairs.
76. [ ] Enforce escrow lock creation and participant/amount/asset identity.
77. [ ] Require seller-release authorization and atomic escrow settlement.
78. [ ] Make cancellation, expiry, dispute release and refund paths mutually exclusive and idempotent.
79. [ ] Reconcile every escrow state transition with ledger entries and balances.
80. [ ] Verify receipts, notifications, chat/trade events and user-visible transaction history.

### I. Security, administration and account controls (81-90)

81. [ ] Review RLS and grants for every wallet, deposit, withdrawal, ledger and escrow table.
82. [ ] Review every SECURITY DEFINER function for ownership, empty search_path and caller authorization.
83. [ ] Confirm user-facing routes never accept caller-supplied privileged user IDs.
84. [ ] Ensure internal service secrets are high entropy and stored only in approved secret stores.
85. [ ] Ensure admin actions bind to an authenticated admin actor and immutable audit record.
86. [ ] Enforce 2FA lifecycle, rate limits, recovery rotation and secure secret storage.
87. [ ] Reconcile KYC webhook signatures, event leases, duplicate deliveries and status transitions.
88. [ ] Verify emergency freeze, account restriction and withdrawal-disable controls fail closed.
89. [ ] Review dependency/security advisories and remove unused privileged code paths.
90. [ ] Ensure logs and errors never expose private keys, mnemonics, bearer secrets or sensitive user data.

### J. Verification, release and operational readiness (91-100)

91. [ ] Generate a canonical database contract report and compare it with every local RPC caller.
92. [ ] Create isolated staging schema/fixtures for all supported wallet paths.
93. [ ] Add regression tests for wallet allocation, derivation identity and provisioning replay.
94. [ ] Add regression tests for deposit registration, confirmations, reorgs and duplicate credits.
95. [ ] Add isolated tests for withdrawal reservations, broadcast recovery, refunds and gas accounting.
96. [ ] Add isolated tests for sweeps, nonce/UTXO/resource recovery and finality proofs.
97. [ ] Run typecheck, lint, unit tests, E2E and production build after code/SQL review is complete.
98. [ ] Review final diff, migration ordering, secret exposure and quality-gate report.
99. [ ] Obtain explicit approval for production project, migration set, secret provisioning and deployment.
100. [ ] Deploy only the approved branch and verify health, logs, rollback and post-deploy accounting.

## Current evidence and blockers (2026-11-22)

- Steps 01-05 have prior audit records; their final evidence is not re-certified by this plan.
- Step 06 remains IN PROGRESS.
- The PC is online. The current local branch is fix/step-06-wallet-provisioning-integration. Existing dirty changes are preserved.
- The connected Supabase project paxonesflows is ACTIVE_HEALTHY, but its production/staging identity is not confirmed. It reports 139 applied migration versions.
- The connected schema uses chain/address/derivation_index wallet rows. It does not have wallet_provisioning or the wallet_id columns expected by local 20261118154249_enforce_wallet_provisioning_identity.sql.
- The active signup trigger is on_auth_user_created -> handle_new_user(). The legacy handle_new_user_wallets() function is not attached to an active trigger.
- Local changes include shared asset/network validation, positive child-index checks, UUID and bounded streaming JSON validation, compare-and-set queue claims, explicit missing-queue handling, guarded signup-trigger SQL, removal of unindexed profile creation fallbacks, authenticated OAuth provisioning, shared TRON provider configuration, TRON sweep finality evidence, persisted sweep amounts, reduced sweep signing-key exposure, and a schema-specific chain-aware address uniqueness migration draft.
- Local SQL files are not applied. No tests, TypeScript, lint, build, production writes, secret changes, Git commit/push or deployment were performed in this pass.

## Completion rule

A step is complete only when its specific change is reviewed and the required evidence exists. A local migration file does not prove it was applied. A passing local quality gate does not prove production financial safety. Unresolved environment, schema, secret, approval or chain-finality blockers remain open.
