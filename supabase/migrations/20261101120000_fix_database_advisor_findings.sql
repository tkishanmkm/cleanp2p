-- Resolve the live production database advisor findings observed on 2026-11-01.
-- This migration is intentionally additive and preserves existing RLS policy roles,
-- commands, predicates, and checks. Apply only after production migration history
-- has been reconciled with the complete repository chain.
BEGIN;

-- 1. Cover the five foreign keys identified by Supabase's unindexed_foreign_keys advisor.
CREATE INDEX IF NOT EXISTS idx_deposits_user_id
    ON public.deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_platform_ledger_entries_related_user_id
    ON public.platform_ledger_entries (related_user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen_by
    ON public.profiles (emergency_frozen_by);

CREATE INDEX IF NOT EXISTS idx_sweep_queue_user_id
    ON public.sweep_queue (user_id);

CREATE INDEX IF NOT EXISTS idx_utxo_reservations_sweep_id
    ON public.utxo_reservations (sweep_id);

-- 2. RLS auth-function initPlan optimization is performed once by the earlier
-- 20261031120000_remediate_live_database_advisors migration. Rewriting those
-- predicates a second time would nest scalar SELECT wrappers and can fail when
-- earlier policy-reduction migrations have already removed legacy policy names.

-- 3. Remove the user-editable raw_user_meta_data admin claim from platform ledger
-- visibility. Preserve the trusted app_metadata and is_admin() authorization paths.
DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'platform_ledger_entries'
           AND policyname = 'Admins can view platform ledger'
    ) THEN
        RAISE EXCEPTION
            'Expected platform ledger admin policy is missing; refusing to change access.';
    END IF;

    ALTER POLICY "Admins can view platform ledger"
        ON public.platform_ledger_entries
        USING (
            public.is_admin()
            OR EXISTS (
                SELECT 1
                  FROM auth.users AS u
                 WHERE u.id = (SELECT auth.uid())
                   AND (u.raw_app_meta_data ->> 'role') = 'admin'
            )
        );
END;
$migration$;

-- 4. These tables contain security-enrollment state, recovery-code hashes,
-- and security audit records. They are intentionally service-only. Keep RLS
-- enabled and add explicit deny policies for browser roles so the advisor does
-- not mistake the deliberate absence of user access policies for an omission.
-- service_role keeps its explicit grants and bypasses RLS as designed.
DO $service_only_deny$
DECLARE
    v_table text;
    v_has_rls boolean;
    v_policy_count integer;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'user_2fa_pending_enrollments',
        'user_2fa_recovery_codes',
        'user_security_audit_logs'
    ] LOOP
        SELECT c.relrowsecurity
          INTO v_has_rls
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = v_table
           AND c.relkind = 'r';

        IF NOT FOUND OR v_has_rls IS NOT TRUE THEN
            RAISE EXCEPTION
                'Service-only table public.% is missing or does not have RLS enabled.',
                v_table;
        END IF;

        SELECT COUNT(*)
          INTO v_policy_count
          FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = v_table;

        IF v_policy_count <> 0 THEN
            RAISE EXCEPTION
                'Service-only table public.% has unexpected policies; refusing to alter policy semantics.',
                v_table;
        END IF;

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
            'deny_browser_roles_' || v_table,
            v_table
        );
    END LOOP;
END;
$service_only_deny$;

COMMIT;
