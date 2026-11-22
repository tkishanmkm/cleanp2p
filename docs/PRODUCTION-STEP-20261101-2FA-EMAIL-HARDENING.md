# Further security hardening in this continuation

- The trade email service is now explicitly server-only. Outbound Edge Function calls use no-store and a 10-second timeout. The service no longer derives customer trade links from configurable hostnames and no longer logs recipient email addresses or provider error payloads; failures return generic messages.
- The email Edge Function URL is derived only from a configured HTTPS Supabase *.supabase.co origin. The previous hard-coded production Supabase project fallback was removed, so missing or invalid configuration fails closed.
- Added supabase/tests/user_2fa_rpc_preflight.sql. This is a read-only preflight for the user 2FA lifecycle migrations; it verifies required tables/RPCs, RLS, SECURITY DEFINER, empty search paths, owner and role grants after applying the candidate migrations in an isolated schema-faithful database. It has not been run.

## Newly confirmed production 2FA release blocker

A fresh read-only production catalog query found only public.get_user_2fa_status(uuid) among the user 2FA functions. The production project is missing all of the following objects required by the current application code:

- public.user_2fa_rate_limits
- public.check_user_2fa_rate_limit(uuid)
- public.reset_user_2fa_rate_limit(uuid)
- public.enable_user_2fa_atomic(uuid,text,jsonb,boolean)
- public.disable_user_2fa_atomic(uuid,text,text)
- public.consume_user_2fa_recovery_code_with_audit(uuid,text,text)

The local migration candidates defining these objects are:
- 20261101180000_persist_user_2fa_rate_limits.sql
- 20261101190000_atomic_user_2fa_lifecycle.sql
- 20261101220000_atomic_user_2fa_recovery_code_audit.sql

Production does contain the service-only pending-enrollment, recovery-code and audit tables, but the missing RPCs mean the current enrollment, disable, recovery-code and sensitive-action rate-limiter flows correctly fail closed rather than bypass controls. A local static fallback was deliberately not added because it would lose cross-instance coordination and atomic single-use recovery-code consumption.

**Do not apply these migrations to production until migration provenance is reconciled and they pass the new preflight plus actual transaction/concurrency tests on a schema-faithful disposable database.** Until then, user 2FA lifecycle and protected 2FA operations are not production-operational.

## Dependency audit note

The production dependency audit reported zero vulnerabilities after the targeted npm audit fix --omit=dev --ignore-scripts remediation. The all-dependency audit process returned exit code 1 without captured output; the complete development/build dependency advisory list remains unknown and is not marked clean.
