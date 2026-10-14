-- Store suspected deposit-chain reorganisations for operator review.
-- This migration does not change balances, deposit statuses, or ledger entries.
CREATE TABLE IF NOT EXISTS public.deposit_reorg_incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    network text NOT NULL CHECK (length(btrim(network)) > 0),
    tx_hash text NOT NULL CHECK (length(btrim(tx_hash)) > 0),
    output_index integer NOT NULL CHECK (output_index >= 0),
    deposit_id uuid,
    incident_type text NOT NULL CHECK (
        incident_type IN ('REORG_SUSPECTED', 'UNVERIFIABLE', 'MISSING_STORED_HASH')
    ),
    stored_block_hash text,
    observed_block_hash text,
    review_status text NOT NULL DEFAULT 'OPEN' CHECK (
        review_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE')
    ),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    reviewer_note text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS deposit_reorg_incidents_identity_key
    ON public.deposit_reorg_incidents (lower(btrim(network)), lower(btrim(tx_hash)), output_index);

COMMENT ON TABLE public.deposit_reorg_incidents IS
    'Read/reconciliation queue for suspicious or unverifiable confirmed deposits; never itself authorizes a financial adjustment.';
COMMENT ON COLUMN public.deposit_reorg_incidents.review_status IS
    'Operator workflow state only. Resolving an incident does not alter deposit balances or ledger entries.';

ALTER TABLE public.deposit_reorg_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_reorg_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deposit_reorg_incidents TO service_role;
