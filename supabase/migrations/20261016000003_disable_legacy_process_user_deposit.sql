-- Disable the legacy caller-parameter deposit RPC.
-- It trusts user, amount, address, network, and transaction values supplied by
-- its caller and directly credits balances; canonical chain ingestion must use
-- process_deposit_atomic after independent on-chain verification.
CREATE OR REPLACE FUNCTION public.process_user_deposit(
    p_user_id UUID,
    p_address TEXT,
    p_asset TEXT,
    p_chain TEXT,
    p_amount NUMERIC,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Deprecated direct deposit RPC disabled; use verified canonical deposit ingestion';
END;
$$;

REVOKE ALL ON FUNCTION public.process_user_deposit(uuid, text, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_user_deposit(uuid, text, text, text, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.process_user_deposit(uuid, text, text, text, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, text, text, numeric, text) TO service_role;
