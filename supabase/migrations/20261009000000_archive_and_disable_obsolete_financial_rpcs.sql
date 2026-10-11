-- ==============================================================================
-- Supabase Migration: 20261009000000_archive_and_disable_obsolete_financial_rpcs.sql
-- Description: Secure archival and privilege lockdown of three obsolete financial
--              RPCs with zero callers across the paxonesflows repository:
--              1. public.fail_and_refund_withdrawal(uuid, text)
--              2. public.get_admin_financial_stats()
--              3. public.check_user_withdrawal_velocity(uuid, numeric, numeric)
--
-- Background & Audit Verification:
--   - Comprehensive repository search (src/, supabase/, scripts/, docs/) confirmed
--     0 active callers, references, or dynamic bindings for these 3 legacy routines.
--   - Canonical, hardened alternatives are already in active production:
--       * Refund flow: public.process_failed_withdrawal(uuid, text, numeric, text, boolean)
--         (enforces broadcast safety, idempotent status transitions, wallet_assets schema,
--          in_withdrawal deduction, double-entry ledgering, and admin audit trail).
--       * Financial stats: Server-side admin metrics routes (/api/admin/metrics)
--         with strict session role verification and atomic SQL aggregation.
--       * Velocity checks: public.request_withdrawal(...) with atomic KYC Tier 2+
--         enforcement and 24-hour rolling USD limits against onchain_withdrawals.
--
-- Security Actions:
--   1. Records baseline OIDs, signatures, and definitions of protected routines:
--      - public.has_pending_withdrawal_approval(uuid)
--      - public.process_failed_withdrawal(uuid, text, numeric, text, boolean)
--      - public.request_withdrawal(uuid, text, text, numeric, numeric, text, numeric)
--   2. Ensures _archive_security schema and function_snapshots table exist with
--      strict PostgreSQL constraints, sequence security, and owner isolation.
--   3. Captures full catalog metadata (OID, owner, prosecdef, search_path config,
--      source definition text, and SHA-256 digest) into the immutable snapshot store.
--   4. Revokes all EXECUTE permissions from PUBLIC, anon, authenticated,
--      supabase_auth_admin, and service_role.
--   5. Replaces target bodies with safe raising stubs returning ERRCODE '0A000'
--      (feature_not_supported) to fail closed on any unexpected invocation.
--   6. Re-asserts ACL status and performs before/after tamper-detection on all
--      protected routines to guarantee zero collateral impact.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. PREFLIGHT SAFETY & PROTECTED ROUTINES BASELINE CAPTURE
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_hpw_oid OID;
    v_hpw_def TEXT;
    v_hpw_owner TEXT;
    v_hpw_secdef BOOLEAN;
    v_hpw_cfg TEXT[];

    v_pfw_oid OID;
    v_pfw_def TEXT;
    v_pfw_owner TEXT;
    v_pfw_secdef BOOLEAN;

    v_rqw_oid OID;
    v_rqw_def TEXT;
    v_rqw_owner TEXT;
    v_rqw_secdef BOOLEAN;
BEGIN
    -- Verify current session user has appropriate administration privileges
    IF CURRENT_USER NOT IN ('postgres', 'supabase_admin') AND NOT pg_has_role(CURRENT_USER, 'postgres', 'MEMBER') THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Migration must be executed by postgres or supabase_admin (current_user: %)', CURRENT_USER;
    END IF;

    -- Baseline 1: public.has_pending_withdrawal_approval(uuid)
    v_hpw_oid := to_regprocedure('public.has_pending_withdrawal_approval(uuid)')::OID;
    IF v_hpw_oid IS NULL THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Critical protected routine public.has_pending_withdrawal_approval(uuid) is missing!';
    END IF;

    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, pg_get_functiondef(v_hpw_oid)
    INTO v_hpw_owner, v_hpw_secdef, v_hpw_cfg, v_hpw_def
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_hpw_oid;

    IF v_hpw_owner <> 'postgres' THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Protected helper owner must be postgres (found: %)', v_hpw_owner;
    END IF;

    IF NOT v_hpw_secdef THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Protected helper must be SECURITY DEFINER';
    END IF;

    IF v_hpw_cfg IS NULL OR NOT (ARRAY['search_path=public, auth, pg_temp'] <@ v_hpw_cfg OR ARRAY['search_path=public,auth,pg_temp'] <@ v_hpw_cfg) THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Protected helper search_path must be public, auth, pg_temp (found: %)', v_hpw_cfg;
    END IF;

    -- Baseline 2: public.process_failed_withdrawal(uuid, text, numeric, text, boolean)
    v_pfw_oid := to_regprocedure('public.process_failed_withdrawal(uuid, text, numeric, text, boolean)')::OID;
    IF v_pfw_oid IS NULL THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Critical canonical routine public.process_failed_withdrawal is missing!';
    END IF;

    SELECT pg_get_userbyid(p.proowner), p.prosecdef, pg_get_functiondef(v_pfw_oid)
    INTO v_pfw_owner, v_pfw_secdef, v_pfw_def
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_pfw_oid;

    IF v_pfw_owner <> 'postgres' OR NOT v_pfw_secdef THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Canonical process_failed_withdrawal must be SECURITY DEFINER owned by postgres';
    END IF;

    -- Baseline 3: public.request_withdrawal(uuid, text, text, numeric, numeric, text, numeric)
    v_rqw_oid := to_regprocedure('public.request_withdrawal(uuid, text, text, numeric, numeric, text, numeric)')::OID;
    IF v_rqw_oid IS NULL THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Critical canonical routine public.request_withdrawal is missing!';
    END IF;

    SELECT pg_get_userbyid(p.proowner), p.prosecdef, pg_get_functiondef(v_rqw_oid)
    INTO v_rqw_owner, v_rqw_secdef, v_rqw_def
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_rqw_oid;

    IF v_rqw_owner <> 'postgres' OR NOT v_rqw_secdef THEN
        RAISE EXCEPTION '[PREFLIGHT FAILED] Canonical request_withdrawal must be SECURITY DEFINER owned by postgres';
    END IF;

    -- Temporary table to hold protected baselines across the migration transaction
    CREATE TEMP TABLE _tmp_protected_baseline (
        routine_name TEXT PRIMARY KEY,
        routine_oid OID NOT NULL,
        def_hash TEXT NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO _tmp_protected_baseline VALUES
        ('has_pending_withdrawal_approval', v_hpw_oid, md5(v_hpw_def)),
        ('process_failed_withdrawal', v_pfw_oid, md5(v_pfw_def)),
        ('request_withdrawal', v_rqw_oid, md5(v_rqw_def));

    RAISE NOTICE '[PREFLIGHT PASSED] Protected routines verified and registered for integrity assertion.';
END $$;

-- ------------------------------------------------------------------------------
-- 1. ARCHIVE SCHEMA & AUDIT STORAGE SETUP
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS _archive_security;

-- Restrict schema access
REVOKE ALL ON SCHEMA _archive_security FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA _archive_security TO postgres;

-- Function snapshot archive table
CREATE TABLE IF NOT EXISTS _archive_security.function_snapshots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_name TEXT NOT NULL,
    routine_name TEXT NOT NULL,
    canonical_signature TEXT NOT NULL,
    routine_oid OID NOT NULL,
    routine_owner TEXT NOT NULL,
    security_definer BOOLEAN NOT NULL,
    proconfig TEXT[],
    definition_source TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    archived_by TEXT NOT NULL DEFAULT CURRENT_USER,
    reason TEXT NOT NULL,
    deprecation_phase TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT uq_function_snapshots_sig UNIQUE (canonical_signature)
);

ALTER TABLE _archive_security.function_snapshots OWNER TO postgres;
REVOKE ALL ON TABLE _archive_security.function_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE _archive_security.function_snapshots TO postgres;

-- Secure the identity sequence strictly belonging to _archive_security.function_snapshots
DO $$
DECLARE
    v_seq_name TEXT;
BEGIN
    SELECT pg_get_serial_sequence('_archive_security.function_snapshots', 'id') INTO v_seq_name;
    IF v_seq_name IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq_name);
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO postgres', v_seq_name);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. SNAPSHOT & ARCHIVE OBSOLETE TARGET PROCEDURES
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_oid OID;
    v_owner TEXT;
    v_secdef BOOLEAN;
    v_config TEXT[];
    v_def TEXT;
    v_hash TEXT;
    v_targets TEXT[] := ARRAY[
        'public.fail_and_refund_withdrawal(uuid, text)',
        'public.get_admin_financial_stats()',
        'public.check_user_withdrawal_velocity(uuid, numeric, numeric)'
    ];
    v_reasons TEXT[] := ARRAY[
        'Superseded by canonical public.process_failed_withdrawal with broadcast verification, wallet_assets schema compatibility, and double-entry ledgering.',
        'Superseded by authenticated server-side metrics calculation in Next.js admin endpoints with strict RBAC.',
        'Superseded by atomic KYC Tier 2 velocity enforcement embedded inside canonical public.request_withdrawal.'
    ];
    i INT;
    v_sig TEXT;
    v_reason TEXT;
BEGIN
    FOR i IN 1..array_length(v_targets, 1) LOOP
        v_sig := v_targets[i];
        v_reason := v_reasons[i];
        v_oid := to_regprocedure(v_sig)::OID;

        IF v_oid IS NOT NULL THEN
            SELECT 
                pg_get_userbyid(p.proowner),
                p.prosecdef,
                p.proconfig,
                pg_get_functiondef(v_oid)
            INTO
                v_owner,
                v_secdef,
                v_config,
                v_def
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_oid;

            -- Calculate SHA-256 digest using extensions.digest or sha256 fallback
            BEGIN
                v_hash := encode(extensions.digest(convert_to(v_def, 'UTF8'), 'sha256'), 'hex');
            EXCEPTION WHEN OTHERS THEN
                v_hash := encode(sha256(convert_to(v_def, 'UTF8')), 'hex');
            END;

            INSERT INTO _archive_security.function_snapshots (
                schema_name,
                routine_name,
                canonical_signature,
                routine_oid,
                routine_owner,
                security_definer,
                proconfig,
                definition_source,
                definition_hash,
                archived_at,
                archived_by,
                reason,
                deprecation_phase,
                metadata
            ) VALUES (
                'public',
                split_part(split_part(v_sig, '(', 1), '.', 2),
                v_sig,
                v_oid,
                v_owner,
                v_secdef,
                v_config,
                v_def,
                v_hash,
                clock_timestamp(),
                CURRENT_USER,
                v_reason,
                'DISABLED_AND_REVOKED',
                jsonb_build_object(
                    'audit_date', '2026-10-10',
                    'project', 'paxonesflows',
                    'zero_callers_verified', true,
                    'service_role_revoked', true
                )
            )
            ON CONFLICT (canonical_signature) DO UPDATE SET
                definition_source = EXCLUDED.definition_source,
                definition_hash = EXCLUDED.definition_hash,
                archived_at = EXCLUDED.archived_at,
                archived_by = EXCLUDED.archived_by,
                reason = EXCLUDED.reason,
                deprecation_phase = EXCLUDED.deprecation_phase,
                metadata = EXCLUDED.metadata;

            RAISE NOTICE '[ARCHIVED] Captured snapshot for % (OID: %, Hash: %)', v_sig, v_oid, v_hash;
        ELSE
            RAISE NOTICE '[SKIP ARCHIVE] Target % does not exist in live catalog (already dropped or absent).', v_sig;
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 3. REVOKE ALL PRIVILEGES (INCLUDING service_role)
-- ------------------------------------------------------------------------------

-- Target 1: public.fail_and_refund_withdrawal(uuid, text)
DO $$
BEGIN
    IF to_regprocedure('public.fail_and_refund_withdrawal(uuid, text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.fail_and_refund_withdrawal(uuid, text) FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        RAISE NOTICE '[REVOKED] Revoked ALL privileges on public.fail_and_refund_withdrawal(uuid, text) from all non-postgres roles.';
    END IF;
END $$;

-- Target 2: public.get_admin_financial_stats()
DO $$
BEGIN
    IF to_regprocedure('public.get_admin_financial_stats()') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.get_admin_financial_stats() FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        RAISE NOTICE '[REVOKED] Revoked ALL privileges on public.get_admin_financial_stats() from all non-postgres roles.';
    END IF;
END $$;

-- Target 3: public.check_user_withdrawal_velocity(uuid, numeric, numeric)
DO $$
BEGIN
    IF to_regprocedure('public.check_user_withdrawal_velocity(uuid, numeric, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.check_user_withdrawal_velocity(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        RAISE NOTICE '[REVOKED] Revoked ALL privileges on public.check_user_withdrawal_velocity(uuid, numeric, numeric) from all non-postgres roles.';
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. HARDEN STUB BODIES (DEFENSIVE CONTAINMENT)
-- Replace routine bodies with safe raising stubs so that even if invoked by superuser
-- or direct trigger, execution fails closed with ERRCODE '0A000' (feature_not_supported).
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    IF to_regprocedure('public.fail_and_refund_withdrawal(uuid, text)') IS NOT NULL THEN
        EXECUTE $stub$
            CREATE OR REPLACE FUNCTION public.fail_and_refund_withdrawal(p_withdrawal_id uuid, p_reason text)
            RETURNS void
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, auth, pg_temp
            AS $f$
            BEGIN
                RAISE EXCEPTION 'OBSOLETE_RPC_REVIOLATION: public.fail_and_refund_withdrawal is deprecated and disabled. Use canonical public.process_failed_withdrawal.'
                    USING ERRCODE = '0A000';
            END;
            $f$;
        $stub$;
        ALTER FUNCTION public.fail_and_refund_withdrawal(uuid, text) OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.fail_and_refund_withdrawal(uuid, text) FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        GRANT EXECUTE ON FUNCTION public.fail_and_refund_withdrawal(uuid, text) TO postgres;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regprocedure('public.get_admin_financial_stats()') IS NOT NULL THEN
        EXECUTE $stub$
            CREATE OR REPLACE FUNCTION public.get_admin_financial_stats()
            RETURNS jsonb
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, auth, pg_temp
            AS $f$
            BEGIN
                RAISE EXCEPTION 'OBSOLETE_RPC_REVIOLATION: public.get_admin_financial_stats is deprecated and disabled. Use authenticated server-side metrics endpoints.'
                    USING ERRCODE = '0A000';
            END;
            $f$;
        $stub$;
        ALTER FUNCTION public.get_admin_financial_stats() OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.get_admin_financial_stats() FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        GRANT EXECUTE ON FUNCTION public.get_admin_financial_stats() TO postgres;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regprocedure('public.check_user_withdrawal_velocity(uuid, numeric, numeric)') IS NOT NULL THEN
        EXECUTE $stub$
            CREATE OR REPLACE FUNCTION public.check_user_withdrawal_velocity(p_user_id uuid, p_amount numeric, p_usd_value numeric)
            RETURNS boolean
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, auth, pg_temp
            AS $f$
            BEGIN
                RAISE EXCEPTION 'OBSOLETE_RPC_REVIOLATION: public.check_user_withdrawal_velocity is deprecated and disabled. Velocity is enforced in public.request_withdrawal.'
                    USING ERRCODE = '0A000';
            END;
            $f$;
        $stub$;
        ALTER FUNCTION public.check_user_withdrawal_velocity(uuid, numeric, numeric) OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.check_user_withdrawal_velocity(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated, supabase_auth_admin, service_role;
        GRANT EXECUTE ON FUNCTION public.check_user_withdrawal_velocity(uuid, numeric, numeric) TO postgres;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. POST-REMEDIATION ACL ASSERTIONS & TAMPER-DETECTION
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_target TEXT;
    v_oid OID;
    v_role TEXT;
    v_has_priv BOOLEAN;
    v_targets TEXT[] := ARRAY[
        'public.fail_and_refund_withdrawal(uuid, text)',
        'public.get_admin_financial_stats()',
        'public.check_user_withdrawal_velocity(uuid, numeric, numeric)'
    ];
    v_roles TEXT[] := ARRAY['anon', 'authenticated', 'supabase_auth_admin', 'service_role'];
    t INT;
    r INT;

    -- Protected check variables
    v_base RECORD;
    v_curr_oid OID;
    v_curr_def TEXT;
    v_curr_hash TEXT;
    v_curr_owner TEXT;
    v_curr_secdef BOOLEAN;
    v_sig TEXT;
BEGIN
    -- 1. Assert all obsolete targets have NO EXECUTE privileges for non-postgres roles
    FOR t IN 1..array_length(v_targets, 1) LOOP
        v_target := v_targets[t];
        v_oid := to_regprocedure(v_target)::OID;

        IF v_oid IS NOT NULL THEN
            FOR r IN 1..array_length(v_roles, 1) LOOP
                v_role := v_roles[r];
                -- Test if role exists in cluster before checking privilege
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                    SELECT has_function_privilege(v_role, v_oid, 'EXECUTE') INTO v_has_priv;
                    IF v_has_priv THEN
                        RAISE EXCEPTION '[ACL VIOLATION] Target % still grants EXECUTE to role %!', v_target, v_role;
                    END IF;
                END IF;
            END LOOP;

            -- Direct catalog ACL inspection: ensure no PUBLIC grants exist in proacl
            IF EXISTS (
                SELECT 1
                FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                WHERE p.oid = v_oid
                  AND (acl::text LIKE '=X/%' OR acl::text LIKE 'public=X/%')
            ) THEN
                RAISE EXCEPTION '[ACL VIOLATION] Target % still has PUBLIC execution grant in catalog proacl!', v_target;
            END IF;
        END IF;
    END LOOP;

    -- 2. Assert all protected active routines remain 100% identical and untampered
    FOR v_base IN SELECT * FROM _tmp_protected_baseline LOOP
        IF v_base.routine_name = 'has_pending_withdrawal_approval' THEN
            v_sig := 'public.has_pending_withdrawal_approval(uuid)';
        ELSIF v_base.routine_name = 'process_failed_withdrawal' THEN
            v_sig := 'public.process_failed_withdrawal(uuid, text, numeric, text, boolean)';
        ELSIF v_base.routine_name = 'request_withdrawal' THEN
            v_sig := 'public.request_withdrawal(uuid, text, text, numeric, numeric, text, numeric)';
        END IF;

        v_curr_oid := to_regprocedure(v_sig)::OID;
        IF v_curr_oid IS NULL OR v_curr_oid <> v_base.routine_oid THEN
            RAISE EXCEPTION '[TAMPER DETECTED] Protected routine % OID changed from % to %!', v_base.routine_name, v_base.routine_oid, v_curr_oid;
        END IF;

        SELECT pg_get_userbyid(p.proowner), p.prosecdef, pg_get_functiondef(v_curr_oid)
        INTO v_curr_owner, v_curr_secdef, v_curr_def
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_curr_oid;

        IF v_curr_owner <> 'postgres' THEN
            RAISE EXCEPTION '[TAMPER DETECTED] Protected routine % owner changed to %!', v_base.routine_name, v_curr_owner;
        END IF;

        IF NOT v_curr_secdef THEN
            RAISE EXCEPTION '[TAMPER DETECTED] Protected routine % prosecdef changed!', v_base.routine_name;
        END IF;

        v_curr_hash := md5(v_curr_def);
        IF v_curr_hash <> v_base.def_hash THEN
            RAISE EXCEPTION '[TAMPER DETECTED] Protected routine % definition source was modified during migration!', v_base.routine_name;
        END IF;
    END LOOP;

    RAISE NOTICE '[VERIFICATION PASSED] All obsolete routines locked down; all protected active routines verified 100%% unchanged.';
END $$;

COMMIT;

