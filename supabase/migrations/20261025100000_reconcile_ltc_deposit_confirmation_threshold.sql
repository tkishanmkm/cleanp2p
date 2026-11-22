DO $migration$
DECLARE
    v_function_oid oid;
    v_definition text;
    v_old_threshold text := 'v_required_confirmations := 6;';
    v_new_threshold text := 'v_required_confirmations := 12;';
BEGIN
    v_function_oid := to_regprocedure('public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)');
    IF v_function_oid IS NULL THEN
        RAISE EXCEPTION 'Expected canonical process_deposit_atomic signature is missing; refusing threshold migration';
    END IF;

    v_definition := pg_get_functiondef(v_function_oid);
    IF length(v_definition) - length(replace(v_definition, v_old_threshold, '')) <> length(v_old_threshold) THEN
        RAISE EXCEPTION 'Expected exactly one LTC legacy threshold token (6) in process_deposit_atomic; inspect live function before retrying';
    END IF;

    v_definition := replace(v_definition, v_old_threshold, v_new_threshold);
    IF position(v_new_threshold in v_definition) = 0 THEN
        RAISE EXCEPTION 'Failed to construct LTC=12 function definition';
    END IF;

    EXECUTE v_definition;
END;
$migration$;
