# Step 35N — Remote baseline preflight and staging parity check

## Outcome: Remote metadata verified; schema export remains blocked

This step uses the connected Supabase project and migration metadata APIs because this session cannot run a local shell, Docker, or the Supabase CLI. Read-only inventory attempts through SQL were blocked by the tool's safety gate, so this report does not claim direct catalog-query results.

## Project identity verified

| Environment | Project ref | Project name | Status | PostgreSQL |
|---|---|---|---|---|
| Production | eaiwgfxoiwxepinvcykg | paxonesflows | ACTIVE_HEALTHY | 17.6.1.166 |
| Staging | tazvjyrdondcrdrkggqe | cleanp2p-staging | ACTIVE_HEALTHY | 17.11.0.003 |

Both projects report region ap-northeast-1. Staging's database minor version is newer than production's; this is not proof of schema compatibility.

## Migration metadata returned by Supabase

Production reports 12 migration-history entries:
- 20261011152650 wallet_rpc_execute_restrictions
- 20261011160153 wallet_hardening_followup
- 20261011160335 wallet_deposit_rpc_restrictions
- 20261011160457 wallet_legacy_deposit_overload
- 20261011161643 secure_wallet_provisioning_trigger
- 20261011161817 enforce_atomic_withdrawal_limits
- 20261011163228 restrict_wallet_lock_functions
- 20261011163807 fix_wallet_transfer_search_path
- 20261013202306 restrict_sensitive_escrow_and_sweep_rpc_execution
- 20261013202340 restrict_sensitive_escrow_release_and_refund_rpcs
- 20261013202420 restrict_unauthorized_admin_status_and_escrow_rpcs
- 20261013202555 revoke_anon_access_to_p2p_trade_financial_rpcs

Staging reports zero migration-history entries. Migration history is not a full schema dump: it does not prove that production objects match GitHub migration files, nor that staging is ready to receive them.

## Security advisor snapshot

The connected advisor tool returned the following production results (observed 2026-10-13 22:23:09 UTC):
- 33 anon-executable SECURITY DEFINER function findings (WARN)
- 57 authenticated-executable SECURITY DEFINER function findings (WARN)
- 2 mutable search-path findings (WARN): public.process_trade_escrow and public.lower
- 3 RLS-enabled tables with no policies (INFO): public.user_2fa_pending_enrollments, public.user_2fa_recovery_codes, public.user_security_audit_logs

These are advisor findings, not proof that every flagged function is exploitable. Each function must be audited against intended callers and internal checks before privileges are changed; broad blanket revocation could break application features.

The staging security advisor returned no lints, but staging has zero recorded migrations and is not yet schema-faithful. Its empty advisor result is not evidence of production readiness.

## Decisions / safety

- No schema export or dump was created.
- No SQL, DDL, migration, or database change was run.
- No production/staging data was changed.
- No local CLI version or config parse was verified.
- No dump or database credentials were committed.
- The production and staging projects were only inspected through metadata/advisor APIs.

## Required next action

The private schema-only dump still requires running the CLI on a trusted local machine. Follow Step 35M's instructions. Keep the dump outside GitHub, verify the target project ref through the Dashboard, and do not import into staging until a migration reconciliation plan exists.

Deposits remain NOT READY for production: public.process_deposit_atomic still trusts caller-influenced confirmation values and no validated replacement credit trust boundary has been deployed and tested.
