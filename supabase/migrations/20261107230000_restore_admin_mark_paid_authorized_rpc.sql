-- Restore the server-only administrator mark-paid endpoint.
-- The route verifies the human administrator and signed 2FA session; this
-- SECURITY DEFINER wrapper independently confirms the durable active-admin
-- identity, runs the canonical payment transition, and writes the audit row
-- atomically in the same database transaction.
BEGIN;

DO $dependencies$
DECLARE
    v_mark_paid regprocedure := to_regprocedure(
        'public.mark_p2p_trade_paid(uuid,uuid,text)'
    );
    v_active_admin regprocedure := to_regprocedure(
        'public.is_active_admin_identity(uuid)'
    );
BEGIN
    IF v_mark_paid IS NULL OR v_active_admin IS NULL
       OR to_regclass('public.admin_audit_logs') IS NULL
       OR to_regclass('auth.users') IS NULL
       OR to_regclass('public.trades') IS NULL THEN
        RAISE EXCEPTION 'Canonical mark-paid/admin/audit dependencies are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_mark_paid
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_mark_paid,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_mark_paid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_mark_paid,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical participant mark-paid RPC owner/path/grants changed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_active_admin
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Durable active-admin identity predicate is not postgres-owned SECURITY DEFINER with an empty search_path';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='admin_id' AND data_type='uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='admin_email'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='action'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='target_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='target_user_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='details' AND data_type='jsonb'
    ) THEN
        RAISE EXCEPTION 'Required administrator audit columns are missing or incompatible';
    END IF;
END;
$dependencies$;

CREATE OR REPLACE FUNCTION public.admin_mark_trade_paid_authorized(
    p_trade_id uuid,
    p_actor_id uuid,
    p_actor_email text,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email text;
    v_supplied_email text := nullif(pg_catalog.btrim(p_actor_email), '');
    v_clean_reason text := nullif(pg_catalog.btrim(p_reason), '');
    v_payment_method text;
    v_target_user_id uuid;
    v_result jsonb;
    v_final_status text;
    v_final_escrow_status text;
    v_paid_at timestamptz;
    v_idempotent boolean := false;
BEGIN
    -- The server must separately verify the human admin and signed 2FA
    -- session. The JWT here proves only that this is a trusted server call.
    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_trade_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'Trade and verified administrator actor are required.'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NULL
       OR pg_catalog.length(v_clean_reason) < 10
       OR pg_catalog.length(v_clean_reason) > 1000 THEN
        RAISE EXCEPTION 'An administrative reason between 10 and 1000 characters is required.'
            USING ERRCODE = '22023';
    END IF;

    -- The audit identity is sourced from Supabase Auth, never from the
    -- caller-supplied email. The supplied email is only a consistency check.
    SELECT nullif(pg_catalog.btrim(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_active_admin_identity(p_actor_id) THEN
        RAISE EXCEPTION 'A full, active administrator account is required.'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize concurrent attempts for this trade. The underlying transition
    -- also locks this row; the outer lock protects the mandatory audit pairing.
    SELECT t.buyer_id::uuid, t.payment_method
      INTO v_target_user_id, v_payment_method
      FROM public.trades AS t
     WHERE t.id = p_trade_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade not found.'
            USING ERRCODE = 'P0002';
    END IF;

    v_result := public.mark_p2p_trade_paid(
        p_trade_id,
        p_actor_id,
        v_payment_method
    );

    IF coalesce(v_result ->> 'success', 'false') <> 'true' THEN
        RAISE EXCEPTION 'Canonical trade paid transition was not confirmed.'
            USING ERRCODE = 'P0001';
    END IF;

    v_idempotent := coalesce(v_result ->> 'message', '') ILIKE 'Already marked as paid%';

    SELECT lower(coalesce(t.status::text, '')),
           lower(coalesce(t.escrow_status::text, '')),
           coalesce(t.paid_at, t.marked_paid_at)
      INTO v_final_status, v_final_escrow_status, v_paid_at
      FROM public.trades AS t
     WHERE t.id = p_trade_id;

    IF v_paid_at IS NULL
       OR v_final_status NOT IN ('paid', 'buyer_marked_paid', 'payment_sent')
       OR v_final_escrow_status <> 'paid' THEN
        RAISE EXCEPTION 'Trade payment state did not persist as paid.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Mandatory audit insert is in the same transaction as the payment
    -- state transition. Any failure rolls the entire operation back.
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        p_actor_id,
        v_actor_email,
        'ADMIN_MARKED_TRADE_PAID',
        p_trade_id::text,
        v_target_user_id,
        pg_catalog.jsonb_build_object(
            'trade_id', p_trade_id,
            'reason', v_clean_reason,
            'payment_method', v_payment_method,
            'paid_at', v_paid_at,
            'idempotent_replay', v_idempotent
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN v_result || pg_catalog.jsonb_build_object(
        'audit_logged', true,
        'idempotent_replay', v_idempotent,
        'actor_id', p_actor_id
    );
END;
$function$;

ALTER FUNCTION public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)
    TO service_role, postgres;

COMMENT ON FUNCTION public.admin_mark_trade_paid_authorized(uuid,uuid,text,text) IS
    'Service-only administrative mark-paid wrapper. Verifies the active administrator identity, executes the canonical paid-state transition, and records a mandatory audit row atomically. The calling Next.js route must also verify the signed administrator 2FA session.';

NOTIFY pgrst, 'reload schema';

COMMIT;
