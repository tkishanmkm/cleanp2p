-- Financial SECURITY DEFINER RPCs must never trust a caller-supplied identity
-- when the request has no authenticated user. Only service_role may use that
-- server-to-server fallback; authenticated requests remain bound to auth.uid().
DO $migration$
DECLARE
    v_function RECORD;
    v_definition TEXT;
    v_rewritten TEXT;
    v_identity_parameter TEXT;
    v_pattern TEXT;
    v_replacement TEXT;
BEGIN
    FOR v_function IN
        SELECT p.oid, p.proname
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.proname IN (
              'cancel_p2p_trade',
              'initiate_trade_with_escrow',
              'mark_p2p_trade_paid',
              'raise_trade_dispute'
          )
    LOOP
        v_identity_parameter := CASE
            WHEN v_function.proname = 'raise_trade_dispute' THEN 'p_user_id'
            ELSE 'p_caller_id'
        END;
        v_pattern := 'ELSE[[:space:]]+IF[[:space:]]+'
            || v_identity_parameter
            || '[[:space:]]+IS[[:space:]]+NULL';
        v_replacement := 'ELSE IF auth.role() IS DISTINCT FROM ''service_role'' '
            || 'AND current_setting(''role'', true) IS DISTINCT FROM ''service_role'' '
            || 'THEN RAISE EXCEPTION ''Service role required when caller identity is not available.''; '
            || 'END IF; IF '
            || v_identity_parameter
            || ' IS NULL';

        v_definition := pg_get_functiondef(v_function.oid);
        v_rewritten := regexp_replace(v_definition, v_pattern, v_replacement, 'i');

        IF v_rewritten = v_definition THEN
            RAISE EXCEPTION 'Expected identity fallback was not found in public.%', v_function.proname;
        END IF;
        IF position('Service role required when caller identity is not available.' IN v_rewritten) = 0 THEN
            RAISE EXCEPTION 'Trusted identity guard was not added to public.%', v_function.proname;
        END IF;

        EXECUTE v_rewritten;
    END LOOP;
END;
$migration$;