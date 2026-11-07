-- Restore READY_TO_BROADCAST to the sweep state constraint.
-- Signed sweep persistence and recovery already use this state. Production's
-- constraint had drifted behind the intended schema and rejected that state.
BEGIN;

DO $dependency$
BEGIN
    IF to_regclass('public.sweep_operations') IS NULL THEN
        RAISE EXCEPTION 'public.sweep_operations is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.sweep_operations'::regclass
          AND conname = 'sweep_operations_status_check'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'Expected sweep_operations_status_check constraint is missing';
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
        RAISE EXCEPTION 'sweep_operations contains a status outside the supported state machine';
    END IF;
END;
$dependency$;

ALTER TABLE public.sweep_operations
    DROP CONSTRAINT sweep_operations_status_check;

ALTER TABLE public.sweep_operations
    ADD CONSTRAINT sweep_operations_status_check
    CHECK (status IN (
        'PENDING',
        'CLAIMED',
        'GAS_FUNDING',
        'GAS_FUNDED',
        'READY_TO_BROADCAST',
        'BROADCASTED',
        'CONFIRMED',
        'FAILED',
        'RECOVERY_REQUIRED'
    )) NOT VALID;

ALTER TABLE public.sweep_operations
    VALIDATE CONSTRAINT sweep_operations_status_check;

COMMENT ON CONSTRAINT sweep_operations_status_check ON public.sweep_operations IS
    'Allows the complete server-side sweep lifecycle, including durable READY_TO_BROADCAST persistence before network broadcast.';

COMMIT;
