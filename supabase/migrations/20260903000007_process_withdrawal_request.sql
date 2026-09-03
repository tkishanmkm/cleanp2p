-- ============================================================================
-- Supabase Migration: 20260903000007_process_withdrawal_request.sql
-- Description: Stored procedure process_withdrawal_request for dynamic fee withdrawals
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_withdrawal_request(
    p_user_id UUID,
    p_gross_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_net_payout NUMERIC(36, 18),
    p_chain TEXT,
    p_destination TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_withdrawal_id UUID;
    v_chain_clean TEXT := UPPER(TRIM(p_chain));
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
        RAISE EXCEPTION 'Gross withdrawal amount must be greater than zero';
    END IF;

    IF p_net_payout IS NULL OR p_net_payout <= 0 THEN
        RAISE EXCEPTION 'Net payout amount must be greater than zero';
    END IF;

    -- Update users balance_usdt if table exists
    BEGIN
        UPDATE public.users
        SET balance_usdt = balance_usdt - p_gross_amount
        WHERE id = p_user_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        -- Fallback if table or column is absent
        NULL;
    END;

    -- Delegate to core request_withdrawal RPC
    v_withdrawal_id := public.request_withdrawal(
        p_user_id := p_user_id,
        p_network := v_chain_clean,
        p_to_address := p_destination,
        p_amount := p_net_payout,
        p_fee := p_fee,
        p_asset := 'USDT'
    );

    RETURN v_withdrawal_id;
END;
$$;
