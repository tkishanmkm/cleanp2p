-- Do not preserve a stale maximum confirmation count across a reorg.
-- Patch the existing canonical function definition so pending confirmations can
-- decrease when the canonical chain changes. Already-credited deposits remain
-- subject to separate financial reconciliation; this does not reverse credits.
BEGIN;

DO $migration$
DECLARE
    v_definition TEXT;
    v_updated TEXT;
    v_signature REGPROCEDURE :=
      'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'::REGPROCEDURE;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;

    v_updated := regexp_replace(
        v_definition,
        'v_effective_confirmations :=[[:space:]]*GREATEST\([[:space:]]*COALESCE\(p_confirmations,[[:space:]]*0\),[[:space:]]*COALESCE\(v_existing_onchain\.confirmations,[[:space:]]*0\)[[:space:]]*\);',
        'v_effective_confirmations := COALESCE(p_confirmations, 0);',
        'g'
    );

    v_updated := regexp_replace(
        v_updated,
        'confirmations :=[[:space:]]*GREATEST\([[:space:]]*COALESCE\(confirmations,[[:space:]]*0\),[[:space:]]*v_effective_confirmations[[:space:]]*\)',
        'confirmations := v_effective_confirmations',
        'g'
    );

    IF v_updated = v_definition
       OR position('v_effective_confirmations := COALESCE(p_confirmations, 0);' IN v_updated) = 0
       OR position('confirmations := v_effective_confirmations' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not safely patch process_deposit_atomic confirmation logic; no changes applied';
    END IF;

    EXECUTE v_updated;
END
$migration$;

ALTER FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) SET search_path = '';

COMMIT;
