-- Durable EVM deposit scan checkpoints. Checkpoints advance only after both token and native scans
-- complete without errors; the worker must be configured with an explicit start block on first run.
CREATE TABLE IF NOT EXISTS public.deposit_scan_checkpoints (
    network text PRIMARY KEY CHECK (network = upper(btrim(network)) AND length(btrim(network)) > 0),
    last_scanned_block bigint NOT NULL CHECK (last_scanned_block >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deposit_scan_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_scan_checkpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deposit_scan_checkpoints TO service_role;
