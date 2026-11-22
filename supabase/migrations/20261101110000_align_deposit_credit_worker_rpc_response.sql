-- Align the canonical deposit RPC with the confirmation worker's explicit
-- success/replay contract. This is a function-body-only patch: no wallet,
-- deposit, or ledger rows are touched while the migration runs.
-- Candidate only: execute against a schema-faithful disposable PostgreSQL
-- database before any deployment approval.
BEGIN;

DO $align_deposit_worker_response$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_patched TEXT;
    v_replay_pattern TEXT := '(''status''[[:space:]]*,[[:space:]]*''ALREADY_CREDITED''[[:space:]]*,)';
    v_confirmed_pattern TEXT := '(''status''[[:space:]]*,[[:space:]]*''CONFIRMED''[[:space:]]*,)';
    v_position INTEGER;
    v_fragment TEXT;
    v_credited_present BOOLEAN;
    v_replay_flag_present BOOLEAN;
BEGIN
    v_oid := to_regprocedure(
        'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Canonical process_deposit_atomic signature is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);

    IF regexp_count(v_definition, v_replay_pattern, 1, 'i') <> 1
       OR regexp_count(v_definition, v_confirmed_pattern, 1, 'i') <> 1 THEN
        RAISE EXCEPTION
            'Expected one ALREADY_CREDITED and one CONFIRMED success response; refusing to patch an unknown RPC shape.';
    END IF;

    -- An already-credited replay must explicitly say no new credit was made.
    v_position := strpos(lower(v_definition), '''status'', ''already_credited''');
    v_fragment := substring(lower(v_definition) FROM v_position FOR 500);
    v_credited_present := position('''credited'', false' IN v_fragment) > 0;
    v_replay_flag_present := position('''already_credited'', true' IN v_fragment) > 0;

    IF v_credited_present IS DISTINCT FROM v_replay_flag_present THEN
        RAISE EXCEPTION 'The ALREADY_CREDITED response contains only part of its explicit credit flags.';
    ELSIF NOT v_credited_present THEN
        v_patched := regexp_replace(
            v_definition,
            v_replay_pattern,
            E'\\1\\n                ''credited'', false,\\n                ''already_credited'', true,',
            'i'
        );
        IF v_patched = v_definition THEN
            RAISE EXCEPTION 'Failed to add explicit replay flags to process_deposit_atomic.';
        END IF;
        v_definition := v_patched;
    END IF;

    -- A new confirmed deposit must explicitly say that this invocation credited it.
    v_position := strpos(lower(v_definition), '''status'', ''confirmed''');
    v_fragment := substring(lower(v_definition) FROM v_position FOR 500);
    v_credited_present := position('''credited'', true' IN v_fragment) > 0;
    v_replay_flag_present := position('''already_credited'', false' IN v_fragment) > 0;

    IF v_credited_present IS DISTINCT FROM v_replay_flag_present THEN
        RAISE EXCEPTION 'The CONFIRMED response contains only part of its explicit credit flags.';
    ELSIF NOT v_credited_present THEN
        v_patched := regexp_replace(
            v_definition,
            v_confirmed_pattern,
            E'\\1\\n        ''credited'', true,\\n        ''already_credited'', false,',
            'i'
        );
        IF v_patched = v_definition THEN
            RAISE EXCEPTION 'Failed to add explicit confirmed-credit flags to process_deposit_atomic.';
        END IF;
        v_definition := v_patched;
    END IF;

    -- Validate both response shapes before replacing the function definition.
    v_position := strpos(lower(v_definition), '''status'', ''already_credited''');
    v_fragment := substring(lower(v_definition) FROM v_position FOR 500);
    IF position('''credited'', false' IN v_fragment) = 0
       OR position('''already_credited'', true' IN v_fragment) = 0 THEN
        RAISE EXCEPTION 'ALREADY_CREDITED response contract validation failed.';
    END IF;

    v_position := strpos(lower(v_definition), '''status'', ''confirmed''');
    v_fragment := substring(lower(v_definition) FROM v_position FOR 500);
    IF position('''credited'', true' IN v_fragment) = 0
       OR position('''already_credited'', false' IN v_fragment) = 0 THEN
        RAISE EXCEPTION 'CONFIRMED response contract validation failed.';
    END IF;

    IF v_definition IS DISTINCT FROM pg_get_functiondef(v_oid) THEN
        EXECUTE v_definition;
    END IF;
END;
$align_deposit_worker_response$;

COMMIT;
