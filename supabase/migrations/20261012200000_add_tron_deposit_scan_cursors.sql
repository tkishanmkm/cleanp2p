-- Durable TronGrid event pagination cursor for TRC-20 USDT deposits.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tron_deposit_scan_cursors (
    network_code TEXT PRIMARY KEY CHECK (network_code = 'TRC20'),
    last_seen_event_key TEXT,
    backfill_fingerprint TEXT,
    backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tron_deposit_scan_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tron_deposit_scan_cursors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tron_deposit_scan_cursors TO service_role;

COMMIT;
