# Legacy Deposit-Credit RPC Containment — Step 35X

Date: 2026-10-14

## Status

Applied to production Supabase project `eaiwgfxoiwxepinvcykg` and committed to branch `fix/retire-unverified-deposit-entrypoints`.

Commit: `4ac6e0d7d06606f2330340916f4472d94bc0949f`

Migration: `supabase/migrations/20261014000000_revoke_unverified_legacy_deposit_credit_rpcs.sql`

## Change

Revoked EXECUTE from `service_role` on 11 deployed legacy deposit-credit function signatures:
- `credit_confirmed_deposit(character varying, integer, character varying, uuid, character varying, numeric)`
- `credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer)`
- `credit_onchain_deposit(text, text, numeric, text, text)`
- `ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer)`
- `process_deposit(uuid, character varying, numeric, character varying)`
- `process_deposit_atomic(text, text, text, numeric, text, integer, bigint, text, text, integer, text)`
- `process_incoming_deposit(text, text, text, numeric, text, integer)`
- `process_user_deposit(uuid, text, numeric, text, text, text, text)`
- `process_user_deposit(uuid, text, text, numeric)`
- `process_user_deposit(uuid, text, text, text, numeric, text)`
- `process_user_deposit(uuid, uuid, text, text, numeric, text, text, integer)`

## Verification

Immediately after applying the migration, a live read-only permission query confirmed for all 11 signatures:
- `anon` EXECUTE: false
- `authenticated` EXECUTE: false
- `service_role` EXECUTE: false

The migration file was fetched back from GitHub and its presence/content verified.

## Safety and limitations

- No balances, deposits, withdrawals, or user records were changed.
- Automatic deposit credit was already disabled in application code and remains disabled.
- This is containment, not a replacement deposit-credit implementation. Legitimate deposit credit may remain pending.
- Worker and application paths must be tested to confirm they fail safely and report disabled credit clearly.
- The full live definitions/callers of all wallet, sweep, broadcast, and withdrawal functions remain under audit.
- No build, automated test suite, or end-to-end chain test was run as part of this step.
- Do not restore grants until an independently verified deposit evidence boundary and its callers are reviewed.
