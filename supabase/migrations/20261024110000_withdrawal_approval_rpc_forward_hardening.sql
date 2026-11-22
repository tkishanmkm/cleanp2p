-- Forward-only repair for approve_withdrawal against the deployed schema.
-- The deployed withdrawals table has no approved_by/approved_at columns; those belong
-- to onchain_withdrawals. Never apply before schema-matched isolated rehearsal.
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_withdrawal(
    p_withdrawal_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_withdrawal public.withdrawals%ROWTYPE;
    v_onchain public.onchain_withdrawals%ROWTYPE;
    v_is_admin BOOLEAN := FALSE;
    v_admin_email TEXT;
BEGIN
    IF p_withdrawal_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'withdrawal_id and admin_id are required';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.app_admins WHERE user_id = p_admin_id
        UNION
        SELECT 1 FROM public.profiles
         WHERE id = p_admin_id AND (role = 'admin' OR is_admin = TRUE)
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: caller is not a platform administrator';
    END IF;

    SELECT *
      INTO v_withdrawal
      FROM public.withdrawals
     WHERE id = p_withdrawal_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    SELECT *
      INTO v_onchain
      FROM public.onchain_withdrawals
     WHERE id = p_withdrawal_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Paired on-chain withdrawal % not found; approval blocked for reconciliation', p_withdrawal_id;
    END IF;

    -- Safe retry: both rows must already reflect a completed approval transition.
    IF upper(COALESCE(v_withdrawal.status, '')) = 'QUEUED'
       AND upper(COALESCE(v_onchain.status, '')) = 'PENDING'
       AND v_onchain.approved_by IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', TRUE,
            'idempotent', TRUE,
            'withdrawal_id', p_withdrawal_id,
            'status', 'QUEUED'
        );
    END IF;

    IF upper(COALESCE(v_withdrawal.status, '')) NOT IN ('PENDING_APPROVAL', 'PENDING')
       AND lower(COALESCE(v_withdrawal.status, '')) NOT IN ('pending_approval', 'pending') THEN
        RAISE EXCEPTION 'Withdrawal % cannot be approved from status %',
            p_withdrawal_id, v_withdrawal.status;
    END IF;

    IF upper(COALESCE(v_onchain.status, '')) NOT IN ('NEEDS_APPROVAL', 'PENDING_APPROVAL', 'PENDING') THEN
        RAISE EXCEPTION 'On-chain withdrawal % cannot be approved from status %',
            p_withdrawal_id, v_onchain.status;
    END IF;

    IF NULLIF(BTRIM(v_withdrawal.tx_hash), '') IS NOT NULL
       OR NULLIF(BTRIM(v_withdrawal.txid), '') IS NOT NULL
       OR NULLIF(BTRIM(v_onchain.tx_hash), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot approve a withdrawal with a recorded transaction hash/txid';
    END IF;

    -- Persist approval fields only on the table that actually owns them.
    UPDATE public.onchain_withdrawals
       SET status = 'PENDING',
           approved_by = p_admin_id,
           approved_at = now(),
           updated_at = now()
     WHERE id = v_onchain.id;

    UPDATE public.withdrawals
       SET status = 'QUEUED',
           updated_at = now()
     WHERE id = v_withdrawal.id;

    SELECT email
      INTO v_admin_email
      FROM public.profiles
     WHERE id = p_admin_id;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, details, created_at
    ) VALUES (
        p_admin_id,
        v_admin_email,
        'ADMIN_APPROVED_WITHDRAWAL',
        jsonb_build_object(
            'withdrawal_id', p_withdrawal_id,
            'amount', v_withdrawal.amount,
            'asset', COALESCE(v_withdrawal.asset_symbol, v_withdrawal.token_symbol),
            'onchain_status', 'PENDING',
            'withdrawal_status', 'QUEUED'
        ),
        now()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'idempotent', FALSE,
        'withdrawal_id', p_withdrawal_id,
        'status', 'QUEUED',
        'message', 'Withdrawal approved and queued for broadcast'
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_withdrawal(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID)
    TO service_role, postgres;

COMMIT;
