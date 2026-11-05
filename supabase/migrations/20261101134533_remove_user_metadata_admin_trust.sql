-- User-editable auth metadata must never grant admin authorization.
-- Rewrite the deployed SECURITY DEFINER functions while preserving their current
-- bodies, signatures, search_path settings, and execution grants.
DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
    v_rewritten TEXT;
BEGIN
    FOR v_function IN
        SELECT p.oid, p.proname
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.proname IN (
              'cancel_expired_p2p_trades',
              'expire_p2p_trade',
              'mark_p2p_trade_paid',
              'raise_trade_dispute',
              'resolve_trade_dispute'
          )
    LOOP
        v_definition := pg_get_functiondef(v_function.oid);

        CASE v_function.proname
            WHEN 'cancel_expired_p2p_trades' THEN
                v_rewritten := regexp_replace(
                    v_definition,
                    $pattern$[(][(]raw_user_meta_data[[:space:]]*->[>][[:space:]]*'role'[)][[:space:]]*=[[:space:]]*'admin'[[:space:]]+OR$pattern$,
                    '(',
                    'gi'
                );
            WHEN 'expire_p2p_trade' THEN
                v_rewritten := regexp_replace(
                    v_definition,
                    $pattern$raw_user_meta_data[[:space:]]*->[>][[:space:]]*'role'[[:space:]]*=[[:space:]]*'admin'[[:space:]]+OR$pattern$,
                    '',
                    'gi'
                );
            WHEN 'resolve_trade_dispute' THEN
                v_rewritten := regexp_replace(
                    v_definition,
                    $pattern$[(][[:space:]]*raw_user_meta_data[[:space:]]*->[>][[:space:]]*'role'[[:space:]]*[)][[:space:]]*=[[:space:]]*'admin'[[:space:]]+OR$pattern$,
                    '',
                    'gi'
                );
            ELSE
                v_rewritten := regexp_replace(
                    v_definition,
                    $pattern$[[:space:]]+OR[[:space:]]+raw_user_meta_data[[:space:]]*->[>][[:space:]]*'role'[[:space:]]*=[[:space:]]*'admin'$pattern$,
                    '',
                    'gi'
                );
        END CASE;

        IF v_rewritten = v_definition THEN
            RAISE EXCEPTION 'Expected editable-metadata admin check was not found in public.%', v_function.proname;
        END IF;
        IF position('raw_user_meta_data' IN v_rewritten) > 0 THEN
            RAISE EXCEPTION 'Editable metadata reference remains in public.%', v_function.proname;
        END IF;

        EXECUTE v_rewritten;
    END LOOP;
END;
$migration$;

