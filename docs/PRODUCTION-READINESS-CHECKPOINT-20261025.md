# Paxones production-readiness checkpoint — 2026-10-25

## Scope
Read-only inspection of the configured production Supabase project plus local repository checks. No production data or schema was modified. No deployment, commit, or push was performed.

## Confirmed live database blockers

1. **Migration history is behind the local hardening work.** The production migration ledger returned by Supabase ends at version `20261016013425`. The local tree contains later security and financial migrations dated 2026-10-17 through 2026-10-25. The staging project currently has no public tables, so there is no schema-matched staging target to safely validate this migration sequence.

2. **KYC RPC authorization gap in production.** Live `public.initiate_didit_kyc(uuid,text)` is executable by `authenticated`. The live function body references `auth.uid()` but does not compare the supplied target user ID against it. The local migration `20261018100000_restrict_didit_kyc_rpc_execution.sql` is intended to restrict this mutation to trusted backend roles. That migration has not been applied to production.

3. **Admin-login identity gap in production.** Live `public.verify_admin_login(uuid,uuid)` accepts target UUID arguments and does not bind them to the signed-in user's identity. The local forward migration `20261019110000_harden_verify_admin_login_identity.sql` adds the identity binding and service-role exception. It is not in the production migration ledger.

4. **Client-controlled admin trust in trade RPCs.** Live `mark_p2p_trade_paid` and `raise_trade_dispute` bodies reference `raw_user_meta_data` for admin authorization. User-editable metadata must not grant admin privileges. The local migration `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql` is the prepared correction and is not deployed.

5. **Direct transfer-row insertion is possible for authenticated users.** Live table privileges allow authenticated INSERT on `public.transfers`, and the policy `Users can insert transfers as sender` only checks that `sender_id = auth.uid()`. That does not prove funds moved and permits fabricated transfer-history rows. The local migration `20261018110000_restrict_public_financial_write_policies.sql` revokes client writes and reserves transfer creation for the trusted backend RPC.

## Verified local checks in this checkpoint

- `node scripts/check-migration-versions.mjs`: passed; 142 migration files scanned, 142 unique valid version prefixes.
- Focused deposit, withdrawal, KYC, trade-RPC, and SQL migration-contract tests: 93 passed, 0 failed.
- KYC configuration/response/UI regression tests: 9 passed, 0 failed.
- Locale JSON validation: 13 files valid.
- `git diff --check`: passed (Git emitted line-ending normalization warnings only).
- `npm run typecheck`: passed after the KYC changes.
- `npm run test:all`: blocked by the deliberate test safety guard because no disposable test database is configured. Do not use production credentials to unblock it.
- Production build compiled successfully and reached the lint/type-validation phase; many existing lint warnings remain. A final build exit code was not captured in this checkpoint.

## Next required gates

1. Provision or initialize a **disposable staging Supabase schema** and load a reconciled, ordered migration chain.
2. Validate each migration against that schema; reconcile historical duplicate/nonstandard migration versions without rewriting already-applied production history.
3. Execute live authorization tests proving the KYC, admin-login, trade-admin, and transfer-write protections.
4. Fix the withdrawal worker's session-level advisory-lock design with a database-backed lease and concurrency tests before enabling multiple worker instances.
5. Configure Didit in Render and obtain test wallets/test-network credentials before provider and blockchain integration certification.
6. Only after all gates pass, prepare a reviewed migration rollout and deployment plan.

## Release decision
**Not production-ready yet.** The local code hardening is useful, but the confirmed production SQL gaps and the absence of a disposable staging database are release blockers. Production remains untouched.

## Follow-up checkpoint (later on 2026-10-25)

### Additional local validation
- Didit/KYC regression tests: 9 passed, 0 failed after adding a 15-second provider timeout, strict HTTPS/Didit-host session URL validation, and generic client-facing provider errors.
- Additional UI/API/security contract tests: 26 passed, 0 failed (2FA session, ad validation/state, media privacy source contracts, admin metadata, transfer response validation, account restrictions, disabled TRON diagnostic, worker/webhook auth).
- Additional SQL/migration contract tests: 20 passed, 0 failed.
- Playwright: 3 passed (public home, login response, login accessibility).
- TypeScript typecheck: passed after the latest KYC changes.
- Migration version preflight: passed, 143 unique valid version prefixes after adding the lease migration.
- `git diff --check`: passed; only Windows LF/CRLF normalization warnings were emitted.
- Production build: passed, exit code 0 after the lease integration; many existing ESLint warnings remain.

### Integration gate remains blocked
The P2P, blockchain, reconciliation, and security integration scripts intentionally exited before test execution because `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1` are not configured for a disposable database. Do not point these tests at production. The Supabase CLI staging dry-run also could not run because the local CLI has no access token, and Docker/Podman is unavailable.

### Didit hardening added
- Abort provider requests after 15 seconds.
- Do not return provider response bodies or network diagnostics to the browser.
- Accept only HTTPS session URLs on `didit.me` or its subdomains, without embedded credentials or nonstandard ports.
- The provider host allowlist must be checked against the exact URLs returned by the configured Didit account before live enablement.

### No release actions
No migration was applied, no production data was changed, and no commit/push/deployment was performed.

### Additional read-only production SQL compatibility check
- Executed the exact replacement regex from the prepared trade-RPC metadata-hardening migration against the current live definitions of all five target RPCs (`mark_p2p_trade_paid`, `raise_trade_dispute`, `resolve_trade_dispute`, `expire_p2p_trade`, `cancel_expired_p2p_trades`).
- All five exact signatures exist; each contains the unsafe `raw_user_meta_data` reference; the candidate transformation removes all such references from each current definition. This is a read-only compatibility check, not an applied migration or proof of runtime authorization.

### Withdrawal worker coordination hardening — local candidate
- Replaced the worker's session-scoped advisory-lock calls with a PostgREST-safe owner-token lease helper. The worker fails closed if it cannot acquire the lease, caps each batch at 100, checks lease ownership before claiming another withdrawal, and releases only its own lease.
- Added migration `20261025045656_withdrawal_worker_owner_lease.sql` using an owner-token row, bounded lease duration, heartbeat renewal, owner-checked release, restricted RPC grants, and an empty function search path.
- Added static regression tests for the lease schema/function contracts and worker integration.
- Ran a transaction-scoped SQL behavior check against the **staging** Supabase project: owner A acquired/renewed/released; owner B could not steal, renew, or release A's active lease; B could acquire after A released. The transaction was rolled back, and the final query confirmed the test table did not persist.
- Local focused withdrawal tests now pass 8/8, including the updated existing worker contract test.
- This is not yet production-certified: the concurrency check is a small smoke test, not a high-load/multi-instance stress test, and the full staging migration chain is still uninitialized. Do not deploy this code/migration until a schema-matched staging run and broader concurrent lease tests pass.

- Follow-up multi-request staging smoke test: created the lease objects temporarily, issued two independent acquisition calls concurrently, and observed exactly one `true` and one `false`. Non-owner renewal and release both returned `false`; cleanup removed the temporary functions and table and confirmed the table no longer existed. This was performed only on staging, not production.
- After the final SQL return-value correction, the focused withdrawal regression suite passed 8/8, the migration preflight passed 143/143, the TypeScript typecheck passed, the production build passed (exit 0), and `git diff --check` passed.
