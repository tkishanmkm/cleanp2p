-- Make administrator withdrawal rejection/refund and audit insertion atomic.
-- Candidate only: rehearse on a schema-matched disposable database before deployment.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(
    p_withdrawal_id UUID,
    p_admin_id UUID,
    p_rejection_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_admin_email TEXT;
    v_is_admin BOOLEAN := FALSE;
    v_refund_result JSONB;
    v_reason TEXT := NULLIF(BTRIM(p_rejection_reason), '');
BEGIN
    IF p_withdrawal_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'withdrawal_id and admin_id are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT TRUE, p.email
      INTO v_is_admin, v_admin_email
      FROM public.profiles AS p
     WHERE p.id = p_admin_id
       AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE);

    IF v_is_admin IS DISTINCT FROM TRUE AND NOT EXISTS (
        SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = p_admin_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: administrator identity is not recognized'
            USING ERRCODE = '42501';
    END IF;

    v_refund_result := public.process_failed_withdrawal(
        p_withdrawal_id,
        COALESCE(v_reason, 'Rejected by administrator during security review.'),
        0,
        NULL,
        FALSE
    );

    -- Ambiguous-broadcast outcomes are deliberately not treated as completed rejection/refund.
    IF COALESCE((v_refund_result->>'success')::BOOLEAN, FALSE) IS DISTINCT FROM TRUE THEN
        RETURN v_refund_result;
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, details, created_at
    ) VALUES (
        p_admin_id,
        COALESCE(v_admin_email, 'admin@paxones.com'),
        'ADMIN_REJECTED_WITHDRAWAL',
        jsonb_build_object(
            'withdrawal_id', p_withdrawal_id,
            'rejection_reason', COALESCE(v_reason, 'Rejected by administrator during security review.'),
            'refund_result', v_refund_result
        ),
        now()
    );

    RETURN v_refund_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(UUID, UUID, TEXT)
    TO service_role, postgres;

COMMIT;
