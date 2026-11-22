-- Read-only preflight for the canonical sweep_operations status set.
DO $preflight$
DECLARE
    v_definition text;
BEGIN
    SELECT pg_catalog.pg_get_constraintdef(c.oid)
      INTO v_definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.sweep_operations'::regclass
      AND c.conname = 'sweep_operations_status_check'
      AND c.contype = 'c'
      AND c.convalidated IS TRUE;

    IF v_definition IS NULL
       OR pg_catalog.strpos(v_definition, 'READY_TO_BROADCAST') = 0
       OR pg_catalog.strpos(v_definition, 'PENDING') = 0
       OR pg_catalog.strpos(v_definition, 'CLAIMED') = 0
       OR pg_catalog.strpos(v_definition, 'GAS_FUNDING') = 0
       OR pg_catalog.strpos(v_definition, 'GAS_FUNDED') = 0
       OR pg_catalog.strpos(v_definition, 'BROADCASTED') = 0
       OR pg_catalog.strpos(v_definition, 'CONFIRMED') = 0
       OR pg_catalog.strpos(v_definition, 'FAILED') = 0
       OR pg_catalog.strpos(v_definition, 'RECOVERY_REQUIRED') = 0 THEN
        RAISE EXCEPTION 'Validated sweep_operations status constraint is incomplete';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sweep_operations
        WHERE status IS NULL
           OR status NOT IN (
               'PENDING',
               'CLAIMED',
               'GAS_FUNDING',
               'GAS_FUNDED',
               'READY_TO_BROADCAST',
               'BROADCASTED',
               'CONFIRMED',
               'FAILED',
               'RECOVERY_REQUIRED'
           )
    ) THEN
        RAISE EXCEPTION 'Existing sweep rows violate the supported status set';
    END IF;
END;
$preflight$;
