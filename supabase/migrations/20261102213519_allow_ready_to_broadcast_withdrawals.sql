-- Allow the durable withdrawal pre-broadcast state in the canonical queue.
BEGIN;

ALTER TABLE public.onchain_withdrawals
  DROP CONSTRAINT IF EXISTS onchain_withdrawals_status_check;

ALTER TABLE public.onchain_withdrawals
  ADD CONSTRAINT onchain_withdrawals_status_check
  CHECK (status = ANY (ARRAY[
    'NEEDS_APPROVAL'::character varying,
    'PENDING_APPROVAL'::character varying,
    'QUEUED'::character varying,
    'PENDING'::character varying,
    'PROCESSING'::character varying,
    'READY_TO_BROADCAST'::character varying,
    'AMBIGUOUS_BROADCAST'::character varying,
    'BROADCASTED'::character varying,
    'CONFIRMED'::character varying,
    'COMPLETED'::character varying,
    'FAILED'::character varying,
    'CANCELLED'::character varying
  ]));

COMMIT;