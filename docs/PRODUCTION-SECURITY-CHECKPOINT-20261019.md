# Production Security Checkpoint — 2026-10-19

## Scope and safety

- Repository inspected locally at `C:\Users\theki\cleanp2p`, branch `fix/production-typecheck-batch-1`.
- Read-only Supabase inspection performed against project `paxonesflows` (`eaiwgfxoiwxepinvcykg`).
- No database writes, migrations, commits, pushes, merges, deployments, or financial operations were performed.
- The project `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) currently reports zero recorded migrations and zero public tables; it is not a schema-matched test environment yet.

## Confirmed findings

### 1. Transfer table permissions need urgent remediation

The live schema currently reports that the `anon` role has SELECT and INSERT table privileges on `public.transfers`, and `authenticated` has SELECT, INSERT, and UPDATE privileges. The policy inventory also contains broad `PUBLIC` policies, including a sender-controlled transfer insert policy and duplicate service-role/read policies.

This is a high-priority financial-integrity risk. RLS policies and table grants must both be restrictive; a sender-id check alone does not authorize client-supplied amounts, fees, status, or balance metadata.

Prepared local migration: `supabase/migrations/20261018110000_restrict_public_financial_write_policies.sql`. It revokes public/anon access and client write privileges, grants authenticated participant-only reads, and confines transfer inserts to the service role. **Not applied to the live database.** Before applying, validate on a schema-matched isolated database and confirm all application paths use the trusted atomic transfer RPC.

### 2. Ad table write grants are broader than desired

The live schema reports `anon` has INSERT privilege on both `public.ads` and `public.p2p_ads`; `authenticated` also has update privileges. Current RLS policies may block some operations, but privileges should be tightened as defense in depth.

The prepared local financial-write migration revokes anonymous write privileges on both ad tables. The active-ad cap migration is also local-only. Validate policies, ownership, mirrored ad IDs, and service-role paths before deployment.

### 3. SECURITY DEFINER advisor warnings require function-by-function review

Supabase's live security advisor reports 18 SECURITY DEFINER functions executable by `authenticated`. This is not proof each function is exploitable; authorization inside each body and the grants both matter.

Read-only inspection confirmed:
- `initiate_trade_with_escrow` has a caller-ID mismatch guard and requires an idempotency key; its search path is still `public, pg_temp` in the live schema.
- `initiate_didit_kyc` checks that an authenticated caller can only initiate KYC for their own ID.
- `get_user_2fa_status` checks that non-admin users cannot query another user's status.
- Trade payment/dispute RPCs reject a supplied caller ID that differs from `auth.uid()`.
- Trade lifecycle RPCs still contain user-editable `raw_user_meta_data->>'role'` checks in admin authorization branches. User metadata is not a trusted admin source.

Prepared local hardening migrations:
- `20261019110000_harden_verify_admin_login_identity.sql`: prevents authenticated users from probing admin status for another UUID.
- `20261019120000_harden_trade_escrow_rpc_search_path.sql`: hardens escrow-initiation search path.
- `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql`: removes user-editable metadata from reviewed trade-admin checks; a read-only regex simulation confirmed its patch pattern matches all five target live function definitions and leaves no `raw_user_meta_data` references in those definitions.
- `20261019140000_block_disabled_account_idempotency_replay.sql`: checks account eligibility before successful idempotency replay.
- `20261019150000_harden_security_definer_search_paths.sql`: sets reviewed function search paths to empty.

These remain local-only. The regex simulation was a SELECT-only check, not execution of the migration or a PostgreSQL engine test.

### 4. RLS-enabled 2FA/security audit tables have no policies, but direct grants are denied

`user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs` have RLS enabled, zero policies, and no direct SELECT/INSERT/UPDATE grants for `anon` or `authenticated`; service-role access is present. This may be the intended trusted-server-only design, so do not add client policies merely to silence the advisor. Document this design and verify the server routes use service-role access safely.

## Verification status

- Read-only Supabase catalog inspection: completed.
- SECURITY DEFINER metadata-predicate regex simulation: passed for five reviewed functions.
- Live migration history ends at `20261016013425`; local migrations dated 2026-10-17 through 2026-10-19 are not applied.
- SQL engine replay of local migrations: not completed; local `psql` and Supabase CLI were not found on the Windows machine.
- No production changes made.

## Next required steps

1. Establish a truly isolated schema-matched PostgreSQL test database without incurring paid Supabase branch costs; replay the migration chain and run negative/positive tests.
2. Validate the transfer/ad grant lockdown and all financial RPC grants on that isolated database.
3. Test admin impersonation, user-metadata escalation, disabled-account replay, trade cancellation/payment/dispute, ad limits, and chat caps with synthetic accounts only.
4. Re-check Supabase security/performance advisors after an approved migration rollout.
5. Continue the planned Next.js major security upgrade separately; do not use `npm audit fix --force` blindly.

**Production status: NOT READY.** The live transfer table privileges/policies and unvalidated local migrations remain release blockers.
