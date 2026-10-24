-- Durable scan checkpoints prevent EVM ingestion from permanently skipping
-- deposits when a worker is down longer than its normal trailing scan window.
BEGIN;

CREATE TABLE IF NOT EXISTS public.deposit_scan_cursors (
    network_code TEXT PRIMARY KEY,
    last_scanned_block BIGINT NOT NULL CHECK (last_scanned_block >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.deposit_scan_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_scan_cursors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deposit_scan_cursors TO service_role;

COMMIT;
