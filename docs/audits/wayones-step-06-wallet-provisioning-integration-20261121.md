# WAYONES Step 06 — Wallet Provisioning Integration and Schema Compatibility

**Status:** IN PROGRESS — not complete
**Inspection date:** 2026-11-21
**Repository:** `tkishanmkm/cleanp2p` only
**Local branch:** `fix/step-06-wallet-provisioning-integration`

## Progress record

Steps 01–05 have existing audit records in `docs/audits/`. Step 06 remains active because the local wallet code and SQL contract are ahead of the connected Supabase database. Do not mark Step 06 complete until the intended project, migration history, provisioning secret, and deployed endpoint are reconciled.

## Safety boundary

- No production database writes or migrations were executed.
- No wallet, deposit, withdrawal, sweep, or transfer transaction was initiated.
- No Render deployment, Git push, commit, reset, checkout, or cleanup was performed.
- Existing local modifications and untracked files were preserved.
- The connected Supabase project is recorded as `paxonesflows`, but its production role has not been proven. Do not infer that it is the production database from its current health status.
- The only Render service returned for the `cleanp2p` repository is `nextoness`, which is suspended and points to branch `main`. The mapping from `paxones.com` to that service or another host is not confirmed.

## Confirmed integration findings

### 1. Provisioning RPC and internal trigger

The connected database has a signup trigger that calls:

`https://paxones.com/api/auth/provision-wallets`

The trigger expects the Supabase Vault secret `wallet_provisioning_bearer`. The secret is absent in the connected project. The internal provisioning route previously did not consistently accept the trigger's bearer-secret contract.

Local code changes now:
- Accept the dedicated `WALLET_PROVISIONING_SECRET` (or the existing `PROVISION_SERVICE_KEY` fallback) for internal provisioning.
- Compare supplied and configured secret bytes with a constant-time comparison.
- Keep normal authenticated-user provisioning separate from the internal trigger authorization.
- Document the dedicated environment variable in `.env.example`.

No secret was generated, stored, or changed in Vault or Render.

### 2. Wallet derivation and RPC result validation

The server-side HD derivation engine now has a `server-only` boundary and validates the persisted wallet provisioning RPC response, including wallet IDs and address fields, before returning it to callers. The six asset/network records are presentation/network views; they are not six independently persisted wallet rows.

### 3. Deposit registration and confirmation contract drift

Local code calls these RPCs:
- `register_pending_deposit`
- `claim_pending_deposit_confirmations`
- `release_pending_deposit_confirmation_claim`
- `process_deposit_atomic_with_lease`

The local migration `20261104130000_deposit_confirmation_contract.sql` defines the missing wrapper and lease functions and adds the required block/lease columns. The connected database does not currently contain these RPCs or columns.

The connected database currently has `process_deposit_atomic`, but it does not have the newer wrapper/lease contract. Its live function configuration is still `search_path=public, pg_temp`; the local reviewed migrations harden it to `pg_catalog` and add terminal replay / ledger consistency guards.

Schema comparison confirmed:
- `onchain_deposits` is missing `confirmation_worker_id`, `confirmation_lease_expires_at`, `block_number`, and `block_hash`.
- `deposits` is missing `block_hash`.
- The local confirmation worker depends on the lease RPCs and those columns.

The current local ingestion and confirmation code therefore cannot be assumed to work against the connected database until the intended migrations are applied through a reconciled migration plan.

### 4. Connected database row counts

Read-only counts for `paxonesflows` at inspection time:

| Table | Rows |
|---|---:|
| `auth.users` | 0 |
| `profiles` | 0 |
| `wallets` | 0 |
| `user_deposit_addresses` | 0 |
| `deposit_addresses` | 4 |
| `deposits` | 0 |
| `onchain_deposits` | 0 |

All four legacy `deposit_addresses` rows are active but have no matching profile. They were not modified or reassigned. The deposit scanner now filters all address registries against existing profiles with a positive `wallet_index`, pages registry queries in stable `id` order, and fails closed if profile verification fails. This prevents orphan rows from being repeatedly scanned as if they were provisioned wallets.

### 5. Migration history drift

The connected project reports 139 applied migration versions; the local repository contains 336 migration files. The connected history includes later Step 06 wallet allocator / provisioning search-path versions while the deposit confirmation contract migrations are absent. Some applied remote migration files are not present in the local repository.

Do not run a blanket `supabase db push` or apply migrations by timestamp alone. The local migration `20261104130000_deposit_confirmation_contract.sql` explicitly requires migration-history reconciliation before application. The later `20261107210306_guard_terminal_deposit_registration_replay.sql` depends on the reviewed canonical RPC body. Review the missing/applied version set and exact dependencies before any database write.

The previously verified Step 05 migration `20261118154249_enforce_wallet_provisioning_identity.sql` was restored unchanged after a compatibility review. Two unverified Step 06 SQL drafts were moved out of `supabase/migrations` into `docs/drafts/wallet-step-06/`; they must not be treated as deployable migrations.

### 6. Deposit result handling and history UI

Local code changes now:
- Add a strict `parseDepositRpcResult` parser. Missing, malformed, or `success: false` responses fail closed.
- Make the ingestion worker record RPC-level rejections instead of silently treating a JSON failure as a successful registration.
- Count actual credits from the RPC's `credited` boolean, not a non-contract status string.
- Make internal chain-ingest and wallet deposit routes return failure HTTP statuses when the RPC rejects a candidate.
- Make Alchemy, Blockcypher, generic deposit, and Litecoin webhook handlers distinguish registration failures from accepted pending/duplicate results.
- Fix the transaction history UI to read the history API's `data` field (with a legacy `deposits` fallback).
- Subscribe transaction history to `onchain_deposits` updates as well as `deposits` and `withdrawals`.
- Add a deterministic `id` tie-breaker to deposit-history pagination.

The read-only deposit preflight SQL file was updated to match the current terminal replay / ledger guard markers. It has not been executed.

## Current blockers — Step 06 remains open

1. Confirm which Supabase project is the authorized production target; current project health does not establish production identity.
2. Reconcile all 336 local migration files against the 139 applied remote versions, including missing local copies of applied remote migrations.
3. Review and apply only the required deposit confirmation / replay migrations after their preconditions are confirmed.
4. Confirm the actual host for `paxones.com` and restore an active deployment for the intended `cleanp2p` branch.
5. Provision the same high-entropy secret in Supabase Vault and the intended server environment, with explicit authorization and without exposing its value in logs or chat.
6. Verify the signup trigger can reach the endpoint and that provisioning persists the expected wallet rows and address registries.
7. Complete code/SQL review for the remaining wallet paths: balances, address ownership, deposits, confirmations, withdrawals, sweep, transfers, and ledger reconciliation.

## Validation state

- Read-only Supabase schema/function/migration inspection: performed.
- Local code edits and SQL review: in progress.
- Automated tests, TypeScript, lint, and build: not run in this continuation, per the current no-testing-before-code/SQL-completion constraint.
- Production migration / deployment / Git push: not performed.
- Step 06 completion: **NOT VERIFIED**.
- Wallet completion: **NOT VERIFIED; do not represent the wallet as production-ready**.

### 7. Internal transfer fee and receipt contract drift

The connected database's `execute_internal_transfer` is still on the older hard-coded 1.5% fee / legacy amount contract. Its live definition has `search_path=public, pg_temp` and lacks the newer `idempotent_replay` and `legacy_fee_model` response fields required by the local route validator.

The connected `public.app_settings` table currently has no rows for:
- `platform_fee_percent`
- `escrow_fee_percent`
- `min_trade_amount`

The application deliberately fails closed when those financial settings are missing. This prevents a transfer/trade from silently using an unverified default, but it blocks the current transfer/P2P fee flow until the reviewed migration is applied.

The local migration `20261105220000_reconcile_authoritative_fee_configuration.sql` inserts the validated defaults only when absent, patches `execute_internal_transfer` to read the canonical setting and return the receipt/idempotency contract, and aligns the P2P escrow fee. The follow-up `20261106050000_retire_legacy_wallet_transfer_rpc_and_verify_transfer_contract.sql` verifies that contract and revokes all API-role execution on the obsolete `execute_wallet_transfer` RPC. Neither migration is applied in the connected project.

Local application search found the current transfer API calling `execute_internal_transfer`; no current source caller of `execute_wallet_transfer` was found. The old RPC remains service-role executable in the connected database until its retirement migration is applied.

A new local migration, `20261121190000_harden_wallet_transfer_and_worker_lock_search_paths.sql`, sets empty search paths on the canonical internal transfer and withdrawal-worker lock functions, and marks the legacy transfer RPC deprecated. It is not applied.

### 8. TRON sweep recovery finality and evidence review — 2026-11-21 continuation

A code review of the existing sweep recovery path found that its final reconciliation branch used `tronWeb.trx.getTransaction()` and `contractRet === 'SUCCESS'` as sufficient confirmation. That branch did not enforce the configured 19-confirmation canonical-block check or verify the exact USDT Transfer event against the persisted sweep intent.

Local code-only changes now:
- Require the canonical transaction confirmation helper to report at least `TRON_CONFIG.requiredConfirmations` and a valid canonical block identity before marking a TRON sweep confirmed or failed.
- Verify the persisted signed transaction against the observed on-chain transaction and the expected source deposit address, hot-wallet destination, USDT contract, and exact six-decimal amount.
- Require exactly one matching confirmed USDT Transfer event before marking a TRON sweep successful.
- Keep receipt/API uncertainty fail-closed; incomplete evidence does not settle the sweep.
- Preserve the exact persisted amount as a decimal string through final status transition instead of converting it through JavaScript `Number`.
- Rename the new local sweep-amount persistence migration to `20261121210000_persist_tron_sweep_amount_with_signed_payload.sql` (the prior `24:00:00` timestamp was invalid).
- Add `20261121220000_freeze_persisted_sweep_amount.sql` to reject mutation of an already-positive persisted sweep amount while allowing idempotent writes of the same value.

Validation boundary for this continuation:
- Surgical local edits completed; source diff whitespace check passed for the tracked worker file.
- No automated tests, TypeScript, lint, or build were run, preserving the user's no-testing-before-code/SQL-completion instruction.
- No Supabase migration was applied; no Git commit/push, deployment, or production change was made.
- The sweep path remains **unverified** until the complete code/SQL review and authorized isolated validation are finished.

### 9. Wallet provisioning integration and active signup allocator — 2026-11-22 continuation

Read-only inspection of the connected Supabase project `paxonesflows` (`eaiwgfxoiwxepinvcykg`) returned `ACTIVE_HEALTHY`, but its production/staging identity is still unconfirmed. The project reports 139 applied migrations. No remote database writes were performed.

Confirmed connected schema contract:
- The active signup trigger is `auth.users.on_auth_user_created → public.handle_new_user()`.
- `public.handle_new_user_wallets()` exists and contains a legacy `MAX(wallets.derivation_index)+1` allocator, but no active trigger is attached to it.
- `public.claim_next_wallet_index()` is postgres-owned SECURITY DEFINER, uses `public.user_wallet_index_seq`, has an empty search_path, and is executable by service_role only.
- The connected `wallets` table uses `chain,address,derivation_index`; it does not have `wallet_index,evm_address,tron_address,btc_address,ltc_address`.
- The connected `user_deposit_addresses` and `deposit_addresses` registries do not have a `wallet_id` column.
- The connected project has no `public.wallet_provisioning` table.
- The canonical `provision_user_wallets_atomic(uuid,integer,text,text,text,text)` RPC exists and follows the chain/address/index schema. It creates four chain wallet rows, canonical address registry records and profile mirrors.

Important compatibility decision:
- The local `20261118154249_enforce_wallet_provisioning_identity.sql` migration expects `wallet_id` columns and a wallet-table structure different from the connected project. It must **not** be applied to this database without a separately reviewed schema migration plan.
- The local allocator Step 06 draft is still a draft; do not apply it by timestamp or blanket db push.
- The legacy `handle_new_user_wallets()` is detached, so its MAX-index logic is not an active signup allocator. A new local migration `20261122170000_harden_signup_wallet_index_trigger.sql` now preflights the active trigger, requires the canonical sequence-backed implementation, sets its search_path to empty, verifies the result and revokes direct execution of the detached legacy helper. The migration is local only and has not been applied.

Local application changes:
- `src/lib/hd-wallet.ts` now defines one shared supported asset/network allow-list and rejects unsupported pairs before deriving/persisting an address.
- `src/app/api/internal/provision/route.ts` uses the shared allow-list, validates UUID user IDs and bounded JSON object requests, uses compare-and-set batch claims/completion, and returns an explicit 503 when the optional provisioning queue table is missing.
- The direct user provisioning path remains separate from the optional batch queue path.

### 10. Sweep signing-key minimization and legacy xpub hardening — 2026-11-22 continuation

Review of all source call sites found the sweeper was deriving all four child private keys (BTC, LTC, TRON and EVM) for each individual BTC/LTC/TRON sweep, although each sweep consumed only one of those keys.

Local code changes:
- Replaced the multi-key `deriveUserKeys` path in `src/jobs/sweeperWorker.ts` with `deriveSweepSigningKey(mnemonic, index, network)`, which derives only the required chain's child key.
- Validate the BIP-39 phrase using the shared supported-wordlist/checksum validator before signing.
- Require positive, safe, bounded child indexes for the sweep signer.
- Wipe the temporary BIP-39 seed and HD master/child private material after extracting the one required signing key.
- Route the EVM sweep signer through the same derivation helper, then independently verify that the constructed ethers wallet address matches the helper's computed address.
- Keep each chain's existing stored-deposit-address comparison before sweep processing; mismatches still fail closed.
- Add an explicit Next server-only boundary to legacy private-key/xpub derivation modules that are not client entry points.
- Harden the unreferenced legacy `wallet-derivation.ts` helper to accept only a validated public account xpub at the expected depth/account path and a positive bounded child index.
- Remove the unsupported `isNew: false` claim from the internal provisioning API/helper response; the canonical RPC contract does not report whether its idempotent operation created or reused a row.

The older `src/lib/crypto/hd-engine.ts` still contains a private-key-returning helper that is not called by any current source path; it is now explicitly server-only. Do not treat that dead legacy helper as an active sweep route. Full cleanup/retirement should be handled after callers and historic operational tooling are reconciled.

Validation boundary:
- Source changes saved and reviewed by call-site search; no tests, TypeScript, lint or build run.
- No live chain request, wallet signature, broadcast, Supabase write, deployment, Git commit or push.
- Address-vector checks and isolated signer fixtures remain open.

Remaining Step 06 blockers:
1. Confirm the actual production Supabase project and authoritative schema branch.
2. Decide whether the intended deployment supports the queue at all; if so, add its actual writer/DDL and worker lifecycle to the approved schema, rather than assuming the absent table exists.
3. Reconcile the local wallet identity migration with the remote chain/address/index schema; prepare a compatible forward-only migration only after the target schema is confirmed.
4. Verify the current signup sequence high-water mark against every profile wallet_index and all legacy allocator high-water marks.
5. Reconcile the migration history (139 remote versions against the local repository) and restore absent remote migration sources before considering DDL application.

Validation boundary:
- Local edits and migration file were saved; no automated tests, TypeScript, lint or build were run.
- No Supabase migration, production write, secret change, Git commit/push, Render deployment or financial transaction was performed.

### 11. Deposit registration and confirmation contract reconciliation — 2026-11-22 continuation

Read-only inspection of connected project `paxonesflows` confirms the current database is missing all four new RPCs called by the local ingestion/confirmation worker:
- `register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`
- `claim_pending_deposit_confirmations(text,integer,integer)`
- `release_pending_deposit_confirmation_claim(uuid,text)`
- `process_deposit_atomic_with_lease(uuid,text,text,text,text,numeric,text,integer,bigint,text,text,integer,text,text)`

The connected DB currently has only the older `process_deposit_atomic(...)` credit RPC for this canonical path. It is postgres-owned SECURITY DEFINER but still reports `search_path=public, pg_temp`. Local `20261104130000_deposit_confirmation_contract.sql` adds the required lease/block columns, service-role-only scanner registration wrapper, SKIP LOCKED confirmation claims, owner-token release and atomic leased credit wrapper, and hardens the existing credit RPC search path. The follow-up `20261107210306_guard_terminal_deposit_registration_replay.sql` adds the associated replay guard. Neither migration has been applied to the connected project.

Live schema compatibility review:
- The current `onchain_deposits` columns already include the identity fields used by the local migration (id/user/tx/network/address/amount/asset_symbol/status/confirmations/to_address/output_index); missing additions are the confirmation lease owner/expiry and block number/hash.
- The current `deposits` table contains tx_hash/chain/output_index and block_number but not block_hash.
- Existing unique indexes already enforce normalized transaction hash + chain/network + output index identity on both pending and canonical deposit records.
- The local ingestion worker sends `p_confirmations: 0` to the scanner registration RPC; the SQL wrapper explicitly requires zero so scanners cannot credit.
- The confirmation worker checks chain-specific finality and exact transaction/output or token Transfer evidence, then passes the leased row identity and exact block evidence to the leased credit wrapper. The worker's current argument names/types match the local SQL signature.

Wallet/index snapshot:
- `user_wallet_index_seq.last_value=339`, `is_called=true`; next allocation would be 340.
- Maximum legacy `deposit_addresses.derivation_index=327`; there are no profile or wallet rows in this connected snapshot.
- Connected counts: profiles 0, wallets 0, user_deposit_addresses 0, deposit_addresses 4. All four deposit_addresses rows have no matching profile. The local scanner's owner validation excludes orphan rows.
- This empty database snapshot does not prove production identity; it may be a non-production or wrong project and must not be used to infer live customer wallet coverage.

Migration-source reconciliation:
- The remote ledger has 139 migration versions.
- The local `supabase/migrations` folder has 429 timestamped `.sql` migration files with unique 14-digit version prefixes (excluding drafts/backups).
- 137 version IDs match exactly; remote-applied IDs `20261119074350` and `20261119174139` have no exact matching local filename/source. Local-only migrations remain unapplied candidates, not missing remote migrations.
- Do not run blanket db push. Reconstruct or obtain those two exact applied migration sources and reconcile semantic equivalents before any schema operation.

Validation boundary:
- All database inspection was SELECT-only.
- No remote migration, financial write, secret update, test/build, Git operation, deployment or live transaction was performed.
- Deposit ingestion/confirmation is **not operational against this connected DB** until the correct target is identified and the reviewed migration set is reconciled/applied through an approved process.

### 12. Signup-to-wallet provisioning flow and TRON provider configuration — 2026-11-22 continuation

Full read-only trigger enumeration on `auth.users` found exactly:
- `on_auth_user_created → public.handle_new_user()`
- `strip_sensitive_user_metadata → public.strip_sensitive_user_metadata()`

The active `handle_new_user()` allocates `wallet_index` from `public.user_wallet_index_seq` and creates the profile. It does not call `net.http_post`, enqueue wallet jobs or provision wallet rows. No other active auth.users dispatch trigger exists in this project snapshot. The older local `20261011161643_secure_wallet_provisioning_trigger.sql` function is not attached as an active auth.users trigger here.

Application flow inspection:
- Both `src/app/api/auth/callback/route.ts` and `src/app/auth/callback/route.ts` exchanged the OAuth code for a session, then made a server-side fetch to `/api/auth/provision-wallets` without forwarding the new session access token. The endpoint requires either a valid user bearer session or the dedicated internal secret, so that fetch could be rejected even though fetch itself did not throw.
- Both callbacks now forward the access token returned by `exchangeCodeForSession`, check the HTTP result and log non-sensitive failure details without logging the token.
- `src/app/api/auth/provision-wallets/route.ts` and `src/app/api/internal/provision/route.ts` now read the actual request body in a bounded stream (2 KB maximum) rather than buffering an unbounded body and checking its size afterward.
- The browser-side `DepositAddresses.tsx` continues to call the same endpoint with the browser's authenticated same-origin session.

TRON provider configuration:
- The confirmation worker used `TRON_PRO_API_KEY`, the sweeper used only `TRONGRID_API_KEY`, and the deposit-integrity worker used `TRON_PRO_API_KEY`, while the shared `TRON_CONFIG` reads `TRON_GRID_API_KEY` or `TRONGRID_API_KEY`.
- The three affected worker paths now use `TRON_CONFIG.fullHost` and `TRON_CONFIG.apiKey` as appropriate. The remaining raw TRON environment references are only in the shared configuration and the existing deposit-ingestion fallback that resolves to the same configured key.

Validation boundary:
- Code and SQL files are saved locally. `git diff --check` was run after this batch and produced no whitespace error; Git emitted only existing LF/CRLF normalization warnings.

### 13. Remove profile-creation paths that bypass the sequence allocator — 2026-11-22 continuation

A source-wide search identified two post-signup `profiles.upsert()` operations in `src/lib/auth.ts` and two OAuth callback fallback blocks that manually inserted profile rows when the auth trigger had not created one. Those fallback rows omitted `wallet_index`, allowing a profile to exist without the canonical sequence-allocated wallet identity.

Local code changes:
- Removed manual profile insertion from both OAuth callback handlers. A missing profile is logged as an auth-trigger/allocator reconciliation failure; the callback no longer creates an unindexed profile.
- Replaced both signup helper `profiles.upsert()` operations with update-only writes constrained by the newly created user ID. They cannot insert a new profile if the DB signup trigger did not create one.
- The signup helper now checks whether the update affected a profile row and emits a non-sensitive warning when it did not.
- Search of all application `.upsert()` sites found no further profile upserts; the remaining upserts target other tables (settings, 2FA, price cache, trade events, etc.).
- Search of auth callback source confirmed that the only profile-creation authority in this audited path is now the database signup trigger; callback routes only update optional profile fields.

Validation boundary:
- Source search and manual review completed; no automated tests, typecheck, lint or build run.
- No production writes, SQL migration, secret change, Git commit/push, deployment or financial transaction performed.

- Step 06 remains **IN PROGRESS**; wallet setup remains **NOT VERIFIED / NOT PRODUCTION-READY**.

### 14. Chain-aware address uniqueness preflight — 2026-11-22 continuation

Read-only inspection of the connected chain/address/index schema confirmed:
- The canonical `provision_user_wallets_atomic(uuid,integer,text,text,text,text)` RPC is postgres-owned SECURITY DEFINER, configured with an empty `search_path`, and executable only by `service_role`.
- The RPC checks wallet-index identity, per-user locks, deterministic address locks, profile mirror consistency and collisions against `wallets`, `user_deposit_addresses` and `deposit_addresses`.
- The current schema has raw-case unique constraints on some registries; `user_deposit_addresses` has a normalized address+network index, but case-normalized unique address protection is not consistent across all active registries.
- Current snapshot check returned zero normalized duplicate groups, zero cross-user normalized address collisions, and zero blank address rows. This is only the connected project's current snapshot and does not prove production identity.

A new local candidate migration `20261122180000_harden_chain_address_case_identity.sql` was prepared for the existing chain/address/index schema. It:
- Refuses to proceed if the canonical provisioning RPC owner, SECURITY DEFINER flag, empty search path or service-only grant contract has drifted.
- Refuses to proceed on unsupported networks, blank addresses, normalized duplicates or cross-user collisions.
- Adds unique normalized indexes for physical wallet/deposit addresses and profile mirrors.
- Normalizes EVM and Bech32 BTC/LTC addresses case-insensitively while preserving TRON Base58 case sensitivity.
- Verifies each expected index is valid, ready, unique and attached to its expected table before commit.

The migration remains local and unapplied. It is schema-specific and must not be applied until the intended production project and complete migration ordering are confirmed.

### 15. Xpub-mode fail-closed review and temporary child-key cleanup — 2026-11-22 continuation

Source review confirmed:
- When `PUBLIC_XPUB_DERIVATION_ENABLED=true`, both `getMasterHDKey()` and `getMasterHDKeySync()` throw instead of loading `DEPOSIT_HD_MNEMONIC`.
- Address derivation uses `deriveAllDepositAddressesFromXpubs` and requires all four configured account-level xpubs. Missing, malformed, private, wrong-depth or wrong-account-index extended keys fail closed; there is no mnemonic fallback.
- The parser comment correctly states that depth/index metadata alone cannot prove the ancestor path/coin account. The key ceremony must still be compared against approved known-index addresses before enabling xpub mode in production.
- The standard mnemonic address helpers in `src/lib/hd-derivation-engine.ts` now call `wipePrivateData()` on each temporary BTC/EVM/LTC/TRON child HDKey in a `finally` block after calculating its public address. The cached master key behavior is unchanged.

Validation boundary:
- Static source inspection only; no vector tests, automated tests, typecheck, lint or build run.
- Xpub mode remains opt-in and should not be enabled until key ceremony/path attestation and known-index fixture verification are complete.

### 16. Legacy profile-index repair endpoint dependency — 2026-11-22 continuation

The application admin endpoint `src/app/api/admin/wallet-index/assign/route.ts` calls `public.assign_missing_profile_wallet_indexes()`. The connected Supabase project does not contain that function (`to_regprocedure` returned NULL). Local migration `20261108080000_unify_wallet_index_allocation.sql` defines a service-role-only, `SECURITY DEFINER`, empty-search-path batch allocator using `FOR UPDATE SKIP LOCKED` and `public.user_wallet_index_seq`, but that exact version is not in the connected project's applied migration ledger.

The connected migration ledger instead contains remote-only versions `20261119074350_empty_wallet_provisioning_search_path` and `20261119174139_step_06_unify_wallet_index_allocator`, neither of which has an exact local source file. The live `claim_next_wallet_index()` RPC returns a new sequence index but does not attach it to a profile by itself. It is postgres-owned SECURITY DEFINER, empty-search-path and service-role-only. The exact purpose of the later remote Step 06 migration and whether it intentionally retired the batch assignment RPC cannot be established from the migration names alone; recover its source before changing the admin route or allocator design.

The admin endpoint already fails closed with HTTP 503 and code `WALLET_INDEX_ALLOCATOR_NOT_INSTALLED`; it has no client-side or MAX-index fallback. The current connected snapshot has zero profile rows, so there are no missing profile indexes to repair in this snapshot. No attempt was made to call `claim_next_wallet_index()` directly from the route because a sequence allocation separated from the profile update would not be atomic and could waste indexes under concurrent calls.

The auth signup trigger independently assigns new profile wallet indexes from the same canonical sequence. The application must not insert profiles or synthesize wallet indexes to work around the missing repair RPC.


## Latest continuation — 2026-11-23

The connected Supabase project currently has zero Auth users and zero profiles. Four active deposit_addresses records point to a missing Auth owner; the deposit scanners correctly skip these records because the profile and positive wallet index cannot be verified. Do not recreate the owner, assign those addresses to another account, or fabricate a wallet index. Signup/profile creation and sequence allocation still require isolated validation with a test Auth user.

The applied source-ledger files missing from main have now been restored. The current profile/wallet-index repair function assign_missing_profile_wallet_indexes() remains absent; the admin endpoint continues to fail closed. No profile was updated and no sequence was consumed for a fabricated customer.

The 20261119174139 step_06_unify_wallet_index_allocator migration is now represented in main using the exact applied Supabase version. This records the deployed allocator contract but does not certify BTC/ETH/LTC/TRON derivation vectors, xpub ancestor-path ceremony, customer wallet provisioning or deposit ownership. Step 06 remains IN PROGRESS and wallet launch remains NO-GO pending those validations.
