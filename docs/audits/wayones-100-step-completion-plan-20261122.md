# WAYONES 100-Step Wallet and Financial-System Plan

Repository: tkishanmkm/cleanp2p only
Branch: main
Plan date: 2026-11-22; execution update: 2026-11-23
Execution policy: full user authorization received for scoped `tkishanmkm/cleanp2p` `main` pushes and reviewed additive Supabase migrations to `paxonesflows`. No unrelated repositories, paid upgrades, GitHub Actions runs, live financial transactions, wallet credits, signing/broadcasting, production-secret changes or financial-worker activation without a separate validated release gate.

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
9. [x] Recover source copies of applied remote migrations missing from the local repository (restored the three previously missing applied files from the Supabase ledger; current remote applied versions now all have local source files).
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
23. [x] Verify BTC BIP84 mainnet derivation against known disposable mnemonic address vectors at wallet indices 1, 7 and 316; parity against independent HD-root derivation passes.
24. [x] Verify EVM BIP44 derivation and ETH/USDT ERC20/USDT BEP20 shared-address mapping against independent disposable-root vectors. USDC/BNB are not in the supported asset set and remain excluded.
25. [x] Verify LTC BIP84 mainnet derivation against known disposable mnemonic address vectors at wallet indices 1, 7 and 316; parity passes.
26. [x] Verify TRON BIP44 derivation, Base58Check and USDT TRC20 address mapping against independent disposable-root vectors.
27. [ ] Compare derived addresses against approved production key-ceremony/known-index fixtures without accessing customer private keys. Requirement recorded: a key custodian must provide an independently approved derivation-path/coin-account attestation plus a signed or otherwise approved set of address-only fixtures for multiple allocated wallet indexes on BTC, LTC, EVM (covers ETH/ERC20/BEP20), and TRON. The verifier needs only the public xpubs and expected public addresses; never request or place mnemonic, seed, private key, recovery material, or xprv in chat, logs, source control, or ordinary test output. Disposable fixtures pass but do not satisfy production attestation.
28. [x] Confirm xpub-only mode is fail-closed and cannot silently fall back to mnemonic mode (source review: mnemonic accessors throw when enabled; all four validated account xpubs are mandatory).
29. [ ] Enforce immutable user ownership, wallet index and chain-address identity at database level.
30. [ ] Enforce canonical address uniqueness and cross-registry collision checks (schema-specific chain-aware index migration drafted locally; not applied or verified).

### D. Deposit address registration and ingestion (31-40)

31. [ ] Confirm every supported asset/network resolves to one canonical deposit address.
32. [ ] Reconcile wallets, user_deposit_addresses and legacy deposit_addresses identities.
33. [x] Reject orphan registry addresses and rows whose profile/index owner cannot be confirmed (ingestion fails closed; four existing active registry rows have no Auth/profile owner and are skipped, not reassigned).
34. [ ] Validate chain, asset, token contract, destination and transaction identity in every webhook.
35. [x] Make pending-deposit registration idempotent across provider retries and duplicate webhooks (exact transaction/network/output identity, existing-row mismatch checks, terminal replay guard).
36. [x] Align local RPC arguments and response parsing with installed SQL signatures (pending registration and leased confirmation/credit RPCs matched to worker callsites).
37. [ ] Prevent rejected or malformed RPC responses from being reported as successful registrations.
38. [ ] Enforce chain-specific minimums, amount precision and asset/contract allow-lists.
39. [ ] Ensure deposit history uses canonical records, stable pagination and realtime updates.
40. [ ] Handle reorgs, replaced transactions and duplicate transaction/log indexes safely.

### E. Confirmation, balances and ledger integrity (41-50)

41. [x] Reconcile deposit confirmation RPCs and worker lease columns (claim/release/leased-credit RPCs installed; service-role-only grants verified).
42. [x] Require canonical block identity and configured confirmation depth before credit (block-hash identity persisted with a lease-bound credit wrapper and chain-confirmation threshold gate).
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

71. [x] Reconcile internal-transfer RPC arguments, response shape and route contract (the live RPC receipt now matches the route validator, including fee_rate snapshot and replay fields).
72. [x] Make sender debit and receiver credit atomic and idempotent (one postgres-owned transaction writes transfer, sender/receiver wallet balances, paired ledgers and durable replay receipt).
73. [x] Enforce authoritative platform/escrow fee settings and exact fee precision (1.5% defaults from app_settings, recipient amount preserved, sender pays amount plus fee, and fee-rate receipt snapshot).
74. [x] Retire unsafe legacy transfer RPCs and restrict execute grants (legacy execute_wallet_transfer revoked from API roles; canonical execute_internal_transfer remains service_role-only with empty search_path).
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

## Current execution update — 2026-11-28 (six-asset derivation regression batch)

- Rechecked the saved 100-step plan and preserved Step 06 as IN PROGRESS. Steps 23–26 now have disposable known-index derivation parity evidence for BTC, ETH, LTC, USDT ERC20, USDT BEP20 and USDT TRC20 at indexes 1, 7 and 316. USDC and BNB are outside the current supported assets. Step 27 remains open pending production key-ceremony and approved known-index address attestation.
- The `check_is_admin(uuid,uuid)` permission finding remains a confirmed blocker: current active-project read-only evidence shows authenticated EXECUTE is still true. Do not treat the local ACL migration or its source contract test as remediation; isolated PostgreSQL runtime validation and an approved production migration remain outstanding.
- Local regression tests now align reserved wallet-index zero rejection and current withdrawal refund finality/verified-unbroadcast parameters. UTXO, ingestion, withdrawal, and internal-transfer focused checks pass; full evidence is in `docs/AUTONOMOUS-PROGRESS.md` dated 2026-11-28. No live database, chain, transaction, worker, or production approval gate was changed.
- Some broader legacy tests still reference missing migration source versions; migration history reconciliation remains open. Do not infer runtime SQL safety from these static tests.

## Current execution update — 2026-11-28 (withdrawal worker fencing assertion correction)

- Investigated the two reported test failures against the current worker, the fencing migration and the durable-broadcast migration. The tests expected the retired process-wide lease signature `processWithdrawalQueue(ownerToken)` and `p_owner_token` at the worker RPC boundary. The current design uses a per-withdrawal worker ID (`p_worker_id`) with `onchain_withdrawals.worker_id` and `lease_expires_at`; claims and broadcast recording verify that owner and expiration in the database. `src/jobs/withdrawalWorkerLease.ts` is explicitly deprecated and unused.
- Updated only the two stale tests to assert the current per-withdrawal fencing contract and its claim/broadcast callsites. Regression tests: `withdrawal-worker-database-fencing` and `withdrawal-worker-direct-payout-safety` **PASS 7/7**. No worker implementation or migration behavior changed.
- Step 27 now explicitly records what evidence can complete it: custodian-approved derivation-path/coin-account attestation and approved public-address fixtures across multiple indexes for BTC, LTC, EVM and TRON. It explicitly forbids handling secret key material in chat/logs/source control. Step remains open until evidence is actually provided and verified.
- No real financial operation, worker activation, production DB write, or key access occurred. `check_is_admin(uuid,uuid)` remains an unresolved confirmed blocker. See progress log for the full batch record and pending security blocker.

## Current execution update — 2026-11-28 (withdrawal and deposit contract test alignment)

- The two withdrawal lease failures were stale assertions for the retired queue-wide owner-token API. Updated the tests to assert the current per-withdrawal `workerId`/database expiry fencing contract. The worker and migrations were not changed.
- Deposit contract review found two stale expectations: UTXO amounts are compared as exact integer base units and LTC requires six confirmations. One lifecycle test referred to a superseded migration filename; current source is `20261123153730_deposit_confirmation_contract.sql`. Aligned those tests with current implementation and migration history.
- Verification: focused withdrawal checks **10/10**, deposit registration/ingress/confirmation/chain verifier/reconciliation suite **48/48**, TypeScript **PASS**, diff check **PASS**. No database or financial state was mutated. Step 06 remains **IN PROGRESS**, Step 27 remains **OPEN** for approved key-ceremony evidence, and the `check_is_admin(uuid,uuid)` privilege issue remains a security blocker.
- Next: push this tested source-test/documentation batch after fresh `origin/main` comparison, then continue with KYT/AML, ledger reconciliation, withdrawals, recovery, gas and sweep checks. Static/source tests do not resolve production or isolated database verification blockers.


## Current execution evidence and blockers (2026-11-23)

- Active worktree is the clean `main` checkout at `C:\Users\theki\cleanp2p-wayones-work`; only `tkishanmkm/cleanp2p` is in scope. The separate `waydeepak` project and all PNB/BOB/Fino repositories remain untouched.
- Phase 1 application repair commit `119055284437abb3a13c7d3d755c6336290f292a` is live on Render `wayones`. Later SQL-source/documentation commits are marked `[skip render]` and do not change the deployed runtime.
- Sixteen Supabase migrations are now applied and verified on `paxonesflow`: `20261123141916` trade system events outside Realtime; `20261123141921` secure Didit initiation; `20261123153730` deposit confirmation/leases; `20261123153743` three-registry deposit owner resolution; `20261123153824` deposit chain-integrity monitor; `20261123154441` terminal deposit replay/balance guard; `20261123154456` raw-credit ACL revocation; `20261123155908` marketplace RLS/DML lockdown; `20261123155929` atomic BUY-ad creation; `20261123155955` escrow SELL interlock; `20261123160000` ten-active-ad hardening; `20261123161900` internal-transfer/escrow fee receipts; `20261123162654` trade-dependency empty search paths; `20261123163451` internal-only full-admin actor predicate; `20261123164014` platform escrow-fee posting on release and RELEASED-state reporting; and `20261123164252` USD-equivalent sweeper gas reporting.
- The raw `process_deposit_atomic` primitive is now executable only by `postgres`; the server-side pending registration, confirmation claim/release, leased credit and integrity functions retain `service_role` access. The raw credit RPC has no application callsites.
- The combined deposit, B2, withdrawal, marketplace, worker-config, internal-transfer, escrow fee-accounting, admin-predicate and fee-receipt contract suite passes **59/59**; TypeScript and standalone worker bundle build pass; the Next.js production build previously compiled and generated all 34 static pages (existing ESLint warning backlog remains). These are local/static tests, not live-money integration tests.
- Migration history (latest snapshot): **156 remote-applied versions**, **448 local SQL files**, no remote-applied version missing from the `main` source, and **292 local migration files remain unrecorded as applied**. Do not run blanket `supabase db push` or mass-repair migration history without per-migration schema proof.
- The live project currently has zero `auth.users` rows, zero profiles, zero wallets and zero on-chain deposits/credits. Four active `deposit_addresses` rows belong to a non-existent Auth owner; the scanner correctly skips them. Do not transfer or recreate that owner. New signup and wallet provisioning still require an isolated registration/allocator validation.
- The service-role address scanner currently has no verified active customer owner to process. No deposit, withdrawal, sweep, internal transfer, escrow settlement, signing, broadcast or balance-credit test has been run.
- Render currently has the `wayones` Free web service but no separately deployed background-worker service; `pg_cron` is present but not yet configured for the financial jobs. Do not claim 24/7 deposit/withdrawal processing until a supported free-tier scheduler/worker design is implemented and monitored.
- Didit secure initiation is installed, but the connected Didit organization has zero available credit and its historical monthly free-check allowance is not available. No billable session was created. KYC vendor end-to-end execution remains blocked pending an actually funded/eligible workflow decision.
- Step 06 remains IN PROGRESS. HD vectors, wallet owner/index schema, real user provisioning, all withdrawal/gas-funding/sweep/UTXO/transfer/escrow paths, RLS/function review, isolated staging tests and final release remain open.

## Latest execution update (2026-11-23, marketplace and worker safety)

- Marketplace DML migration 20261123155908 is applied: anon/authenticated keep RLS-filtered SELECT only; direct INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER are revoked for ads and p2p_ads. The retired p2p_orders table has zero rows and no client access.
- BUY creation migration 20261123155929 is applied. create_buy_ad_atomic is postgres-owned SECURITY DEFINER with empty search_path, callable only by authenticated users, and commits both ads and p2p_ads rows atomically. It requires a server-side market price refreshed within ten minutes.
- SELL interlock 20261123155955 is applied in the escrow RPC; SELL ad creation is also rejected in the API. SELL remains unavailable until ad-specific inventory reservations and idempotent release/refund/expiry restore are implemented.
- BUY limit migration 20261123160000 is applied; it serializes by owner profile and caps active listings at ten. Live privilege/function checks confirm the new RPC grants and interlock.
- crypto_market_prices has 1,328 rows, but the latest timestamp is 2026-10-01 and zero rows are fresh within ten minutes. BUY ad creation therefore fails closed until an approved trusted market-price refresh succeeds. This PC has no Supabase URL/service-role environment or local dotenv files, so no one-off production refresh was attempted.
- Worker safety: src/worker.ts now starts no database/chain work unless at least one individual feature flag is explicitly true. Deposit credit, withdrawals, sweep broadcast and P2P settlement each require separate explicit approval flags. The standalone bundle uses a server-only marker shim and passed a no-flags smoke test without DB/chain access. All feature flags are currently absent/off; no financial worker is running.
- Free-tier limitation: Render has no free background-worker or cron compute; the current service is a Free web service. Supabase pg_cron is installed, but its only legacy job is inactive, Vault has no secrets, and no financial schedule is configured. Do not claim 24/7 background settlement; the current architecture is deliberately paused.
- The live Supabase project has no Auth users, profiles, wallets, ads, P2P trades, deposits or ledger rows. Four active deposit-address registry rows reference a missing Auth/profile owner and are intentionally skipped. No financial transaction or billable Didit KYC session was created.
- Exact applied SQL for the four marketplace migrations has been recovered into their actual Supabase-generated timestamp filenames. This keeps the applied ledger source-controlled; the older un-applied duplicate filenames were removed from the local migration folder.
- Current release remains NOT PRODUCTION-READY. Outstanding work includes complete historical migration reconciliation, wallet derivation/provisioning vectors and a real signup fixture, market-price refresh, SELL inventory lifecycle, withdrawal/gas/sweeper dependencies, internal transfer/escrow lifecycle, all-function/RLS audit, Didit funding/workflow availability, isolated integration tests, and an operational free-tier scheduler design.

## Current execution evidence — 2026-11-23 (internal transfer/escrow fee repair)

- Applied Supabase migration 20261123161900_authoritative_internal_transfer_and_escrow_fee_receipts and restored its exact SQL to supabase/migrations in the active main worktree. No transfer, wallet, ledger, trade or escrow rows were created or updated by the migration.
- app_settings now has platform_fee_percent=1.5, escrow_fee_percent=1.5, min_trade_amount=10. These are the repository-defined initial defaults; existing values would have been preserved by ON CONFLICT DO NOTHING.
- execute_internal_transfer is postgres-owned SECURITY DEFINER with empty search_path and service_role-only execution. It validates caller identity, keeps the recipient amount equal to the entered request, charges the sender amount plus configured fee, writes paired ledger entries plus a platform transfer-fee ledger entry, and returns an immutable fee-rate snapshot for new/idempotent receipts.
- The legacy execute_wallet_transfer function is revoked from PUBLIC, anon, authenticated and service_role. No application source callsite uses it. New/replay receipt response fields now match isValidTransferRpcResponse, including gross_amount, net_amount, fee_amount, fee_rate, total_deduction, legacy_fee_model and idempotent_replay.
- initiate_trade_with_escrow now reads escrow_fee_percent from app_settings with bounded validation. Its existing empty search_path, authenticated auth.uid() actor binding, trusted service-role actor check and SELL inventory interlock remain intact.
- Live postconditions verified: canonical transfer RPC owner postgres, search_path empty, anon/auth execute false, service_role execute true; legacy execute_wallet_transfer execute false for all API roles; settings rows exist; zero transfers/wallet_assets/transfer ledger/platform transfer fee/trades/escrow rows.
- Regression scope: **53/53** static/unit contract tests pass; TypeScript and standalone worker build pass. No actual sender/recipient wallets or customer profiles exist, so a live transfer cannot be exercised. Do not claim a live transfer or settlement test.
- Current main worktree has the new migration source and transfer tests pending push; commit/push only after final diff/staging verification. Render app runtime is unchanged because the migration/tests/docs change SQL-source history only and use [skip render].

## Latest escrow/dispute/accounting execution update — 2026-11-23

- Applied and source-controlled locally: `20261123162654_empty_trade_dependency_search_paths` hardens five KYC/volume/withdrawal/expiry helper functions to empty search_path while verifying original definitions and ACLs are unchanged.
- Applied and source-controlled locally: `20261123163451_restore_active_full_admin_actor_predicate_for_atomic_dispute` restores `is_active_full_admin_actor(uuid)` as a postgres-owned SECURITY DEFINER function with empty search_path and postgres-only execute. It checks `verify_admin_login`, active profile status, bans, suspensions, restrictions, emergency freeze and minor restrictions.
- Applied and source-controlled locally: `20261123164014_record_platform_escrow_fees_on_release_and_fix_admin_stats` records `trade_fee_collected` through the existing idempotent platform-ledger helper on first successful escrow release and terminal replay using `pf_p2pfee_<trade_id>`, and fixes the escrow report to use `escrow_status='RELEASED'`.
- Applied and source-controlled locally: `20261123164252_repair_admin_financial_stats_sweeper_and_escrow_fee_sources` removes the nonexistent `deposits.sweeper_fee_paid` reference. The report now uses USD-equivalent `network_gas_expense` entries from sweeper/gas-funding operations and never adds unlike native-coin units.
- Cancellation and expiry are not patched to recognize revenue; both retain the full escrow refund path (`crypto_amount + escrow_fee`) and do not create platform-fee ledger entries. The release function contains two calls to the same immutable, idempotent fee writer (first settlement and completed-trade replay).
- `get_admin_financial_stats()` now executes successfully. Live data counts remain zero for trades, disputes, escrow ledger, wallet assets, platform escrow-fee entries and network gas expense entries; no customer value moved.
- The app expects `admin_resolve_trade_dispute_atomic`, but that RPC is still absent. Its reviewed migration was not applied because the Supabase migration safety gate rejected the privileged escrow-settlement DDL. The candidate was adapted to write automated system messages into `trade_system_events` rather than Realtime `trade_messages`, but remains unapplied. Do not use a legacy non-atomic fallback and do not bypass the safety gate.
- Steps 76–80 (escrow lock/release, mutually exclusive cancel/expiry/dispute settlement, end-to-end ledger reconciliation, notifications/history) remain OPEN until the atomic admin dispute wrapper is approved/applied and isolated integration tests can verify actual trade fixtures. Steps 81–90 remain OPEN for the full RLS/SECURITY DEFINER/admin/2FA review.
- The full static/unit suite now passes **59/59**; TypeScript and worker bundle pass. No real trade, dispute, escrow release/refund or wallet balance mutation has been tested because the connected project has no customer/trade data.

## Admin-dispute safety gate status — 2026-11-23

- The current admin dispute API and service are covered by updated contract tests. The route performs full-admin verification and blocks support roles; the service checks the explicit `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED` gate and calls only `admin_resolve_trade_dispute_atomic`. It does not fall back to direct release/cancel RPCs.
- The missing atomic admin-dispute migration candidate `20261108043000_restore_atomic_admin_dispute_settlement.sql` has been updated locally to require the applied `is_active_full_admin_actor(uuid)` helper and to write its optional system notice to `trade_system_events` with a per-dispute dedupe key. It no longer inserts into Realtime `trade_messages`.
- The candidate migration remains UNAPPLIED. Supabase's apply safety gate blocked the privileged DDL, so `admin_resolve_trade_dispute_atomic` remains absent on the live database. The explicit feature flag stays off and the API remains fail-closed. Do not bypass the safety gate or use a legacy non-atomic admin settlement path.
- The obsolete admin-dispute test was replaced with assertions for the current route, feature flag, expected RPC name, full-admin predicate, audit record and non-Realtime system-event behavior.
- The dispute/escrow completion group remains OPEN until the privileged migration is approved through the supported Supabase process and isolated integration tests verify first settlement, replay, cancellation/expiry races, winner selection, ledger posting and event dedupe against test trades.


## Current execution update — 2026-11-24 (trade-expiry worker credential isolation)

- Re-verified the active worktree is the intended `tkishanmkm/cleanp2p` repository on `main`, clean at `1e455652ce9e8a5f3a6a849c681e7525af51f09f` before this change. The saved contract run was **63/63** passing.
- Live Supabase inspection confirms `cancel_expired_p2p_trades()`, `expire_p2p_trade(uuid)`, `cancel_p2p_trade(uuid,uuid,text)`, `release_trade_escrow(uuid,uuid)` and `mark_p2p_trade_paid(uuid,uuid,text)` are postgres-owned SECURITY DEFINER functions with empty search_path and service_role-only execution. `raise_trade_dispute(uuid,uuid,text)` is also executable by authenticated users and binds the supplied actor to `auth.uid()`.
- The only matching legacy `pg_cron` expiry job is inactive. Its command targets `auto_cancel_expired_p2p_trades(15)`, not the current `cancel_expired_p2p_trades()` RPC. No cron schedule was enabled or changed.
- The HTTP `/api/cron/expire-trades` route previously accepted `DEPOSIT_WORKER_SECRET`, crossing the deposit-worker and trade-expiry trust boundaries. The route now accepts the shared cron secrets or a distinct optional `WAYONES_P2P_EXPIRY_WORKER_SECRET`; `.env.example` documents that credential separately.
- Added `tests/trade-expiry-worker-secret-boundary.test.ts`. Targeted trade-expiry/admin-dispute/escrow/worker safety tests pass **22/22**; TypeScript check and `git diff --check` pass.
- No Supabase DDL, database state, worker flags, cron schedules, Render secrets, production deployment or financial settlement were changed. The new dedicated secret is only documented as optional; it has not been provisioned. This does not complete the expiry lifecycle or the full security audit.


## Current execution update — 2026-11-24 (SECURITY DEFINER / RLS review)

- Captured the connected project's Supabase Security Advisor snapshot. It reports one anon-callable and seven authenticated-callable SECURITY DEFINER functions, plus seven RLS-enabled tables without policies. These are review findings, not automatic proof of data exposure.
- Reviewed the current definitions of the callable functions. They are postgres-owned and use an empty search_path. `get_public_platform_control_flags()` is deliberately public for middleware and returns only the three platform-control flags (`emergency_mode`, `maintenance_mode`, `prevent_user_login`); no user or secret data is selected. `verify_admin_login`, `is_admin`, `create_buy_ad_atomic`, `initiate_trade_with_escrow`, and `raise_trade_dispute` are used by current login, RLS, marketplace, trade-initiation and participant-dispute flows and have caller/session checks in their definitions.
- `check_is_admin(uuid,uuid)` still has authenticated EXECUTE in the live database, although the application source has no direct RPC call site. The current helper binds authenticated calls to `auth.uid()`; current database inspection found only a postgres-owned SECURITY DEFINER internal caller (`admin_adjust_balance`). Local migration `20261104202853_restrict_direct_check_is_admin_rpc_access.sql` already revokes PUBLIC/anon/authenticated and retains service_role/postgres/supabase_auth_admin. That migration version is absent from the live migration ledger (156 versions returned), so the live ACL remains unchanged. Added a static migration-contract test. Do not claim this ACL repair is applied.
- All seven RLS/no-policy tables currently have no anon or authenticated table privileges for SELECT/INSERT/UPDATE/DELETE. Their default-deny state is intentional pending table-by-table access mapping; no broad client policies were added. `deposit_chain_integrity_events` and `kyc_webhook_events` also lack direct service_role table privileges, consistent with keeping those event tables inaccessible through the Data API.
- Admin balance adjustment is intentionally unavailable: `admin_adjust_balance_atomic` is absent from the live public schema, its candidate migration `20261101101500_atomic_admin_balance_adjustment.sql` is not in the live ledger, and the server helper requires `PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED=true` before any RPC call. The active route remains fail-closed (503); no legacy balance RPC fallback was invoked. Existing legacy `admin_adjust_balance` overloads are service_role-only but are not a safe replacement for the audited atomic RPC.
- The atomic admin balance migration and API already have source-contract tests; keep the feature flag OFF until isolated PostgreSQL replay verifies wallet mirror consistency, idempotency, locked/reserved balance preservation, transaction rollback and mandatory audit insertion.
- No database DDL/ACL, production data, secrets, worker flags, cron jobs, or Render deployment were changed in this review. Security steps 81–90 remain OPEN; this update records partial findings only.


## Current execution update — 2026-11-24 (admin 2FA and support-admin readiness)

- Read-only checks of the live `paxonesflow` schema confirm `public.admin_2fa_rate_limits`, `check_admin_2fa_rate_limit(uuid)`, and `reset_admin_2fa_rate_limit(uuid)` are absent. Candidate migration `20261101170000_persist_admin_2fa_rate_limits.sql` is not in the applied migration ledger. The current challenge endpoint calls the persistent limiter before accepting an enabled admin's TOTP/recovery challenge and returns HTTP 503 when the RPC is unavailable. This is intentionally fail-closed, but it is a **deployment blocker for enabling administrator 2FA** until the migration is reviewed/applied through the supported Supabase process. No bypass or in-memory fallback was added.
- The migration candidate uses an atomic Postgres upsert to reserve each challenge attempt, a 15-minute window with a five-attempt maximum, service-role-only functions and private RLS storage. The current application intentionally has no separate `record_admin_2fa_failure` RPC; the first check RPC increments the attempt counter itself. Tests were updated to reflect this current contract.
- The same live project has zero Auth users and zero profiles, so no existing account or user 2FA challenge is currently impacted. A real admin login/2FA exercise is not possible with the present empty customer/admin fixtures.
- `support_admin_grants`, `support_admin_emergency_sessions`, and `support_admin_activity` are also absent from the live schema; the related migration candidates are not in the applied ledger. The source enforces a narrow emergency-session route allowlist (trade case/chat only), requires the signed 2FA session for emergency support, redacts support trade/chat data, rejects support settlement and global-control operations, and writes audit events for emergency actions. Support-admin onboarding, emergency activation/status and restriction-review logging remain unavailable until those tables are installed. No support-admin migration was applied.
- Verified route scopes: support emergency sessions are centrally restricted to the approved trade case/chat paths; the trade route separately rejects mark-paid and escrow intervention. Read-only support routes either redact case/chat data, return only public platform flags, return the support user's own status, or deny access to broader audit/wallet/KYC/financial records. No support privilege expansion was made.
- Updated stale static tests to match the implemented single-RPC 2FA limiter, compare-and-set encrypted TOTP migration, fail-closed dispute service, and current atomic `admin_set_platform_controls_authorized` route. The targeted security tests now pass **47/47** across 15 admin-2FA/support tests, 10 admin ACL/balance tests, and 22 escrow/worker tests; TypeScript and `git diff --check` pass.
- No live database DDL/ACL, user/profile data, credentials, worker flags, schedules or Render runtime were changed. The 2FA rate-limit, support-admin, admin dispute settlement, atomic admin balance adjustment and `check_is_admin` ACL migrations remain unapplied where previously identified. Security steps 81–90 remain OPEN pending supported migration approval and isolated schema/role/concurrency tests.
