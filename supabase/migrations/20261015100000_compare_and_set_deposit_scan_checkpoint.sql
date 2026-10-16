-- Compare-and-set checkpoint advancement prevents overlapping workers from overwriting
-- newer scan progress with a stale range.
CREATE OR REPLACE FUNCTION public.advance_deposit_scan_checkpoint(
    p_network text,
    p_expected_previous_block bigint,
    p_new_block bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_rows integer;
    v_network text;
BEGIN
    v_network := upper(btrim(p_network));

    IF v_network IS NULL OR v_network = '' THEN
        RAISE EXCEPTION 'network must not be empty';
    END IF;
    IF p_expected_previous_block IS NULL OR p_expected_previous_block < -1 THEN
        RAISE EXCEPTION 'expected previous block must be >= -1';
    END IF;
    IF p_new_block IS NULL OR p_new_block < 0 OR p_new_block <= p_expected_previous_block THEN
        RAISE EXCEPTION 'new block must be non-negative and greater than expected previous block';
    END IF;

    IF p_expected_previous_block >= 0 THEN
        UPDATE public.deposit_scan_checkpoints
           SET last_scanned_block = p_new_block,
               updated_at = now()
         WHERE network = v_network
           AND last_scanned_block = p_expected_previous_block
           AND last_scanned_block < p_new_block;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows = 1 THEN
            RETURN true;
        END IF;
    END IF;

    -- No checkpoint means this is the first scan and the caller supplied an
    -- explicit start-block baseline. Concurrent first writers race on the
    -- primary key; exactly one can initialize it. Existing mismatched rows
    -- are not overwritten because ON CONFLICT performs no update.
    INSERT INTO public.deposit_scan_checkpoints (network, last_scanned_block, updated_at)
    VALUES (v_network, p_new_block, now())
    ON CONFLICT (network) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_deposit_scan_checkpoint(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_deposit_scan_checkpoint(text, bigint, bigint) TO service_role;
