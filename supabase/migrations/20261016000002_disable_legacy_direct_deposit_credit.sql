-- Disable the legacy parameter-based deposit credit RPC.
-- It accepts caller-supplied user/amount/transaction values without binding them
-- to a verified onchain_deposits row and can bypass the confirmation gate.
CREATE OR REPLACE FUNCTION public.process_confirmed_deposit(
    p_user_id UUID,
    p_amount NUMERIC,
    p_tx_hash TEXT,
    p_asset TEXT,
    p_network TEXT DEFAULT 'ERC20'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Deprecated deposit credit RPC disabled; use the verified deposit-record workflow';
END;
$$;

REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) TO service_role;
